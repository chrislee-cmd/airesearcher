// AI 동시통역 — 사후 batch 재번역 트리거 (PR-T3).
//
// The realtime interpreter compresses meaning under latency pressure;
// this route lets the host re-translate the preserved source-language
// transcript (kind='input' rows) in batch mode with Claude Sonnet
// once the session has ended.
//
// Lifecycle (revision_status on translate_sessions):
//   idle    → 한 번도 발동 안 됨
//   pending → 이 라우트 실행 중. 동시 트리거 방지 락 역할.
//   done    → 모든 input 행에 revised_text 작성됨
//   failed  → LLM 또는 DB 오류 (revision_error 컬럼에 사유)
//
// Credit cost: REVISE_CREDITS (10) flat — LLM call only, no storage.
// Idempotency: a second POST after `done` returns 200 ok=true with
// already_revised=true, no re-charge (the ledger uses session_id +
// revision suffix so a duplicate spend is refused).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { spendCreditsAdminAmount, refundCredits } from '@/lib/credits';
import {
  REVISE_BATCH_SIZE,
  REVISION_MODEL_LABEL,
  reviseBatch,
  type ReviseInputRow,
} from '@/lib/translate-revise';

export const runtime = 'nodejs';
// 30 rows per batch × ~5s/batch + DB write overhead. A 300-row session
// (the largest we've observed) takes ~8 batches ≈ 40-60s. Buffer to
// 180s so a slow Anthropic response doesn't trip the platform limit.
export const maxDuration = 180;

export const REVISE_CREDITS = 10;

// Suffix appended to the session id so the credit ledger sees this as a
// distinct charge from the recording-unlock spend (which uses the
// recording id, not the session id, as generation_id).
function revisionGenerationId(sessionId: string): string {
  return `${sessionId}:revise`;
}

type SessionRow = {
  id: string;
  org_id: string;
  host_user_id: string;
  status: string;
  source_lang: string;
  target_lang: string;
  record_enabled: boolean;
  revision_status: 'idle' | 'pending' | 'done' | 'failed';
};

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data: rawSession, error: readErr } = await admin
    .from('translate_sessions')
    .select(
      'id, org_id, host_user_id, status, source_lang, target_lang, record_enabled, revision_status',
    )
    .eq('id', id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!rawSession) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const session = rawSession as SessionRow;
  if (session.host_user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (session.status !== 'ended') {
    return NextResponse.json({ error: 'session_not_ended' }, { status: 409 });
  }
  if (!session.record_enabled) {
    // Source transcript was never persisted — nothing to revise.
    return NextResponse.json({ error: 'transcript_unavailable' }, { status: 409 });
  }
  if (session.revision_status === 'done') {
    return NextResponse.json({ ok: true, already_revised: true });
  }
  if (session.revision_status === 'pending') {
    // Another request is already running. Don't double-charge or
    // double-update; the client should poll the status endpoint.
    return NextResponse.json({ error: 'revision_in_progress' }, { status: 409 });
  }

  // Load all input rows ordered by ts. We need both the text and the
  // primary key so we can write back per-row.
  const inputRows: ReviseInputRow[] = [];
  const PAGE = 1000;
  let cursor: string | null = null;
  for (let i = 0; i < 50; i++) {
    let q = admin
      .from('translate_messages')
      .select('id, text, ts, speaker')
      .eq('session_id', id)
      .eq('kind', 'input')
      .order('ts', { ascending: true })
      .order('id', { ascending: true })
      .limit(PAGE);
    if (cursor) q = q.gt('ts', cursor);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    for (const row of data) {
      inputRows.push({
        id: row.id as number,
        text: (row.text as string) ?? '',
        speaker: (row.speaker as 'host' | 'guest' | null) ?? null,
      });
    }
    if (data.length < PAGE) break;
    cursor = data[data.length - 1].ts as string;
  }
  if (inputRows.length === 0) {
    return NextResponse.json({ error: 'transcript_empty' }, { status: 409 });
  }

  // Charge credits up-front. Idempotency: generation_id is sticky to
  // the session, so a successful second POST after we crash mid-flight
  // doesn't re-charge — the partial UNIQUE on credit_transactions
  // refuses it. The earlier `revision_status === 'done'` short-circuit
  // covers the happy idempotent path; this guards the rare crash-then-
  // retry case.
  const genId = revisionGenerationId(id);
  const spend = await spendCreditsAdminAmount(
    session.org_id,
    session.host_user_id,
    'translate',
    REVISE_CREDITS,
    genId,
  );
  if (!spend.ok) {
    return NextResponse.json({ error: spend.reason }, { status: 402 });
  }

  // Optimistic lock — flip to 'pending' BEFORE the LLM call so a second
  // concurrent POST hits the in_progress guard above.
  const startedAt = new Date().toISOString();
  const { error: lockErr } = await admin
    .from('translate_sessions')
    .update({
      revision_status: 'pending',
      revision_started_at: startedAt,
      revision_model: REVISION_MODEL_LABEL,
      revision_error: null,
    })
    .eq('id', id)
    .eq('revision_status', session.revision_status);
  if (lockErr) {
    await refundCredits(session.org_id, session.host_user_id, 'translate', genId);
    return NextResponse.json({ error: lockErr.message }, { status: 500 });
  }

  // Chunk + run. We DO NOT parallelize chunks — Anthropic rate limits
  // bite hard on bursts, and a 30-min session's 8 batches in serial
  // still finishes well within `maxDuration`. Sequential also keeps
  // memory bounded (only one batch's response in flight at once).
  try {
    for (let i = 0; i < inputRows.length; i += REVISE_BATCH_SIZE) {
      const chunk = inputRows.slice(i, i + REVISE_BATCH_SIZE);
      const revised = await reviseBatch(
        chunk,
        session.source_lang,
        session.target_lang,
      );
      // Bulk-update per row. We don't have a multi-row UPDATE primitive
      // on the JS client; the per-row update is fine at this volume
      // (≤300 calls for the largest sessions) and keeps RLS / triggers
      // honest. If this becomes a bottleneck, batching via a single
      // `.upsert([...])` with onConflict='id' is a one-line swap.
      for (const r of revised) {
        const { error: updErr } = await admin
          .from('translate_messages')
          .update({ revised_text: r.revised })
          .eq('id', r.id);
        if (updErr) throw new Error(`db_update_failed: ${updErr.message}`);
      }
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'unknown';
    await admin
      .from('translate_sessions')
      .update({
        revision_status: 'failed',
        revision_error: detail.slice(0, 500),
      })
      .eq('id', id);
    await refundCredits(session.org_id, session.host_user_id, 'translate', genId);
    return NextResponse.json({ error: 'revision_failed', detail }, { status: 500 });
  }

  const completedAt = new Date().toISOString();
  const { error: doneErr } = await admin
    .from('translate_sessions')
    .update({
      revision_status: 'done',
      revision_completed_at: completedAt,
    })
    .eq('id', id);
  if (doneErr) {
    return NextResponse.json({ error: doneErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    revised_rows: inputRows.length,
    model: REVISION_MODEL_LABEL,
    credits_spent: REVISE_CREDITS,
  });
}

// Polling endpoint for the host console. Returns the revision lifecycle
// without re-reading translate_messages — cheap enough to call every
// few seconds while the host watches the spinner.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('translate_sessions')
    .select(
      'id, host_user_id, revision_status, revision_started_at, revision_completed_at, revision_model, revision_error',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (data.host_user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  return NextResponse.json({
    revision_status: data.revision_status,
    revision_started_at: data.revision_started_at,
    revision_completed_at: data.revision_completed_at,
    revision_model: data.revision_model,
    revision_error: data.revision_error,
  });
}

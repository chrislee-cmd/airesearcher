// AI 동시통역 — 사후 post-process 보정 트리거 (Layer D).
//
// revise (../revise) 와 별개의 LLM pass. revise 는 source 행을 batch
// 재번역하지만, 이 라우트는 실시간 통역 OUTPUT 전사록 전체를 한 번에
// 검토해 단어 융합 / 인명 표기 / soundalike / 의미 압축을 교정하고 불확실
// 구간은 플래그를 남긴 markdown artifact (post_process_md) 를 생성한다.
//
// lifecycle (post_process_status on translate_sessions):
//   idle    → 한 번도 발동 안 됨
//   pending → 실행 중 (동시 트리거 락)
//   done    → post_process_md 작성됨
//   failed  → LLM/DB 오류 (post_process_error)
//
// Credit cost: POSTPROCESS_CREDITS flat — LLM 호출 1회.
// Idempotency: generation_id = `${sessionId}:postprocess` (revise 의
// `:revise` 와 구분). `done` 후 재POST 는 200 already_processed=true,
// 재과금 없음.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { spendCreditsAdminAmount, refundCredits } from '@/lib/credits';
import { checkLlmRateLimit } from '@/lib/rate-limit';
import {
  postProcessTranscript,
  POST_PROCESS_MODEL_LABEL,
} from '@/lib/translate-postprocess';

export const runtime = 'nodejs';
// 단일 LLM 호출 (16k output token) — 길어야 ~90s. revise(180s) 와 동일
// 버퍼로 플랫폼 한도 여유.
export const maxDuration = 180;

export const POSTPROCESS_CREDITS = 10;

function postprocessGenerationId(sessionId: string): string {
  return `${sessionId}:postprocess`;
}

const Body = z.object({
  smooth: z.enum(['on', 'off']).default('off'),
  canonical_name: z.string().max(200).optional(),
  // 2차 전사본 / 별 출처 텍스트 (옵션). 클라이언트가 업로드 파일을 텍스트로
  // 읽어 전달. 길이 상한으로 프롬프트 폭주 방지.
  reference: z.string().max(100_000).optional(),
});

type SessionRow = {
  id: string;
  org_id: string;
  host_user_id: string;
  status: string;
  source_lang: string;
  target_lang: string;
  record_enabled: boolean;
  glossary: unknown;
  post_process_status: 'idle' | 'pending' | 'done' | 'failed';
};

type OutputRow = {
  text: string;
  speaker: 'host' | 'guest' | null;
  ts: string;
};

function normalizeGlossary(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((g): g is string => typeof g === 'string')
    .map((g) => g.trim())
    .filter((g) => g.length > 0)
    .slice(0, 200);
}

function offsetStamp(rowTs: string, startMs: number): string {
  const t = Date.parse(rowTs);
  const offsetMs = Number.isFinite(t) ? Math.max(0, t - startMs) : 0;
  const sec = Math.floor(offsetMs / 1000);
  const hh = String(Math.floor(sec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function roleLabel(speaker: 'host' | 'guest' | null): string {
  if (speaker === 'host') return 'Host';
  if (speaker === 'guest') return 'Guest';
  return 'Speaker';
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { smooth, canonical_name, reference } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data: rawSession, error: readErr } = await admin
    .from('translate_sessions')
    .select(
      'id, org_id, host_user_id, status, source_lang, target_lang, record_enabled, glossary, post_process_status',
    )
    .eq('id', id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!rawSession) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const session = rawSession as SessionRow;
  if (session.host_user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const limited = await checkLlmRateLimit(user.id, session.org_id);
  if (limited) return limited;

  if (session.status !== 'ended') {
    return NextResponse.json({ error: 'session_not_ended' }, { status: 409 });
  }
  if (!session.record_enabled) {
    return NextResponse.json({ error: 'transcript_unavailable' }, { status: 409 });
  }
  if (session.post_process_status === 'done') {
    return NextResponse.json({ ok: true, already_processed: true });
  }
  if (session.post_process_status === 'pending') {
    return NextResponse.json({ error: 'postprocess_in_progress' }, { status: 409 });
  }

  // Load all OUTPUT (translated) rows ordered by ts. post-process 의 입력은
  // 실시간 통역 결과물이다 (source 가 아니라).
  const outputRows: OutputRow[] = [];
  const PAGE = 1000;
  let cursor: string | null = null;
  for (let i = 0; i < 50; i++) {
    let q = admin
      .from('translate_messages')
      .select('text, ts, speaker')
      .eq('session_id', id)
      .eq('kind', 'output')
      .order('ts', { ascending: true })
      .order('id', { ascending: true })
      .limit(PAGE);
    if (cursor) q = q.gt('ts', cursor);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    for (const row of data) {
      outputRows.push({
        text: (row.text as string) ?? '',
        speaker: (row.speaker as 'host' | 'guest' | null) ?? null,
        ts: row.ts as string,
      });
    }
    if (data.length < PAGE) break;
    cursor = data[data.length - 1].ts as string;
  }
  if (outputRows.length === 0) {
    return NextResponse.json({ error: 'transcript_empty' }, { status: 409 });
  }

  // Build the raw transcript text the prompt consumes: [HH:MM:SS] [Role] text.
  const startMs = Date.parse(outputRows[0].ts);
  const t0 = Number.isFinite(startMs) ? startMs : Date.now();
  const speakerSet = new Set<string>();
  const rawTranscript = outputRows
    .map((r) => {
      speakerSet.add(r.speaker ?? 'unknown');
      const stamp = offsetStamp(r.ts, t0);
      return `[${stamp}] [${roleLabel(r.speaker)}] ${r.text.replace(/\s+/g, ' ').trim()}`;
    })
    .join('\n');

  const glossary = normalizeGlossary(session.glossary);

  // Charge credits up-front (idempotent generation_id).
  const genId = postprocessGenerationId(id);
  const spend = await spendCreditsAdminAmount(
    session.org_id,
    session.host_user_id,
    'translate',
    POSTPROCESS_CREDITS,
    genId,
  );
  if (!spend.ok) {
    return NextResponse.json({ error: spend.reason }, { status: 402 });
  }

  // Optimistic lock — flip to 'pending' BEFORE the LLM call.
  const startedAt = new Date().toISOString();
  const { error: lockErr } = await admin
    .from('translate_sessions')
    .update({
      post_process_status: 'pending',
      post_process_started_at: startedAt,
      post_process_model: POST_PROCESS_MODEL_LABEL,
      post_process_error: null,
    })
    .eq('id', id)
    .eq('post_process_status', session.post_process_status);
  if (lockErr) {
    await refundCredits(session.org_id, session.host_user_id, 'translate', genId);
    return NextResponse.json({ error: lockErr.message }, { status: 500 });
  }

  let correctedMarkdown: string;
  let flagsCount: number;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const out = await postProcessTranscript({
      rawTranscript,
      glossary,
      reference,
      options: { smooth, canonical_name },
      sessionMeta: {
        session_id: id,
        date: today,
        src: session.source_lang,
        tgt: session.target_lang,
        speakers: speakerSet.size,
      },
    });
    correctedMarkdown = out.correctedMarkdown;
    flagsCount = out.flagsCount;
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'unknown';
    await admin
      .from('translate_sessions')
      .update({
        post_process_status: 'failed',
        post_process_error: detail.slice(0, 500),
      })
      .eq('id', id);
    await refundCredits(session.org_id, session.host_user_id, 'translate', genId);
    return NextResponse.json({ error: 'postprocess_failed', detail }, { status: 500 });
  }

  const completedAt = new Date().toISOString();
  const { error: doneErr } = await admin
    .from('translate_sessions')
    .update({
      post_process_status: 'done',
      post_process_completed_at: completedAt,
      post_process_md: correctedMarkdown,
      post_process_flags: flagsCount,
    })
    .eq('id', id);
  if (doneErr) {
    return NextResponse.json({ error: doneErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    flags_count: flagsCount,
    model: POST_PROCESS_MODEL_LABEL,
    credits_spent: POSTPROCESS_CREDITS,
  });
}

// Polling + fetch endpoint for the host console.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
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
      'id, host_user_id, post_process_status, post_process_started_at, post_process_completed_at, post_process_model, post_process_error, post_process_flags, post_process_md',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (data.host_user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  return NextResponse.json({
    post_process_status: data.post_process_status,
    post_process_started_at: data.post_process_started_at,
    post_process_completed_at: data.post_process_completed_at,
    post_process_model: data.post_process_model,
    post_process_error: data.post_process_error,
    post_process_flags: data.post_process_flags,
    post_process_md: data.post_process_md,
  });
}

// AI 동시통역 — persist finalized caption.
//
// The host browser holds the OpenAI Realtime data channel and the
// finalized transcript events. After each `completed`/`done` event it
// POSTs the segment here. We:
//   - confirm the caller is the host of the session
//   - confirm the session has record_enabled=true (host policy)
//   - insert via service role (translate_messages is server-write only)

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';
import {
  FIDELITY_LOSS_THRESHOLD,
  countReplacementChars,
  looksMojibake,
} from '@/lib/translate-fidelity';

export const runtime = 'nodejs';
export const maxDuration = 15;

const Body = z.object({
  kind: z.enum(['input', 'output']),
  text: z.string().min(1).max(8000),
  lang: z.string().min(2).max(8).optional(),
});

// Special-case payload emitted by the host console at session end. Carries
// the delta-vs-commit char drift the browser observed so we can audit
// systematic loss without standing up a second endpoint. `kind` is the
// discriminator the route reads BEFORE running the canonical Body parser.
const LossReportBody = z.object({
  kind: z.literal('__loss_report__'),
  channel: z.enum(['input', 'output']),
  deltaChars: z.number().int().min(0),
  commitChars: z.number().int().min(0),
  persistOk: z.number().int().min(0),
  persistFail: z.number().int().min(0),
  lossRatio: z.number().min(0).max(1),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const raw = (await request.json().catch(() => ({}))) as unknown;

  const { data: session, error: readErr } = await supabase
    .from('translate_sessions')
    .select('id, host_user_id, status, record_enabled, org_id')
    .eq('id', id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!session) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (session.host_user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (session.status === 'ended') {
    return NextResponse.json({ error: 'session_ended' }, { status: 410 });
  }

  // Loss-report branch — host console posts this at session end with the
  // per-channel char-drift summary. We log it to audit_log when the loss
  // crosses the threshold so the team can spot a systematic regression
  // (e.g. dedup over-eager after a new heuristic ships). No write to
  // translate_messages — this carries no transcript content.
  if (
    raw &&
    typeof raw === 'object' &&
    (raw as { kind?: unknown }).kind === '__loss_report__'
  ) {
    const lossParsed = LossReportBody.safeParse(raw);
    if (!lossParsed.success) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
    const report = lossParsed.data;
    if (report.lossRatio > FIDELITY_LOSS_THRESHOLD || report.persistFail > 0) {
      await logAudit({
        event_type: 'transcript_loss_detected',
        user_id: user.id,
        org_id: session.org_id ?? null,
        actor_email: user.email ?? null,
        resource_type: 'translate_session',
        resource_id: id,
        metadata: {
          channel: report.channel,
          delta_chars: report.deltaChars,
          commit_chars: report.commitChars,
          persist_ok: report.persistOk,
          persist_fail: report.persistFail,
          loss_ratio: report.lossRatio,
          threshold: FIDELITY_LOSS_THRESHOLD,
        },
        request,
      });
    }
    return NextResponse.json({ ok: true, audited: true });
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  if (!session.record_enabled) {
    // Host opted out of recording — accept the call but persist nothing.
    return NextResponse.json({ ok: true, recorded: false });
  }

  // UTF-8 sanity — surface replacement chars / Latin1-mojibake patterns
  // before they reach the DB. We don't reject the row (the host has no
  // way to recover the lost bytes), but the Vercel function log gives
  // ops a paper trail when a session goes wrong. Logged only when a
  // signal is present so a clean session emits nothing.
  const replacementChars = countReplacementChars(parsed.data.text);
  const mojibake = looksMojibake(parsed.data.text);
  if (replacementChars > 0 || mojibake) {
    console.warn('[translate/messages] encoding suspect on insert', {
      session_id: id,
      kind: parsed.data.kind,
      chars: parsed.data.text.length,
      replacement_chars: replacementChars,
      mojibake,
      preview: parsed.data.text.slice(0, 32),
    });
  }

  const admin = createAdminClient();
  const { error } = await admin.from('translate_messages').insert({
    session_id: id,
    kind: parsed.data.kind,
    text: parsed.data.text,
    lang: parsed.data.lang ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, recorded: true });
}

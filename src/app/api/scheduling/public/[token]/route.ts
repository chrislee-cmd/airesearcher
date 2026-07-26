// GET /api/scheduling/public/[token]   (token = project share_token)
//   → { candidate: { name }, slots: [...own], messages: [...broadcast + own] }
//
// Anon participant entry point for the recruiting-scheduling COMMON link. The
// share_token resolves the project; the signed gate cookie (set by /verify after
// a phone-tail match) yields the ONE candidate id. Every query below is scoped
// to that id server-side — the client never sends a candidate id, so another
// participant's slots or private thread can never leak (IDOR defense). Cancelled
// slots are withheld (a withdrawn time only confuses the participant). Mirrors
// the shape the admin panel consumes so the participant components can reuse the
// same helpers.
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import type { createAdminClient } from '@/lib/supabase/admin';
import {
  resolveShareToken,
  resolveCandidateInProject,
  type SchedPublicCandidate,
} from '@/lib/scheduling/public';
import {
  SCHED_MESSAGE_COLUMNS,
  SCHED_MESSAGE_COLUMNS_NARROW,
  widenNarrowMessage,
} from '@/lib/scheduling/messages';
import {
  verifyParticipantGate,
  participantGateCookieName,
} from '@/lib/scheduling/participant-gate';

export const runtime = 'nodejs';

type Admin = ReturnType<typeof createAdminClient>;

// 마지막 접속 갱신 — 5분 스로틀로 write 를 억제한다(참가자가 새로고침을 자주 해도
// 5분에 한 번만 기록). best-effort: 컬럼 미적용(update 실패)·에러 모두 조용히 삼킨다.
async function touchLastSeen(admin: Admin, candidate: SchedPublicCandidate) {
  try {
    const last = candidate.last_seen_at
      ? new Date(candidate.last_seen_at).getTime()
      : 0;
    if (Number.isFinite(last) && Date.now() - last < 5 * 60 * 1000) return;
    await admin
      .from('sched_candidates')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', candidate.id);
  } catch {
    // best-effort — 읽기를 막지 않는다.
  }
}

// `title` is surfaced so the participant's slot cards can show the free-text
// event label (BUILD-SPEC §5.5), falling back to the candidate name when blank.
const SLOT_COLUMNS =
  'id, candidate_id, title, start_at, end_at, status, location, note';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const resolved = await resolveShareToken(token);
  if ('error' in resolved) {
    return NextResponse.json(
      { error: resolved.error },
      { status: resolved.status },
    );
  }
  const { admin, project } = resolved;

  // Gate: the signed cookie must yield a candidate that still belongs to this
  // project. Without it we refuse — a leaked link alone can't read the
  // schedule/chat. Missing/invalid/expired cookie → gate_required (the client
  // shows the phone-tail gate).
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(participantGateCookieName(token))?.value;
  const gate = verifyParticipantGate(token, cookieValue);
  const candidate = gate
    ? await resolveCandidateInProject(admin, project.id, gate.candidateId)
    : null;
  if (!candidate) {
    return NextResponse.json({ error: 'gate_required' }, { status: 401 });
  }

  // 마지막 접속 갱신 — best-effort, 5분 스로틀(과도한 write 방지). 실패해도 읽기를
  // 막지 않는다. joined_at 은 여기서 건드리지 않는다(합류 스탬프는 /verify 전용).
  void touchLastSeen(admin, candidate);

  // 공지(broadcast) 수신자 집합 = 확정자(사용자 결정 2026-07-26). 미확정
  // (pending/communicating)은 전체·그룹 공지를 볼 수 없다 — 개인 스레드는 그대로
  // 유지(조율 대화는 확정 전에도 필요). 필터는 이 읽기 경로에서 서버가 강제한다.
  const isConfirmed = candidate.status === 'confirmed';

  // Own slots only, cancelled withheld. Scoped by the resolved candidate id.
  const { data: slots, error: slotErr } = await admin
    .from('sched_slots')
    .select(SLOT_COLUMNS)
    .eq('candidate_id', candidate.id)
    .neq('status', 'cancelled')
    .order('start_at', { ascending: true })
    .limit(2000);
  if (slotErr) {
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
  }

  // What this participant may see:
  //   * (확정자만) global broadcasts (batch_id null) — 전체 공지/발송
  //   * (확정자만) this candidate's group broadcasts (batch_id = their batch)
  //   * their own private thread — status 무관(조율 대화는 확정 전에도 필요)
  // Other groups' group broadcasts and other candidates' private messages are
  // never selected — group isolation + IDOR defense are both server-side here.
  // 미확정 참가자는 broadcast 절을 아예 빼고 개인 스레드만 읽는다.
  const broadcastClause = isConfirmed
    ? `and(candidate_id.is.null,batch_id.is.null),` +
      `and(candidate_id.is.null,batch_id.eq.${candidate.batch_id}),`
    : '';
  const wideFilter = `${broadcastClause}candidate_id.eq.${candidate.id}`;
  let { data: messages, error: msgErr } = await admin
    .from('sched_messages')
    .select(SCHED_MESSAGE_COLUMNS)
    .or(wideFilter)
    .order('created_at', { ascending: true })
    .limit(5000);

  // Preview DB predating the broadcast-mode columns — fall back to the pre-modes
  // read. Group scoping can't apply without the column; a confirmed participant
  // still sees every broadcast (matching legacy), an unconfirmed one only their
  // own private thread.
  if (msgErr) {
    const narrowFilter = isConfirmed
      ? `candidate_id.is.null,candidate_id.eq.${candidate.id}`
      : `candidate_id.eq.${candidate.id}`;
    const narrow = await admin
      .from('sched_messages')
      .select(SCHED_MESSAGE_COLUMNS_NARROW)
      .or(narrowFilter)
      .order('created_at', { ascending: true })
      .limit(5000);
    messages = narrow.data
      ? (narrow.data.map((r) => widenNarrowMessage(r)) as typeof messages)
      : null;
    msgErr = narrow.error;
  }
  if (msgErr) {
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
  }

  return NextResponse.json(
    {
      // Only the participant's own display name — never email/phone/batch/token.
      candidate: { name: candidate.name },
      slots: slots ?? [],
      messages: messages ?? [],
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

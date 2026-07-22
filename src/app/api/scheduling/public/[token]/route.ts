// GET /api/scheduling/public/[token]
//   → { candidate: { name }, slots: [...own], messages: [...broadcast + own] }
//
// Anon participant entry point for the recruiting-scheduling share link (PR4).
// participant_token IS the authorization. The token resolves to exactly ONE
// candidate; every query below is scoped to that candidate id server-side —
// the client never sends a candidate id, so another participant's slots or
// private thread can never leak (IDOR defense). Cancelled slots are withheld
// (a withdrawn time only confuses the participant). Mirrors the shape the admin
// panel consumes so the participant components can reuse the same helpers.
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { resolveSchedToken } from '@/lib/scheduling/public';
import {
  SCHED_MESSAGE_COLUMNS,
  SCHED_MESSAGE_COLUMNS_NARROW,
  widenNarrowMessage,
} from '@/lib/scheduling/messages';
import {
  participantGateStatus,
  participantGateCookieName,
} from '@/lib/scheduling/participant-gate';

export const runtime = 'nodejs';

const SLOT_COLUMNS = 'id, candidate_id, start_at, end_at, status, location, note';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const gate = await resolveSchedToken(token);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { admin, candidate } = gate;

  // Phone-tail gate: a candidate with a phone on file must have proved the tail
  // (valid signed cookie). Without it we refuse — a leaked link alone can't read
  // the schedule/chat. No phone on file → 'blocked' (tail can't be verified), a
  // distinct 401 code so the client shows the host-contact notice, not the gate.
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(participantGateCookieName(token))?.value;
  const gateStatus = participantGateStatus(candidate.phone, token, cookieValue);
  if (gateStatus === 'blocked') {
    return NextResponse.json({ error: 'gate_no_phone' }, { status: 401 });
  }
  if (gateStatus === 'required') {
    return NextResponse.json({ error: 'gate_required' }, { status: 401 });
  }

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
  //   * global broadcasts (batch_id null) — 전체 공지/발송
  //   * this candidate's group broadcasts (batch_id = their batch) — 그룹별
  //   * their own private thread
  // Other groups' group broadcasts and other candidates' private messages are
  // never selected — group isolation + IDOR defense are both server-side here.
  const wideFilter =
    `and(candidate_id.is.null,batch_id.is.null),` +
    `and(candidate_id.is.null,batch_id.eq.${candidate.batch_id}),` +
    `candidate_id.eq.${candidate.id}`;
  let { data: messages, error: msgErr } = await admin
    .from('sched_messages')
    .select(SCHED_MESSAGE_COLUMNS)
    .or(wideFilter)
    .order('created_at', { ascending: true })
    .limit(5000);

  // Preview DB predating the broadcast-mode columns — fall back to the pre-modes
  // read (all broadcasts + own private). Group scoping can't apply without the
  // column; every broadcast reads as a global announcement, matching legacy.
  if (msgErr) {
    const narrow = await admin
      .from('sched_messages')
      .select(SCHED_MESSAGE_COLUMNS_NARROW)
      .or(`candidate_id.is.null,candidate_id.eq.${candidate.id}`)
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

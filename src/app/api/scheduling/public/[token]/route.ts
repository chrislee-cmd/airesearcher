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
import { SCHED_MESSAGE_COLUMNS } from '@/lib/scheduling/messages';
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
  // the schedule/chat. (No phone on file → gate skipped; token scope remains.)
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(participantGateCookieName(token))?.value;
  if (participantGateStatus(candidate.phone, token, cookieValue) === 'required') {
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

  // Broadcast (candidate_id null) + this candidate's private thread only.
  // Other candidates' private messages are never selected.
  const { data: messages, error: msgErr } = await admin
    .from('sched_messages')
    .select(SCHED_MESSAGE_COLUMNS)
    .or(`candidate_id.is.null,candidate_id.eq.${candidate.id}`)
    .order('created_at', { ascending: true })
    .limit(5000);
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

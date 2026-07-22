// POST /api/scheduling/public/[token]/messages
//   { body } → inserts a private message from the participant to the admin.
//
// A participant can ONLY send private (scope='private', candidate_id = their
// own resolved id, sender_role='participant', sender_user_id=null). There is no
// way to post a broadcast or to target another candidate — the scope and
// candidate id are derived from the token server-side, never from the request
// body (IDOR / privilege defense). Mirrors the admin POST guards
// (empty/too-long body) so both sides reject the same inputs.
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { resolveSchedToken } from '@/lib/scheduling/public';
import {
  MAX_MESSAGE_LENGTH,
  SCHED_MESSAGE_COLUMNS,
} from '@/lib/scheduling/messages';
import {
  participantGateStatus,
  participantGateCookieName,
} from '@/lib/scheduling/participant-gate';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const gate = await resolveSchedToken(token);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { admin, candidate } = gate;

  // Same phone-tail gate as the read route — a leaked link can't post either.
  // No phone on file → 'blocked' (distinct code); missing/invalid cookie →
  // 'required'.
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(participantGateCookieName(token))?.value;
  const gateStatus = participantGateStatus(candidate.phone, token, cookieValue);
  if (gateStatus === 'blocked') {
    return NextResponse.json({ error: 'gate_no_phone' }, { status: 401 });
  }
  if (gateStatus === 'required') {
    return NextResponse.json({ error: 'gate_required' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const text = typeof b.body === 'string' ? b.body.trim() : '';
  if (!text) {
    return NextResponse.json({ error: 'empty_body' }, { status: 400 });
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: 'body_too_long' }, { status: 400 });
  }

  // scope/candidate_id/sender come from the token, NOT the request body.
  const { data, error } = await admin
    .from('sched_messages')
    .insert({
      candidate_id: candidate.id,
      scope: 'private',
      sender_role: 'participant',
      sender_user_id: null,
      body: text,
    })
    .select(SCHED_MESSAGE_COLUMNS)
    .single();

  if (error) {
    return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  }
  return NextResponse.json(
    { message: data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

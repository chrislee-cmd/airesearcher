// POST /api/scheduling/public/[token]/messages   (token = project share_token)
//   { body } → inserts a private message from the participant to the admin.
//
// A participant can ONLY send private (scope='private', candidate_id = their
// own resolved id, sender_role='participant', sender_user_id=null). There is no
// way to post a broadcast or to target another candidate — the scope and
// candidate id are derived from the gate cookie server-side, never from the
// request body (IDOR / privilege defense). Mirrors the admin POST guards
// (empty/too-long body) so both sides reject the same inputs.
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  resolveShareToken,
  resolveCandidateInProject,
} from '@/lib/scheduling/public';
import {
  MAX_MESSAGE_LENGTH,
  SCHED_MESSAGE_COLUMNS,
} from '@/lib/scheduling/messages';
import {
  verifyParticipantGate,
  participantGateCookieName,
} from '@/lib/scheduling/participant-gate';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
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

  // Same gate as the read route — a leaked link can't post either. The signed
  // cookie must yield a candidate still in this project; otherwise gate_required.
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(participantGateCookieName(token))?.value;
  const gate = verifyParticipantGate(token, cookieValue);
  const candidate = gate
    ? await resolveCandidateInProject(admin, project.id, gate.candidateId)
    : null;
  if (!candidate) {
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

// GET /api/ut/public/[token]
//   → { session: { id, task_goal, target_url, livekit_room, session_kind,
//                   status } }
//
// Anon participant entry point (participant page = 624). The participant opens
// the share link and this resolves the token → the session's task/goal + target
// site + LiveKit room so the page can show the task and prepare to join.
// participant_token IS the authorization; we never expose the owner or internal
// columns. Mirrors GET /api/translate/public/[token].
import { NextResponse } from 'next/server';
import { resolveUtToken } from '@/lib/ut/public';

export const runtime = 'nodejs';

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const gate = await resolveUtToken(token);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { session } = gate;
  return NextResponse.json({
    session: {
      id: session.id,
      task_goal: session.task_goal,
      target_url: session.target_url,
      livekit_room: session.livekit_room,
      session_kind: session.session_kind,
      status: session.status,
    },
  });
}

// POST /api/ut/sessions/[id]/analyze → { ok, event_count }
//
// Behavior-analytics vision post-processing (card 622). Fired by the widget once
// transcription reaches 'done': reads the stored screen recording, infers a
// QUANTITATIVE interaction-event stream (Gemini video-in), persists ut_events,
// and aggregates deterministic behavior_metrics. Quantitative only — no
// qualitative narration / clips (that is card 626).
//
// Owner OR super-admin only (gate in loadUtSession). Rate-limited per user
// because it triggers a paid vision call over a potentially large video.
// Long-running (video upload + processing), so maxDuration is generous. Analysis
// failure never fails the session — analyzeUtSession restores status 'done'.
import { NextResponse } from 'next/server';
import { loadUtSession } from '@/lib/ut/auth';
import { analyzeUtSession } from '@/lib/ut-vision/analyze';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 300; // video upload + Gemini processing can be slow

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const gate = await loadUtSession(id);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const limit = await rateLimit(gate.user.id, 'ut-analyze', 6, '1 m');
  if (!limit.success) return rateLimitResponse(limit);

  const result = await analyzeUtSession(gate.admin, id);
  if (!result.ok) {
    // A "graceful skip" (missing key / no recording) returns 200 from the
    // helper; a real failure returns its own status. Surface either without
    // implying the session itself is broken.
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, event_count: result.event_count });
}

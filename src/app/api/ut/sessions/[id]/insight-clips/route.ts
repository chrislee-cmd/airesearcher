// POST /api/ut/sessions/[id]/insight-clips → advance the insight-clip pipeline
//   one bounded step (starts it on the first call) and return the current state.
// GET  /api/ut/sessions/[id]/insight-clips → read the current state without
//   advancing (widget re-mount / initial load).
//
// The pipeline (card 626, 방식 A): 트웰브랩스 풀영상 1회 인덱싱 → Marengo/전사-LLM
// 순간 탐색 → ffmpeg 클립(ut-clips) → Pegasus 분석 → LLM 세션 리포트. Each step is
// bounded so the client can drive it by polling POST (video/jobs/poll 패턴), never
// hitting the serverless timeout for a long index/analysis.
//
// Owner OR super-admin only (gate in loadUtSession). Rate-limited because a run
// triggers paid Twelvelabs indexing + Pegasus + LLM calls over a large video.
import { NextResponse } from 'next/server';
import { loadUtSession } from '@/lib/ut/auth';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { readRequestLocale } from '@/lib/i18n/request-locale';
import {
  startInsightPipeline,
  advanceInsightPipeline,
  type InsightStatus,
} from '@/lib/ut/insight-clips';
import { buildInsightState } from './state';

export const runtime = 'nodejs';
export const maxDuration = 300; // one step can download a recording + Pegasus/LLM

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const gate = await loadUtSession(id);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const limit = await rateLimit(gate.user.id, 'ut-insight-clips', 30, '1 m');
  if (!limit.success) return rateLimitResponse(limit);

  let locale = (await readRequestLocale()) === 'ko' ? 'ko' : 'en';
  try {
    const body = (await req.json()) as { locale?: unknown };
    if (typeof body.locale === 'string') locale = body.locale === 'ko' ? 'ko' : 'en';
  } catch {}

  const { admin, session } = gate;
  const current = (session.insight_status ?? 'idle') as InsightStatus;

  // First call (or a prior hard error the researcher retries): (re)start.
  if (current === 'idle' || current === 'error') {
    const started = await startInsightPipeline(admin, session);
    if (started.status === 'error') {
      // Persist so the widget surfaces the failure (and can retry).
      await admin
        .from('ut_sessions')
        .update({ insight_status: 'error', insight_error: started.error ?? 'start_failed' })
        .eq('id', id);
    }
    return NextResponse.json(await buildInsightState(admin, id));
  }

  // Otherwise advance one bounded step.
  await advanceInsightPipeline(admin, id, locale, new Date().toISOString());
  return NextResponse.json(await buildInsightState(admin, id));
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gate = await loadUtSession(id);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  return NextResponse.json(await buildInsightState(gate.admin, id));
}

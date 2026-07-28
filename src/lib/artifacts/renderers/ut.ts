// AI UT insight export 렌더러 등록 — docx (유일한 신규 렌더러).
//
// 이동(move)이 아니라 신설: UT 는 지금까지 view-only 였다. 이 렌더러만 CD
// export-documents-BUILD-SPEC(§1 print translation + §3.4 UT, tone peach)을
// 따른다. 문서 생성기는 리스트 행이 아니라 **전체 산출물**을 읽는다(§5.2) —
// insight_summary(jsonb) + ut_clips 를 여기서 조회한다.

import { registerRenderer } from '@/lib/artifacts/export-registry';
import { buildArtifactFilename } from '@/lib/filename';
import type { ClipInsight, InsightSummary } from '@/lib/ut/insight-llm';
import {
  utInsightToDocx,
  UT_DOCX_MIME,
  type UtInsightClip,
} from '@/lib/ut/insight-docx';

registerRenderer('ut', 'docx', async (_row, ctx) => {
  // 전체 산출물 조회 — insight_summary 는 무거워 리스트 selectColumns 에 없다.
  const { data: session } = await ctx.supabase
    .from('ut_sessions')
    .select('target_url, duration_ms, insight_summary, created_at')
    .eq('id', ctx.id)
    .single();
  if (!session) return { gate: 'not_found' };

  const insightSummary =
    (session.insight_summary as InsightSummary | null) ?? null;
  // insight 파이프라인이 아직 리포트를 만들지 않았으면 문서로 낼 게 없다.
  if (!insightSummary) return { gate: 'not_ready' };

  const { data: clipRows } = await ctx.supabase
    .from('ut_clips')
    .select('start_ms, end_ms, theme, transcript_span, insight')
    .eq('session_id', ctx.id)
    .order('start_ms', { ascending: true });

  const clips: UtInsightClip[] = (clipRows ?? []).map((c) => ({
    start_ms: Number(c.start_ms ?? 0),
    end_ms: Number(c.end_ms ?? 0),
    theme: (c.theme as string | null) ?? null,
    transcript_span: (c.transcript_span as string | null) ?? null,
    insight: (c.insight as ClipInsight | null) ?? null,
  }));

  const buf = await utInsightToDocx(
    {
      target_url: (session.target_url as string | null) ?? null,
      duration_ms: (session.duration_ms as number | null) ?? null,
      insight_summary: insightSummary,
      created_at: (session.created_at as string | null) ?? null,
    },
    clips,
  );

  const filename = buildArtifactFilename({
    prefix: 'ut',
    slug: (session.target_url as string | null) ?? 'insight',
    createdAt: (session.created_at as string | null) ?? new Date(),
    ext: 'docx',
  });

  return { body: new Uint8Array(buf), mime: UT_DOCX_MIME, filename };
});

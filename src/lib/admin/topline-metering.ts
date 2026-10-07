import { createAdminClient } from '@/lib/supabase/admin';
import type { ToplineRunUsage } from '@/lib/interview-v2/topline';

// 탑라인 생성 비용 실측 리포트 — 과금 책정 선행(측정 전용). interview_toplines.usage
// jsonb(서버가 run 단위로 누적한 토큰/est_cost)를 어드민이 코드로 집계한다.
//
// 설계 원칙(§범위): **집계 뷰·SQL 집계 함수를 쓰지 않는다.** raw jsonb row 를
// 그대로 당겨와 JS 에서 센다 — est_cost 는 생성 경로(persistUsageDelta)가 이미
// 계산해 넣은 값이라, 어드민은 그 값을 집계만 한다(단일 계산 경로). 이로써
// "어드민 카드 수치 = raw jsonb 수계산" 이 정의상 일치한다.
//
// 윈도우/대상: 최근 N일(기본 30) 안에 **완료(status='done')** 되고 usage 가
// 기록된 run. 완료 run 만 세는 이유 — 가격은 "완성 보고서 1건의 COGS" 기준이라
// 중단/실패로 토큰이 반쪽만 찍힌 run 은 per-run 비용을 왜곡한다. 교차 org 전수
// (super-admin 페이지에서만 호출 — service-role).

const DEFAULT_WINDOW_DAYS = 30;

/** 모델별 토큰 소계(윈도우 전체 합산) — 어떤 단계가 비용을 끄는지 가시화. */
export type ToplineTokenTotals = {
  mapCalls: number;
  mapInputTokens: number;
  mapOutputTokens: number;
  reduceCalls: number;
  reduceInputTokens: number;
  reduceOutputTokens: number;
};

export type ToplineMeteringReport = {
  windowDays: number;
  runCount: number;
  // run 이 0건이면 통계 null(어드민이 "데이터 없음" 으로 렌더).
  cost: {
    avgUsd: number;
    medianUsd: number;
    p90Usd: number;
    totalUsd: number;
  } | null;
  docDistribution: {
    avg: number;
    median: number;
    min: number;
    max: number;
  } | null;
  tokens: ToplineTokenTotals | null;
  generatedAt: string;
};

/** 오름차순 정렬된 숫자 배열의 nearest-rank 백분위(p ∈ [0,100]). */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx];
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export async function getToplineMeteringReport(
  windowDays = DEFAULT_WINDOW_DAYS,
): Promise<ToplineMeteringReport> {
  const admin = createAdminClient();
  const since = new Date(
    Date.now() - windowDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const emptyReport = (): ToplineMeteringReport => ({
    windowDays,
    runCount: 0,
    cost: null,
    docDistribution: null,
    tokens: null,
    generatedAt: new Date().toISOString(),
  });

  const { data, error } = await admin
    .from('interview_toplines')
    .select('usage, updated_at')
    .eq('status', 'done')
    .not('usage', 'is', null)
    .gte('updated_at', since);
  if (error) {
    // 어드민 대시보드는 degrade 우선 — 마이그 미적용/쿼리 실패 시 500 대신 빈 리포트.
    console.warn('[admin/topline-metering] query failed', error.message);
    return emptyReport();
  }

  const rows = (data ?? []) as { usage: ToplineRunUsage | null }[];
  const costs: number[] = [];
  const docCounts: number[] = [];
  const tokens: ToplineTokenTotals = {
    mapCalls: 0,
    mapInputTokens: 0,
    mapOutputTokens: 0,
    reduceCalls: 0,
    reduceInputTokens: 0,
    reduceOutputTokens: 0,
  };

  for (const row of rows) {
    const u = row.usage;
    if (!u) continue;
    const cost = Number(u.est_cost_usd);
    if (Number.isFinite(cost)) costs.push(cost);
    const docCount = Number(u.doc_count);
    if (Number.isFinite(docCount) && docCount > 0) docCounts.push(docCount);
    if (u.map) {
      tokens.mapCalls += Number(u.map.calls) || 0;
      tokens.mapInputTokens += Number(u.map.input_tokens) || 0;
      tokens.mapOutputTokens += Number(u.map.output_tokens) || 0;
    }
    if (u.reduce) {
      tokens.reduceCalls += Number(u.reduce.calls) || 0;
      tokens.reduceInputTokens += Number(u.reduce.input_tokens) || 0;
      tokens.reduceOutputTokens += Number(u.reduce.output_tokens) || 0;
    }
  }

  if (costs.length === 0) return emptyReport();

  const sortedCosts = [...costs].sort((a, b) => a - b);
  const sortedDocs = [...docCounts].sort((a, b) => a - b);

  return {
    windowDays,
    runCount: costs.length,
    cost: {
      avgUsd: mean(sortedCosts),
      medianUsd: percentile(sortedCosts, 50),
      p90Usd: percentile(sortedCosts, 90),
      totalUsd: sortedCosts.reduce((a, b) => a + b, 0),
    },
    docDistribution:
      sortedDocs.length > 0
        ? {
            avg: mean(sortedDocs),
            median: percentile(sortedDocs, 50),
            min: sortedDocs[0],
            max: sortedDocs[sortedDocs.length - 1],
          }
        : null,
    tokens,
    generatedAt: new Date().toISOString(),
  };
}

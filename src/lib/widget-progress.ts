/* ────────────────────────────────────────────────────────────────────
   widget-progress — Navigator 누적 % 계산 helper.

   두 종류의 progress 가 한 위젯에 공존한다:
   - 단계 내부 progress: 현재 phase 안에서 얼마나 진행됐는지 (예: crawl
     47/240). 위젯 카드 헤더 pill 이 사용.
   - 누적 progress: 전체 단계 중 어디까지 끝났나 (0~100). Navigator 의
     widget row 가 사용.

   여기서는 누적 쪽만 다룬다. desk 전용 phase → range 매핑 + crawling
   안의 sub-progress 보간. 다른 위젯의 phase 매핑은 후속 spec.
   ──────────────────────────────────────────────────────────────────── */

export type DeskProgressInput = {
  phase?: string;
  crawl_done?: number;
  crawl_total?: number;
};

/**
 * 데스크 6 단계의 누적 % 시작/끝 범위. 비중은 평균 소요 시간에 비례 —
 * crawling / drafting 이 가장 길어서 가장 넓은 구간을 차지한다.
 *
 * 백엔드 phase 가 표 밖 값을 보내면 누적 0 으로 fallback (UI 회귀 0).
 */
export const DESK_PHASE_RANGES: Record<string, { start: number; end: number }> = {
  expanding: { start: 0, end: 8 },
  scoping: { start: 8, end: 16 },
  crawling: { start: 16, end: 50 },
  extracting: { start: 50, end: 65 },
  drafting: { start: 65, end: 85 },
  critiquing: { start: 65, end: 85 },
  synthesizing: { start: 85, end: 100 },
  summarizing: { start: 85, end: 100 },
};

/**
 * Desk 위젯의 현재 누적 진행도 (0~100, 정수).
 *
 * - phase 가 없거나 알 수 없으면 0
 * - crawling 단계는 crawl_done / crawl_total 로 sub-progress 보간 —
 *   예: phase=crawling, 47/240 → 16 + (50-16) × (47/240) ≈ 23
 * - 그 외 단계는 phase 시작값 — 단계가 끝나면 백엔드가 다음 phase 로
 *   넘어가면서 자연히 다음 시작값으로 올라간다 (전체 매핑상 인접 단계는
 *   같은 경계값을 공유).
 */
export function deskCumulativeProgress(p: DeskProgressInput): number {
  if (!p.phase) return 0;
  const range = DESK_PHASE_RANGES[p.phase];
  if (!range) return 0;

  if (p.phase === 'crawling' && p.crawl_total && p.crawl_total > 0) {
    const ratio = Math.min(1, Math.max(0, (p.crawl_done ?? 0) / p.crawl_total));
    return Math.round(range.start + (range.end - range.start) * ratio);
  }

  return range.start;
}

/**
 * Job status 까지 함께 보고 최종 0~100 결정. done = 100, error/cancelled = 0,
 * 그 외 = phase 기반 누적 %.
 */
export function deskOverallStatusProgress(
  status: string,
  progress: DeskProgressInput,
): number {
  if (status === 'done') return 100;
  if (status === 'error' || status === 'cancelled') return 0;
  return deskCumulativeProgress(progress);
}

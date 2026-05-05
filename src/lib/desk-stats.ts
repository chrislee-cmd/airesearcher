import {
  DESK_SOURCES,
  DESK_SOURCE_GROUPS,
  type DeskArticle,
  type DeskSourceGroup,
  type DeskSourceId,
} from './desk-sources';

export type CountSlice = {
  key: string;
  label: string;
  count: number;
  share: number; // 0..1
};

export type TimelineBucket = {
  /** 'YYYY-MM' for monthly buckets, 'YYYY-Wkk' for weekly */
  key: string;
  /** Display label (e.g., "2026-04") */
  label: string;
  count: number;
};

export type DeskStats = {
  total: number;
  withDate: number;
  bySource: CountSlice[];
  byGroup: CountSlice[];
  byKeyword: CountSlice[];
  /** crosstab: rows = keyword, cols = source group */
  keywordByGroup: {
    keyword: string;
    counts: Record<DeskSourceGroup, number>;
    total: number;
  }[];
  /** monthly timeline, ascending */
  timeline: TimelineBucket[];
};

const SOURCE_LABEL: Record<DeskSourceId, string> = Object.fromEntries(
  DESK_SOURCES.map((s) => [s.id, s.label]),
) as Record<DeskSourceId, string>;
const GROUP_OF: Record<DeskSourceId, DeskSourceGroup> = Object.fromEntries(
  DESK_SOURCES.map((s) => [s.id, s.group]),
) as Record<DeskSourceId, DeskSourceGroup>;

function monthKey(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}`;
}

export function computeDeskStats(articles: DeskArticle[]): DeskStats {
  const total = articles.length;

  // by source
  const sourceCounts = new Map<DeskSourceId, number>();
  // by group
  const groupCounts = new Map<DeskSourceGroup, number>();
  // by keyword (matched_keyword as logged at fetch time)
  const keywordCounts = new Map<string, number>();
  // keyword × group crosstab
  const xtab = new Map<string, Map<DeskSourceGroup, number>>();
  // timeline
  const monthCounts = new Map<string, number>();
  let withDate = 0;

  for (const a of articles) {
    sourceCounts.set(a.source, (sourceCounts.get(a.source) ?? 0) + 1);
    const g = GROUP_OF[a.source];
    if (g) groupCounts.set(g, (groupCounts.get(g) ?? 0) + 1);

    const kw = a.keyword || '(미상)';
    keywordCounts.set(kw, (keywordCounts.get(kw) ?? 0) + 1);

    if (g) {
      const row = xtab.get(kw) ?? new Map<DeskSourceGroup, number>();
      row.set(g, (row.get(g) ?? 0) + 1);
      xtab.set(kw, row);
    }

    if (a.publishedAt) {
      const k = monthKey(a.publishedAt);
      if (k) {
        withDate += 1;
        monthCounts.set(k, (monthCounts.get(k) ?? 0) + 1);
      }
    }
  }

  const toShare = (n: number) => (total === 0 ? 0 : n / total);

  const bySource: CountSlice[] = [...sourceCounts.entries()]
    .map(([key, count]) => ({
      key,
      label: SOURCE_LABEL[key as DeskSourceId] ?? key,
      count,
      share: toShare(count),
    }))
    .sort((a, b) => b.count - a.count);

  const byGroup: CountSlice[] = [...groupCounts.entries()]
    .map(([key, count]) => ({
      key,
      label: DESK_SOURCE_GROUPS[key as DeskSourceGroup].label,
      count,
      share: toShare(count),
    }))
    .sort((a, b) => b.count - a.count);

  const byKeyword: CountSlice[] = [...keywordCounts.entries()]
    .map(([key, count]) => ({ key, label: key, count, share: toShare(count) }))
    .sort((a, b) => b.count - a.count);

  const keywordByGroup = byKeyword.map((row) => {
    const counts: Record<DeskSourceGroup, number> = {
      naver: 0,
      kakao: 0,
      youtube: 0,
      global: 0,
    };
    const m = xtab.get(row.key);
    if (m) {
      for (const [g, c] of m) counts[g] = c;
    }
    return {
      keyword: row.key,
      counts,
      total: row.count,
    };
  });

  const timeline: TimelineBucket[] = [...monthCounts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, count]) => ({ key, label: key, count }));

  return {
    total,
    withDate,
    bySource,
    byGroup,
    byKeyword,
    keywordByGroup,
    timeline,
  };
}

/**
 * Render stats as a compact text block for the LLM. Forces the report writer
 * to ground percentages/counts in the same numbers the user sees on screen,
 * instead of guessing.
 */
export function statsForLLM(s: DeskStats): string {
  if (s.total === 0) return '(수집 항목 없음)';
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const lines: string[] = [];
  lines.push(`총 수집: ${s.total}건 (날짜 식별 ${s.withDate}건)`);
  lines.push('');
  lines.push('채널 그룹 비중:');
  for (const g of s.byGroup) {
    lines.push(`- ${g.label}: ${g.count}건 (${pct(g.share)})`);
  }
  lines.push('');
  lines.push('출처별 비중 (상위 8):');
  for (const r of s.bySource.slice(0, 8)) {
    lines.push(`- ${r.label}: ${r.count}건 (${pct(r.share)})`);
  }
  if (s.byKeyword.length > 1) {
    lines.push('');
    lines.push('키워드별 비중:');
    for (const k of s.byKeyword) {
      lines.push(`- ${k.label}: ${k.count}건 (${pct(k.share)})`);
    }
    lines.push('');
    lines.push('키워드 × 채널 그룹 (건수):');
    for (const row of s.keywordByGroup) {
      lines.push(
        `- ${row.keyword} → 네이버 ${row.counts.naver}, 카카오 ${row.counts.kakao}, 유튜브 ${row.counts.youtube}, 글로벌 ${row.counts.global}`,
      );
    }
  }
  if (s.timeline.length > 0) {
    lines.push('');
    lines.push('월별 발행량:');
    for (const t of s.timeline) {
      lines.push(`- ${t.label}: ${t.count}건`);
    }
  }
  return lines.join('\n');
}

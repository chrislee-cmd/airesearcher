import { env } from '@/env';
import type { DeskSourceDefinition, DeskSourceErrorReason } from './types';
import { cleanApiKey, classifyHttpStatus, safeFetch } from './helpers';

// ECOS wraps errors in `{ RESULT: { CODE, MESSAGE } }`. Classify the code so a
// bad key surfaces distinctly from a genuine "no data" instead of collapsing to
// `[]` (2026-07-06 incident class). Codes per https://ecos.bok.or.kr/api —
// INFO-100 인증키 무효 / INFO-200 데이터 없음 / INFO-300 일별 허용량 초과.
function classifyEcosCode(code: string): DeskSourceErrorReason | undefined {
  if (code === 'INFO-100') return 'invalid_key';
  if (code === 'INFO-300') return 'rate_limited';
  if (code === 'INFO-200') return undefined; // 해당 데이터 없음 = genuine empty
  return 'fetch_failed';
}

// Bank of Korea ECOS (한국은행 경제통계시스템). Free key at
// https://ecos.bok.or.kr/api/ . We hit `StatisticTableList` — the catalog of
// statistic tables (GDP / 금리 / 환율 / 물가 …) — and keyword-filter the table
// names client-side, since that endpoint has no server-side text search. The
// resulting DeskArticle links straight to the ECOS viewer for each table.
//
// Region-agnostic in signature but `regionOnly: ['KR']` in the definition: this
// is Korea-only economic data, so the picker hides it off-region.
type EcosTableRow = {
  STAT_CODE?: string;
  STAT_NAME?: string;
  CYCLE?: string; // 수록주기: A(연) / Q(분기) / M(월) / D(일) …
  SRCH_YN?: string; // 검색가능 여부: 'Y' | 'N'
};

export const bojEcos: DeskSourceDefinition = {
  id: 'boj_ecos',
  category: 'stats',
  group: 'bok',
  label: '한국은행 ECOS',
  labelEn: 'Bank of Korea Economic Statistics',
  hint: 'GDP/금리/환율/물가 시계열',
  regionOnly: ['KR'],
  envKeys: ['ECOS_API_KEY'],
  async fetch({ keyword, limit }) {
    const key = cleanApiKey(env.ECOS_API_KEY);
    if (!key) return [];
    // ECOS paginates 1-indexed inclusive: /start/end/. The endpoint has no
    // server-side text search, so we must pull the WHOLE catalog and filter
    // locally. The catalog is ~900 stat tables — capping the pull at `limit`
    // (as the old code did) fetched only the first ~15 rows in market mode and
    // the keyword filter almost always matched 0 (same class of bug as the old
    // DART feed-filter). CATALOG_SPAN over-covers the catalog; we slice to
    // `limit` AFTER filtering.
    const CATALOG_SPAN = 1000;
    const url = `https://ecos.bok.or.kr/api/StatisticTableList/${key}/json/kr/1/${CATALOG_SPAN}/`;
    const res = await safeFetch(url, undefined, 15_000);
    if (!res.ok) return { articles: [], error: classifyHttpStatus(res.status) };
    // ECOS returns 200 with a `{ RESULT: { CODE, MESSAGE } }` envelope on error
    // (bad key, quota, no rows). Guard the parse + the expected shape so a bad
    // response doesn't poison the whole crawl — and classify the error so a bad
    // key doesn't hide behind a silent "0건".
    let json: {
      StatisticTableList?: { row?: EcosTableRow[] };
      RESULT?: { CODE?: string; MESSAGE?: string };
    };
    try {
      json = (await res.json()) as typeof json;
    } catch {
      return { articles: [], error: 'fetch_failed' };
    }
    if (json.RESULT?.CODE) {
      const error = classifyEcosCode(json.RESULT.CODE);
      if (error) console.error('[boj_ecos] API error', json.RESULT.CODE, json.RESULT.MESSAGE);
      return { articles: [], error };
    }
    const rows = json.StatisticTableList?.row ?? [];
    return rows
      .filter((r) => r.STAT_NAME?.includes(keyword))
      .map((r) => ({
        source: 'boj_ecos' as const,
        title: r.STAT_NAME ?? '',
        url: `https://ecos.bok.or.kr/#/SearchStat?statCode=${r.STAT_CODE ?? ''}`,
        snippet: `${r.SRCH_YN === 'Y' ? '검색가능' : '표만'}${r.CYCLE ? ` · ${r.CYCLE}` : ''}`,
        keyword,
      }))
      .filter((a) => a.title)
      .slice(0, limit);
  },
};

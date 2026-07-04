import { env } from '@/env';
import type { DeskArticle, DeskSourceDefinition } from './types';
import { safeFetch } from './helpers';

// KOSIS (통계청) statisticsList open API. Free key, KR-only market/industry
// statistics — used for TAM/SAM sizing. `method=getList` searches the statistic
// table catalog by keyword (`searchNm`) and returns a JSON array of table nodes.
// Docs: https://kosis.kr/openapi/
type KosisItem = {
  LIST_NM?: string; // statistic (table) name
  ORG_ID?: string; // publishing org id
  TBL_ID?: string; // table id — pairs with ORG_ID to open the table page
  ORG_NM?: string; // publishing org name
  PRD_SE?: string; // period unit (연/월/분기 …)
  LST_CHN_DE?: string; // last-changed date (YYYY-MM-DD)
};

export const kosis: DeskSourceDefinition = {
  id: 'kosis',
  category: 'stats',
  group: 'kosis',
  label: '통계청 KOSIS',
  labelEn: 'KOSIS (Korea Statistics)',
  hint: '국내 공식 통계 (인구/산업/소비)',
  regionOnly: ['KR'],
  envKeys: ['KOSIS_API_KEY'],
  async fetch({ keyword, limit }) {
    const key = env.KOSIS_API_KEY;
    if (!key) return [];
    const params = new URLSearchParams({
      method: 'getList',
      apiKey: key,
      format: 'json',
      jsonVD: 'Y',
      searchNm: keyword,
      pageNo: '1',
      pageSize: String(Math.min(100, Math.max(1, limit))),
    });
    const res = await safeFetch(
      `https://kosis.kr/openapi/statisticsList.do?${params}`,
      undefined,
      15_000,
    );
    if (!res.ok) return [];
    // KOSIS answers 200 with an `{ err, errMsg }` object (not an array) on a bad
    // key or empty result. Guard the parse and the shape so a bad response can't
    // poison the whole job.
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return [];
    }
    if (!Array.isArray(json)) return [];
    const items = json as KosisItem[];
    return items
      .map((item) => ({
        source: 'kosis' as const,
        title: item.LIST_NM ?? '',
        url:
          item.ORG_ID && item.TBL_ID
            ? `https://kosis.kr/statHtml/statHtml.do?orgId=${item.ORG_ID}&tblId=${item.TBL_ID}`
            : '',
        snippet: [item.ORG_NM, item.PRD_SE].filter(Boolean).join(' · ') || undefined,
        publishedAt: item.LST_CHN_DE || undefined,
        origin: item.ORG_NM,
        keyword,
      } satisfies DeskArticle))
      .filter((a) => a.title && a.url)
      .slice(0, limit);
  },
};

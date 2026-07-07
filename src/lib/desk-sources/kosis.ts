import { env } from '@/env';
import type {
  DeskArticle,
  DeskSourceDefinition,
  DeskSourceErrorReason,
} from './types';
import { cleanApiKey, classifyHttpStatus, safeFetch } from './helpers';

// KOSIS answers 200 with `{ err, errMsg }` on any problem. Classify the err code
// so the crawl can distinguish a bad key from a genuine "no data" (2026-07-06
// incident: err=11 invalid key was returning `[]`, latent for days). Codes per
// https://kosis.kr/openapi — key/auth vs quota vs no-data. Unknown codes fall
// through to fetch_failed rather than being swallowed silently.
function classifyKosisErr(code: string): DeskSourceErrorReason | undefined {
  if (['10', '11', '12', '32'].includes(code)) return 'invalid_key'; // 미등록/무효/중지/키없음
  if (['20', '21', '22'].includes(code)) return 'rate_limited'; // 요청·사용 한도 초과
  if (['30', '31'].includes(code)) return undefined; // 해당 자료 없음 = genuine empty
  return 'fetch_failed';
}

// KOSIS (통계청) statisticsSearch open API. Free key, KR-only market/industry
// statistics — used for TAM/SAM sizing. `method=getList` on statisticsSearch.do
// runs a server-side keyword search (`searchNm`) over the statistic table catalog
// and returns a JSON array of matching tables.
//
// NOTE: the sibling endpoint `statisticsList.do` is a *tree-browse* API only
// (requires vwCd + parentListId, has no text search) — passing searchNm to it
// returns err=20 or silently ignores the term and returns root categories. That
// mismatch is why KOSIS harvested 0 rows even with a valid key (2026-07-06 probe).
// Docs: https://kosis.kr/openapi/
type KosisItem = {
  TBL_NM?: string; // statistic (table) name
  ORG_ID?: string; // publishing org id
  TBL_ID?: string; // table id — pairs with ORG_ID to open the table page
  ORG_NM?: string; // publishing org name
  MT_ATITLE?: string; // classification path ("보건 > 화장품산업현황 > …")
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
    const key = cleanApiKey(env.KOSIS_API_KEY);
    if (!key) return [];
    const params = new URLSearchParams({
      method: 'getList',
      apiKey: key,
      format: 'json',
      jsonVD: 'Y',
      searchNm: keyword,
      startCount: '1',
      resultCount: String(Math.min(100, Math.max(1, limit))),
    });
    const res = await safeFetch(
      `https://kosis.kr/openapi/statisticsSearch.do?${params}`,
      undefined,
      15_000,
    );
    if (!res.ok) {
      return { articles: [], error: classifyHttpStatus(res.status) };
    }
    // KOSIS answers 200 with an `{ err, errMsg }` object (not an array) on a bad
    // key or empty result. Guard the parse and the shape so a bad response can't
    // poison the whole job.
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { articles: [], error: 'fetch_failed' };
    }
    if (!Array.isArray(json)) {
      // KOSIS 는 무효 키/파라미터 오류도 200 + {err, errMsg} 로 답한다. 조용히
      // 삼키면 "0건"과 구분이 안 돼 키 문제가 은폐된다 (2026-07-06 market
      // 회귀에서 err=11 무효 키가 이 경로로 잠복). 이제 분류된 error 로
      // job 리포트까지 전달한다 (함수 로그도 유지).
      const errObj = json as { err?: string; errMsg?: string };
      if (errObj?.err) {
        // 구조화 디버그 로그(2026-07-08): 컴파일된 검색어 + err 코드 + 분류를
        // 함께 남긴다. err=30/31(자료 없음)은 genuine empty 라 error=undefined 로
        // 조용히 비지만, 무슨 검색어가 어떤 err 로 0건인지는 로그로 추적 가능.
        // 키/한도 오류는 error-level(Vercel 알림), 자료 없음은 info. 키는 로그에 없음.
        const reason = classifyKosisErr(errObj.err);
        const log = reason ? console.error : console.info;
        log(
          `[desk-debug] kosis — searchNm=${keyword} err=${errObj.err} reason=${reason ?? 'no_data'} msg=${errObj.errMsg ?? ''}`,
        );
        return { articles: [], error: reason };
      }
      return { articles: [] };
    }
    const items = json as KosisItem[];
    const out = items
      .map((item) => ({
        source: 'kosis' as const,
        title: item.TBL_NM ?? '',
        url:
          item.ORG_ID && item.TBL_ID
            ? `https://kosis.kr/statHtml/statHtml.do?orgId=${item.ORG_ID}&tblId=${item.TBL_ID}`
            : '',
        // MT_ATITLE = classification path ("보건 > 화장품산업현황 > …") — carries
        // more table context than the period unit did. statisticsSearch.do has no
        // last-changed date field, so publishedAt is omitted (STRT/END_PRD_DE are
        // data-coverage years, not a publish date — intentionally not mapped).
        snippet: [item.ORG_NM, item.MT_ATITLE].filter(Boolean).join(' · ') || undefined,
        origin: item.ORG_NM,
        keyword,
      } satisfies DeskArticle))
      .filter((a) => a.title && a.url)
      .slice(0, limit);
    // 구조화 디버그 로그: 컴파일된 검색어당 raw 응답 건수 vs url/title 필터 후
    // 최종 건수. 배열은 왔는데 0건이면 "카탈로그에 있으나 필터로 다 빠짐"인지
    // "애초에 매칭 0"인지 이 로그로 구분한다 (무음 0건 추적).
    console.info(
      `[desk-debug] kosis — searchNm=${keyword} raw=${items.length} kept=${out.length}`,
    );
    return out;
  },
};

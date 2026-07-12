import { env } from '@/env';
import type {
  DeskArticle,
  DeskSourceDefinition,
  DeskSourceErrorReason,
} from './types';
import { cleanApiKey, classifyHttpStatus, safeFetch } from './helpers';
import { broadenStatTerm } from '@/lib/desk-source-classes';

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

// statisticsSearch.do gives the table *catalog* (name/link/path) but no cell
// values — the TAM row therefore stayed permanently "—" because policy forbids
// the LLM from inventing numbers (2026-07-08 diagnosis, #822). To surface the
// actual figure we make a 2nd call per top table to `Param/statisticsParameterData.do`,
// which returns the latest-period rows with the value in `DT`.
//
// Why this endpoint (probe-confirmed 2026-07-08): plain `statisticsData.do?method=getList`
// rejects `itmId=ALL&objL1=ALL` with err=20 (required-var missing) — it wants the
// exact item/object codes, which would force an extra `getMeta` round-trip per
// table. `Param/statisticsParameterData.do` accepts `ALL` and returns every
// item×classification row in one call, so we resolve item/object codes
// client-side and stay within the 15s task cap (one value call per table, run in
// parallel).
type KosisValueRow = {
  DT?: string; // the numeric value ("175426")
  UNIT_NM?: string; // unit ("억원", "천원", "%" …)
  PRD_DE?: string; // period ("2024")
  ITM_NM?: string; // item name ("금액", "국내판매액" …)
  C1_NM?: string; // level-1 classification name ("합계", "기초화장용 제품류" …)
};

// Top K search hits to enrich with values. Kept low (spec allowed 2~3): each
// table adds a KOSIS daily-quota hit, and the value calls race the same 15s task
// cap as the search. K=2 covers the two most-relevant tables (search returns in
// relevance order, so rank-1 is the headline production/sales total) while
// leaving headroom under the cap. Conservative reading of the 2~3 range.
const VALUE_TABLE_COUNT = 2;
// Search must finish well under the 15s crawl cap so the parallel value calls
// can still run inside it. 9s is generous for KOSIS search yet leaves ~5s for
// the value round-trips (search then values → worst case ≈14s < 15s cap).
const SEARCH_TIMEOUT_MS = 9_000;
const VALUE_TIMEOUT_MS = 5_000;

// Classification names that denote a total/aggregate row — the representative
// figure an analyst cites for TAM. Preferred over any single sub-category.
const TOTAL_NAMES = ['합계', '계', '전체', '총계', '소계', '총합'];

function toNum(dt: string | undefined): number | null {
  if (dt == null) return null;
  const raw = String(dt).replace(/,/g, '').trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// Pick the single row that best represents the table's headline figure:
// prefer a total(합계) classification, then a monetary/quantity unit over a
// share(%)/ratio(율), then the largest value (top-level totals dominate). Never
// fabricates — it only selects among rows KOSIS actually returned.
function pickRepresentative(
  rows: KosisValueRow[],
): KosisValueRow | undefined {
  const withVal = rows.filter((r) => toNum(r.DT) != null);
  if (!withVal.length) return undefined;
  const isTotal = (r: KosisValueRow) =>
    TOTAL_NAMES.includes((r.C1_NM ?? '').trim());
  const isMonetary = (r: KosisValueRow) => {
    const u = r.UNIT_NM ?? '';
    return !!u && !u.includes('%') && !u.includes('율');
  };
  const score = (r: KosisValueRow) => (isTotal(r) ? 2 : 0) + (isMonetary(r) ? 1 : 0);
  return [...withVal].sort((a, b) => {
    const s = score(b) - score(a);
    if (s !== 0) return s;
    return (toNum(b.DT) ?? 0) - (toNum(a.DT) ?? 0);
  })[0];
}

// "최신값 175,426 억원 (금액 합계, 2024)" — value + unit + item/classification +
// period, so the LLM can transcribe an explicit figure into the TAM table. The
// classification name is carried verbatim so a non-total figure is never
// misread as the whole-market total.
function formatValue(r: KosisValueRow): string | null {
  const n = toNum(r.DT);
  if (n == null) return null;
  const num = n.toLocaleString('ko-KR');
  const unit = (r.UNIT_NM ?? '').trim();
  const itm = (r.ITM_NM ?? '').trim();
  const cls = (r.C1_NM ?? '').trim();
  const yr = (r.PRD_DE ?? '').trim();
  const label = [itm, cls].filter(Boolean).join(' ');
  const paren = [label, yr].filter(Boolean).join(', ');
  return `최신값 ${num}${unit ? ` ${unit}` : ''}${paren ? ` (${paren})` : ''}`;
}

// 2nd call: pull the latest-period rows for one table and format the
// representative value. Fully degrade-safe — any failure (network, non-array
// {err}, no numeric row) returns null so the catalog link is kept unchanged
// (regression 0). Structured debug log (key never printed) keeps 무음 0건 traceable.
async function fetchLatestValue(
  orgId: string,
  tblId: string,
  key: string,
): Promise<string | null> {
  const params = new URLSearchParams({
    method: 'getList',
    apiKey: key,
    format: 'json',
    jsonVD: 'Y',
    itmId: 'ALL',
    objL1: 'ALL',
    prdSe: 'Y', // 최신 1기간 (연). 비연간 표는 값 없이 카탈로그 링크로 degrade.
    newEstPrdCnt: '1',
    orgId,
    tblId,
  });
  let res: Response;
  try {
    res = await safeFetch(
      `https://kosis.kr/openapi/Param/statisticsParameterData.do?${params}`,
      undefined,
      VALUE_TIMEOUT_MS,
    );
  } catch {
    console.info(`[desk-debug] kosis value — tbl=${tblId} fetch_error`);
    return null;
  }
  if (!res.ok) {
    console.info(`[desk-debug] kosis value — tbl=${tblId} http=${res.status}`);
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(await res.text());
  } catch {
    console.info(`[desk-debug] kosis value — tbl=${tblId} parse_error`);
    return null;
  }
  if (!Array.isArray(json)) {
    // {err,…} — bad params / no data for prdSe=Y / etc. Degrade to catalog link.
    const err = (json as { err?: string })?.err;
    console.info(`[desk-debug] kosis value — tbl=${tblId} err=${err ?? 'shape'}`);
    return null;
  }
  const rep = pickRepresentative(json as KosisValueRow[]);
  const value = rep ? formatValue(rep) : null;
  console.info(
    `[desk-debug] kosis value — tbl=${tblId} rows=${json.length} value=${value ? 'y' : 'n'}`,
  );
  return value;
}

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

    type BuiltPair = { item: KosisItem; article: DeskArticle };
    // 한 검색어로 statisticsSearch.do 를 1회 조회한다. hardStop=true 는 "broaden
    // 재시도가 무의미" 신호 — http 오류 / 파싱 실패 / 무효 키·한도 초과(재시도해도
    // 같은 오류)거나, 이미 결과가 잡힌 경우다. genuine 0건(err=30/31 또는 빈 배열)
    // 만 hardStop=false 라 상위어 재시도로 넘어간다.
    const searchOnce = async (
      q: string,
    ): Promise<{ built: BuiltPair[]; error?: DeskSourceErrorReason; hardStop: boolean }> => {
      const params = new URLSearchParams({
        method: 'getList',
        apiKey: key,
        format: 'json',
        jsonVD: 'Y',
        searchNm: q,
        startCount: '1',
        resultCount: String(Math.min(100, Math.max(1, limit))),
      });
      const res = await safeFetch(
        `https://kosis.kr/openapi/statisticsSearch.do?${params}`,
        undefined,
        SEARCH_TIMEOUT_MS,
      );
      if (!res.ok) {
        return { built: [], error: classifyHttpStatus(res.status), hardStop: true };
      }
      // KOSIS answers 200 with an `{ err, errMsg }` object (not an array) on a bad
      // key or empty result. Guard the parse and the shape so a bad response can't
      // poison the whole job.
      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return { built: [], error: 'fetch_failed', hardStop: true };
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
            `[desk-debug] kosis — searchNm=${q} err=${errObj.err} reason=${reason ?? 'no_data'} msg=${errObj.errMsg ?? ''}`,
          );
          // 키/한도/미지 오류(reason 존재)면 재시도 무의미 = hardStop. 자료 없음
          // (reason undefined)만 broaden 재시도 대상.
          return { built: [], error: reason, hardStop: reason !== undefined };
        }
        return { built: [], hardStop: false };
      }
      const items = json as KosisItem[];
      // Build (article, source-item) pairs so the top-K value enrichment can reach
      // ORG_ID/TBL_ID after filtering — the DeskArticle itself doesn't carry them.
      const built = items
        .map((item) => ({
          item,
          article: {
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
            snippet:
              [item.ORG_NM, item.MT_ATITLE].filter(Boolean).join(' · ') || undefined,
            origin: item.ORG_NM,
            keyword: q,
            // 통계 primary 근거 — market mode 샘플링이 통계 테이블 행을 뉴스 사이에서
            // dropout 시키지 않도록 pin 대상으로 표시 ("시장 통계" 섹션 생존 보장).
            kind: 'metric' as const,
          } satisfies DeskArticle,
        }))
        .filter((b) => b.article.title && b.article.url)
        .slice(0, limit);
      // 구조화 디버그 로그: 컴파일된 검색어당 raw 응답 건수 vs url/title 필터 후
      // 최종 건수. 배열은 왔는데 0건이면 "카탈로그에 있으나 필터로 다 빠짐"인지
      // "애초에 매칭 0"인지 이 로그로 구분한다 (무음 0건 추적).
      console.info(
        `[desk-debug] kosis — searchNm=${q} raw=${items.length} kept=${built.length}`,
      );
      return { built, hardStop: built.length > 0 };
    };

    const first = await searchOnce(keyword);
    let built = first.built;
    let error = first.error;
    // broaden-on-empty (spec A): statTerm 이 genuine 0건이면 상위 카테고리어로
    // **최대 1회** 재시도해 recall 을 올린다. parseDeskQuery 가 가끔 "스킨케어
    // 시장"/"…산업현황" 처럼 수식·범주 접미어가 붙은 채 컴파일해 카탈로그에서
    // 0건 나는 게 빈값의 직접 원인 — 접미어를 뗀 넓은 명사로 한 번 더 시도한다.
    // 추가 LLM 콜 X. 재시도는 딱 1회로 제한(KOSIS daily-quota 낭비 방지).
    if (!built.length && !first.hardStop) {
      const broader = broadenStatTerm(keyword);
      if (broader && broader !== keyword) {
        console.info(`[desk-debug] kosis — broaden searchNm=${keyword} → ${broader}`);
        const retry = await searchOnce(broader);
        built = retry.built;
        error = retry.error;
      }
    }
    if (!built.length) {
      return error ? { articles: [], error } : { articles: [] };
    }

    // 2단: 상위 K개 표에 실제 최신값을 병렬로 당겨 snippet 에 담는다. 실패는
    // null 로 degrade → 카탈로그 링크만 유지(회귀 0). 병렬이라 값 조회가 wall-clock
    // 을 K배 늘리지 않는다.
    const targets = built
      .slice(0, VALUE_TABLE_COUNT)
      .filter((b) => b.item.ORG_ID && b.item.TBL_ID);
    if (targets.length) {
      const values = await Promise.all(
        targets.map((b) =>
          fetchLatestValue(b.item.ORG_ID as string, b.item.TBL_ID as string, key),
        ),
      );
      targets.forEach((b, i) => {
        const v = values[i];
        if (v) {
          b.article.snippet = [b.article.snippet, v]
            .filter(Boolean)
            .join(' · ');
        }
      });
    }

    const out = built.map((b) => b.article);
    console.info(`[desk-debug] kosis — kept=${out.length} valued=${targets.length}`);
    return out;
  },
};

import { env } from '@/env';
import type {
  DeskArticle,
  DeskSourceDefinition,
  DeskSourceErrorReason,
} from './types';
import { cleanApiKey, classifyHttpStatus, safeFetch } from './helpers';

// e-Stat (일본 정부 통계포털 api.e-stat.go.jp) — **국내 KOSIS 소스(kosis.ts)의 일본
// 등가**. KOSIS 와 동일 2단 패턴을 그대로 재사용한다:
//   1) getStatsList?searchWord= → 통계표 카탈로그를 키워드로 서버사이드 검색.
//   2) 상위 K개 표에 getStatsData?statsDataId= 로 최신값을 병렬 조회해 snippet 에
//      실제 수치를 담는다(값이 없으면 카탈로그 링크만 — 회귀 0).
// JP 전용, ESTAT_APP_ID(appId) 필요 → 미설정 시 소스 자동 비활성(envKeys 게이트).
// 정책: 소스가 준 명시 값만 옮긴다(LLM 수치 생성 금지). 구조화 디버그 로그(키/appId
// 는 절대 로그에 없음)로 무음 0건을 추적한다.
//
// Docs: https://www.e-stat.go.jp/api/ (REST v3.0, JSON).

const API_BASE = 'https://api.e-stat.go.jp/rest/3.0/app/json';

// e-Stat 은 HTTP 200 + `RESULT.STATUS` 로 결과를 알린다(KOSIS 의 {err} 봉투와 동형).
//   STATUS 0        = 정상(0건 히트도 0)
//   그 외           = API 레벨 오류. 코드가 버전마다 흔들려 ERROR_MSG substring 으로
//                     분류한다(appId/認証 → invalid_key, 上限/制限 → rate_limited).
// STATUS 1(該当データ無し, getStatsData)은 genuine empty 라 undefined 로 조용히 비운다.
function classifyEstatStatus(
  status: number,
  msg: string,
): DeskSourceErrorReason | undefined {
  if (status === 0 || status === 1) return undefined; // 정상 / 데이터 없음
  const m = (msg ?? '').toLowerCase();
  if (m.includes('appid') || m.includes('アプリケーション') || m.includes('認証')) {
    return 'invalid_key';
  }
  if (m.includes('上限') || m.includes('制限') || m.includes('limit')) {
    return 'rate_limited';
  }
  return 'fetch_failed';
}

// getStatsList 응답의 한 통계표. TITLE / STAT_NAME / GOV_ORG 는 e-Stat 이 때로 문자열,
// 때로 {@code,$} 객체로 준다 — 아래 `estatText` 로 흡수한다. @id 가 statsDataId.
type EstatTableInf = {
  '@id'?: string;
  STAT_NAME?: EstatField;
  GOV_ORG?: EstatField;
  STATISTICS_NAME?: EstatField;
  TITLE?: EstatField;
  CYCLE?: EstatField;
  SURVEY_DATE?: EstatField;
  OPEN_DATE?: EstatField;
};
type EstatField = string | number | { '@code'?: string; '@no'?: string; $?: string } | undefined;

// getStatsData 응답의 한 관측치. `$` 가 값 문자열("12345" / "-" / "***"). @unit 단위,
// @time 시간코드("2020000000" → 2020). 카테고리 코드(@cat01 등)는 메타 없이 해석
// 불가라 대표값 선택엔 쓰지 않는다(값·단위·시간만으로 정직한 스니펫을 만든다).
type EstatValueRow = {
  '@unit'?: string;
  '@time'?: string;
  $?: string;
};

// 상위 K개 표에만 값을 붙인다(KOSIS 와 동일 상수). 각 표가 getStatsData 호출 1회를
// 추가하고 task cap(15s)을 공유하므로 낮게 유지 — 검색은 관련도순이라 rank-1/2 가
// headline 통계다.
const VALUE_TABLE_COUNT = 2;
const SEARCH_TIMEOUT_MS = 9_000;
const VALUE_TIMEOUT_MS = 5_000;
// getStatsData 로 당길 관측치 상한 — 최신 시점 몇 개만 있으면 대표값을 고른다.
const VALUE_LIMIT = 100;

// e-Stat 필드는 문자열이거나 {$} 객체 — 표시 텍스트만 뽑는다.
function estatText(f: EstatField): string {
  if (f == null) return '';
  if (typeof f === 'string') return f.trim();
  if (typeof f === 'number') return String(f);
  return (f.$ ?? '').trim();
}

// 단일 히트면 e-Stat 이 배열 대신 객체를 줄 수 있다 — 항상 배열로 정규화.
function toArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// 값 문자열 → number. e-Stat 결측 표기("-", "***", "…", "X", 공백)는 null.
function toNum(dt: string | undefined): number | null {
  if (dt == null) return null;
  const raw = String(dt).replace(/,/g, '').trim();
  if (!raw || /^[-*…xX.]+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// @time 코드("2020000000" / "202003...") → 연도. 앞 4자리가 연.
function timeYear(t: string | undefined): string {
  const m = /^(\d{4})/.exec(t ?? '');
  return m ? m[1] : '';
}

// 대표 관측치: 최신 시점(@time desc) 우선, 같은 시점이면 큰 값(총계가 지배). 메타
// 없이 카테고리 총계를 확정할 수 없으므로 "최신·최대"라는 보수적 규칙으로 고른다 —
// 수치를 만들지 않고 소스가 준 행 중에서만 선택한다.
function pickRepresentative(rows: EstatValueRow[]): EstatValueRow | undefined {
  const withVal = rows.filter((r) => toNum(r.$) != null);
  if (!withVal.length) return undefined;
  return [...withVal].sort((a, b) => {
    const ta = timeYear(a['@time']);
    const tb = timeYear(b['@time']);
    if (ta !== tb) return tb.localeCompare(ta); // 최신 연도 우선
    return (toNum(b.$) ?? 0) - (toNum(a.$) ?? 0); // 큰 값 우선
  })[0];
}

// "최신값 12,345 人 (2020)" — 값 + 단위 + 연도. 보고서 LLM 이 명시 수치를 그대로
// 옮겨 쓰게 한다. 결측(숫자 아님)이면 null → 카탈로그 링크만 유지.
function formatValue(r: EstatValueRow): string | null {
  const n = toNum(r.$);
  if (n == null) return null;
  const num = n.toLocaleString('ja-JP');
  const unit = (r['@unit'] ?? '').trim();
  const yr = timeYear(r['@time']);
  const paren = yr ? ` (${yr})` : '';
  return `最新値 ${num}${unit ? ` ${unit}` : ''}${paren}`;
}

// 2단: 한 통계표의 최신값을 당겨 대표값을 문자열로. 실패(네트워크/오류봉투/무값)는
// null 로 degrade — 카탈로그 링크만 유지(회귀 0). 구조화 로그로 무음 0건 추적.
async function fetchLatestValue(
  statsDataId: string,
  appId: string,
): Promise<string | null> {
  const params = new URLSearchParams({
    appId,
    statsDataId,
    metaGetFlg: 'N', // 메타(분류명) 불필요 — 값·단위·시간만
    cntGetFlg: 'N',
    limit: String(VALUE_LIMIT),
  });
  let res: Response;
  try {
    res = await safeFetch(`${API_BASE}/getStatsData?${params}`, undefined, VALUE_TIMEOUT_MS);
  } catch {
    console.info(`[desk-debug] estat value — id=${statsDataId} fetch_error`);
    return null;
  }
  if (!res.ok) {
    console.info(`[desk-debug] estat value — id=${statsDataId} http=${res.status}`);
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(await res.text());
  } catch {
    console.info(`[desk-debug] estat value — id=${statsDataId} parse_error`);
    return null;
  }
  const data = (json as { GET_STATS_DATA?: EstatGetStatsData }).GET_STATS_DATA;
  const status = data?.RESULT?.STATUS;
  if (typeof status === 'number' && status !== 0) {
    console.info(`[desk-debug] estat value — id=${statsDataId} status=${status}`);
    return null;
  }
  const rows = toArray(data?.STATISTICAL_DATA?.DATA_INF?.VALUE);
  const rep = pickRepresentative(rows);
  const value = rep ? formatValue(rep) : null;
  console.info(
    `[desk-debug] estat value — id=${statsDataId} rows=${rows.length} value=${value ? 'y' : 'n'}`,
  );
  return value;
}

type EstatResult = { STATUS?: number; ERROR_MSG?: string };
type EstatGetStatsList = {
  RESULT?: EstatResult;
  DATALIST_INF?: { NUMBER?: number; TABLE_INF?: EstatTableInf | EstatTableInf[] };
};
type EstatGetStatsData = {
  RESULT?: EstatResult;
  STATISTICAL_DATA?: { DATA_INF?: { VALUE?: EstatValueRow | EstatValueRow[] } };
};

export const estat: DeskSourceDefinition = {
  id: 'estat',
  category: 'stats',
  group: 'estat',
  label: 'e-Stat 일본통계',
  labelEn: 'e-Stat (Japan Statistics)',
  hint: '일본 공식 통계 (인구/산업/소비) — KOSIS 의 일본 등가',
  regionOnly: ['JP'],
  envKeys: ['ESTAT_APP_ID'],
  async fetch({ keyword, limit }) {
    const appId = cleanApiKey(env.ESTAT_APP_ID);
    if (!appId) return [];
    const params = new URLSearchParams({
      appId,
      searchWord: keyword,
      limit: String(Math.min(100, Math.max(1, limit))),
    });
    const res = await safeFetch(
      `${API_BASE}/getStatsList?${params}`,
      undefined,
      SEARCH_TIMEOUT_MS,
    );
    if (!res.ok) {
      return { articles: [], error: classifyHttpStatus(res.status) };
    }
    let json: { GET_STATS_LIST?: EstatGetStatsList };
    try {
      json = JSON.parse(await res.text());
    } catch {
      return { articles: [], error: 'fetch_failed' };
    }
    const list = json.GET_STATS_LIST;
    const status = list?.RESULT?.STATUS ?? -1;
    if (status !== 0) {
      // KOSIS 와 동일 정책: 오류를 조용히 [] 로 삼키면 "0건"과 구분 안 돼 appId 문제가
      // 은폐된다. 분류된 error 로 job 리포트까지 전달(키/appId 는 로그에 없음).
      const reason = classifyEstatStatus(status, list?.RESULT?.ERROR_MSG ?? '');
      const log = reason ? console.error : console.info;
      log(
        `[desk-debug] estat — searchWord=${keyword} status=${status} reason=${reason ?? 'no_data'} msg=${list?.RESULT?.ERROR_MSG ?? ''}`,
      );
      return { articles: [], error: reason };
    }

    const tables = toArray(list?.DATALIST_INF?.TABLE_INF);
    // (article, statsDataId) 쌍으로 빌드해 상위 K 값 enrichment 가 @id 에 닿게 한다.
    const built = tables
      .map((t) => {
        const id = (t['@id'] ?? '').trim();
        const statName = estatText(t.STAT_NAME);
        const title = estatText(t.TITLE);
        const govOrg = estatText(t.GOV_ORG);
        const openDate = estatText(t.OPEN_DATE);
        return {
          id,
          article: {
            source: 'estat' as const,
            title: [statName, title].filter(Boolean).join(' — ') || statName || title,
            // e-Stat 통계표 상세(dataset) 뷰어로 직접 링크 — 사용자가 원 수치를 검증.
            url: id
              ? `https://www.e-stat.go.jp/dbview?sid=${id}`
              : '',
            snippet:
              [govOrg, estatText(t.STATISTICS_NAME)].filter(Boolean).join(' · ') || undefined,
            publishedAt: /^\d{4}-\d{2}-\d{2}/.test(openDate) ? openDate.slice(0, 10) : undefined,
            origin: govOrg || undefined,
            keyword,
            // 통계 primary 근거 — market 샘플링이 통계 행을 뉴스 사이에서 dropout
            // 시키지 않도록 pin 대상으로 표시(KOSIS 와 동일 정책).
            kind: 'metric' as const,
          } satisfies DeskArticle,
        };
      })
      .filter((b) => b.article.title && b.article.url)
      .slice(0, limit);

    // 2단: 상위 K개 표에 최신값을 병렬로 붙인다(실패는 null → 링크만 유지, 회귀 0).
    const targets = built.slice(0, VALUE_TABLE_COUNT).filter((b) => b.id);
    if (targets.length) {
      const values = await Promise.all(
        targets.map((b) => fetchLatestValue(b.id, appId)),
      );
      targets.forEach((b, i) => {
        const v = values[i];
        if (v) {
          b.article.snippet = [b.article.snippet, v].filter(Boolean).join(' · ');
        }
      });
    }

    const out = built.map((b) => b.article);
    console.info(
      `[desk-debug] estat — searchWord=${keyword} raw=${tables.length} kept=${out.length} valued=${targets.length}`,
    );
    return out;
  },
};

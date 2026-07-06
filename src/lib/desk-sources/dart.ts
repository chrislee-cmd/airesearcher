import { env } from '@/env';
import type {
  DeskArticle,
  DeskFetchResult,
  DeskSourceDefinition,
  DeskSourceErrorReason,
} from './types';
import { cleanApiKey, classifyHttpStatus, inRange, safeFetch } from './helpers';

// DART returns 200 with a `{ status, message }` envelope. Classify the status
// so a bad key (010/011/012) surfaces distinctly from a genuine "no data" (013),
// instead of every failure collapsing to `[]` (2026-07-06 incident class).
// Docs: https://opendart.fss.or.kr — 010 미등록키 / 011 사용중지 / 012 접근불가 IP /
// 013 조회데이터없음 / 020 요청제한 초과 / 021 조회회사수 초과.
function classifyDartStatus(status: string): DeskSourceErrorReason | undefined {
  if (['010', '011', '012'].includes(status)) return 'invalid_key';
  if (['020', '021'].includes(status)) return 'rate_limited';
  if (status === '013') return undefined; // 조회 데이터 없음 = genuine empty
  return 'fetch_failed';
}
import {
  fetchDartRevenue,
  formatKrwAmount,
  resolveDartCorp,
  type DartCorp,
  type DartRevenueReason,
} from './dart-corp';

// 매출 조회 실패 사유 → 보고서에 병기할 한국어 라벨 (decision 3: "확보 실패"
// 단독 금지). LLM 이 주요 기업 매출 표의 괄호 사유로 그대로 옮겨 쓴다.
const REVENUE_FAIL_KO: Record<DartRevenueReason, string> = {
  timeout: '조회 시간 초과',
  no_report: '공시 없음',
  api_error: 'API 오류',
};

// DART (금융감독원 전자공시) — 상장사 사업보고서/공시. TAM/SAM 검증용 (상장사
// 매출·시장 점유). 검색어가 상장사 사명이면 corp_code 로 그 회사를 특정해
// 정기공시 링크 + 사업보고서 매출액을 안정적으로 가져온다 (아래 corp 경로).
// 사명이 아니면(예: "화장품") corp_code 매칭이 실패하므로 옛 방식 — 최근 공시
// 피드(corp_cls=Y) + 클라이언트 키워드 필터 — 로 fallback 한다. KR-only,
// DART_API_KEY 없으면 자동 비활성.
type DartItem = {
  corp_name?: string;
  report_nm?: string;
  rcept_no?: string;
  flr_nm?: string;
  rcept_dt?: string; // YYYYMMDD
};

// DART bgn_de/end_de want a bare YYYYMMDD; our ranges are YYYY-MM-DD.
function toYyyymmdd(d?: string): string | undefined {
  if (!d) return undefined;
  const bare = d.replace(/-/g, '');
  return /^\d{8}$/.test(bare) ? bare : undefined;
}

// rcept_dt (YYYYMMDD) → YYYY-MM-DD so inRange / display parse it.
function fromYyyymmdd(d?: string): string | undefined {
  if (!d || !/^\d{8}$/.test(d)) return undefined;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function reportUrl(rceptNo: string): string {
  return `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rceptNo}`;
}

// ── corp_code 경로 — 회사를 특정해 정기공시 + 매출액을 안정적으로 수집 ──────────
// list.json?corp_code=X&pblntf_ty=A 는 그 회사의 정기공시(사업/반기/분기보고서)를
// 돌려준다. 여기에 사업보고서 매출액(fnlttSinglAcnt)을 얹어, SAM 근거로 쓸
// "회사 · 연도 · 매출액 + 공시 링크" article 을 만든다.
async function fetchByCorp(
  corp: DartCorp,
  key: string,
  keyword: string,
  range: { from?: string; to?: string },
  limit: number,
): Promise<DeskArticle[]> {
  const params = new URLSearchParams({
    crtfc_key: key,
    corp_code: corp.corpCode,
    pblntf_ty: 'A', // 정기공시 (사업/반기/분기보고서)
    page_count: String(Math.min(Math.max(limit, 1), 20)),
  });
  // 사업보고서는 연 1회(이듬해 3월경)라 기본 3개월 창으로는 못 잡는다 —
  // 날짜 지정이 없으면 최근 2년으로 넓혀 최신 사업보고서를 확보한다.
  const nowYear = new Date().getFullYear();
  params.set('bgn_de', toYyyymmdd(range.from) ?? `${nowYear - 2}0101`);
  const end = toYyyymmdd(range.to);
  if (end) params.set('end_de', end);

  // 공시 목록과 매출 조회는 독립 — 병렬로 돌려 task 를 15s cap 에서 멀리
  // 둔다 (둘 다 소형 JSON 호출, 각각 safeFetch 상한).
  const [items, revenueResult] = await Promise.all([
    (async (): Promise<DartItem[]> => {
      try {
        const res = await safeFetch(
          `https://opendart.fss.or.kr/api/list.json?${params}`,
        );
        if (!res.ok) return [];
        const json = (await res.json()) as { status?: string; list?: DartItem[] };
        return json.status === '000' ? (json.list ?? []) : [];
      } catch {
        // 공시 목록 실패해도 매출 article 은 만들 수 있으니 계속 진행.
        return [];
      }
    })(),
    fetchDartRevenue(corp.corpCode, key),
  ]);

  // 매출액 링크로 쓸 대표 공시 — 사업보고서 우선, 없으면 첫 정기공시.
  const businessReport =
    items.find((it) => (it.report_nm ?? '').includes('사업보고서')) ?? items[0];

  const out: DeskArticle[] = [];
  const companySearchUrl = `https://dart.fss.or.kr/dsae001/main.do?autoSearch=true&textCrpNm=${encodeURIComponent(corp.corpName)}`;

  // (1) 매출액 headline — SAM 핵심 수치. 사업보고서 기준 연결 매출액.
  if (revenueResult.ok) {
    const revenue = revenueResult.revenue;
    const url = businessReport?.rcept_no
      ? reportUrl(businessReport.rcept_no)
      : companySearchUrl;
    out.push({
      source: 'dart',
      // period 병기 필수 — 연간 매출과 분기/반기 누적 매출을 같은 수치인 양 비교하면
      // 안 된다 (예: "농심 2025 3분기 누적 매출액 …"). 2026-07-06 사고 fix.
      title: `${corp.corpName} ${revenue.period} ${revenue.label} ${formatKrwAmount(revenue.amount)}`,
      url,
      snippet: `DART ${revenue.period} 기준 ${revenue.label} ${revenue.amount.toLocaleString()}원 · 연결 우선`,
      publishedAt: `${revenue.year + 1}-04-01`,
      origin: corp.corpName,
      keyword,
    });
  } else {
    // 조용한 null 금지 — 명부 매칭은 됐는데 재무 조회가 실패한 경우, 사유를
    // 담은 진단 항목을 근거로 흘려보낸다. 보고서 LLM 이 주요 기업 매출 표에서
    // 이 회사 행을 "데이터 확보 실패 (조회 시간 초과)" 처럼 사유와 함께 렌더한다.
    // Vercel 로그에도 남겨 다음 진단을 즉시 가능하게 한다 (2026-07-06 사고 교훈).
    const reasonKo = REVENUE_FAIL_KO[revenueResult.reason];
    console.warn(
      `[dart] revenue lookup failed — corp=${corp.corpName} code=${corp.corpCode} reason=${revenueResult.reason}`,
    );
    out.push({
      source: 'dart',
      title: `${corp.corpName} 매출 — 데이터 확보 실패 (${reasonKo})`,
      url: businessReport?.rcept_no ? reportUrl(businessReport.rcept_no) : companySearchUrl,
      snippet: `DART 상장사 명부 매칭 성공(corp_code=${corp.corpCode}), 사업보고서 매출 조회 단계에서 실패 — ${reasonKo}. 수치를 임의로 채우지 말고 “데이터 확보 실패 (${reasonKo})”로 표기하세요.`,
      origin: corp.corpName,
      keyword,
    });
  }

  // (2) 정기공시 목록 — 추가 근거/링크. 매출 headline 과 합쳐 limit 로 자른다.
  for (const item of items) {
    if (!item.rcept_no) continue;
    const publishedAt = fromYyyymmdd(item.rcept_dt);
    if (!inRange(publishedAt, range)) continue;
    out.push({
      source: 'dart',
      title: `${corp.corpName} · ${item.report_nm ?? '공시'}`,
      url: reportUrl(item.rcept_no),
      snippet: [item.flr_nm, publishedAt ?? item.rcept_dt].filter(Boolean).join(' · '),
      publishedAt,
      origin: corp.corpName,
      keyword,
    });
  }

  return out.slice(0, limit);
}

// ── fallback 경로 (옛 동작) — 사명이 아닌 검색어(custom mode 등)용 ─────────────
// corp_cls=Y 최근 공시 피드를 당겨 클라이언트에서 키워드로 필터. 특정 회사
// 조회엔 부정확하지만, "화장품" 같은 일반어엔 최근 관련 공시를 훑는 용도로 유지.
async function fetchByFeedFilter(
  key: string,
  keyword: string,
  range: { from?: string; to?: string },
  limit: number,
): Promise<DeskFetchResult> {
  const params = new URLSearchParams({
    crtfc_key: key,
    corp_cls: 'Y',
    page_count: String(Math.min(Math.max(limit, 1), 100)),
  });
  const bgn = toYyyymmdd(range.from);
  const end = toYyyymmdd(range.to);
  if (bgn) params.set('bgn_de', bgn);
  if (end) params.set('end_de', end);

  const res = await safeFetch(`https://opendart.fss.or.kr/api/list.json?${params}`);
  if (!res.ok) return { articles: [], error: classifyHttpStatus(res.status) };
  const json = (await res.json()) as { status?: string; list?: DartItem[] };
  if (json.status !== '000') {
    return { articles: [], error: classifyDartStatus(json.status ?? '') };
  }

  const out: DeskArticle[] = [];
  for (const item of json.list ?? []) {
    const reportNm = item.report_nm ?? '';
    const corpName = item.corp_name ?? '';
    if (!reportNm.includes(keyword) && !corpName.includes(keyword)) continue;
    if (!item.rcept_no || !corpName) continue;
    const publishedAt = fromYyyymmdd(item.rcept_dt);
    if (!inRange(publishedAt, range)) continue;
    out.push({
      source: 'dart',
      title: `${corpName} · ${reportNm}`,
      url: reportUrl(item.rcept_no),
      snippet: [item.flr_nm, publishedAt ?? item.rcept_dt].filter(Boolean).join(' · '),
      publishedAt,
      origin: corpName,
      keyword,
    });
  }
  return { articles: out.slice(0, limit) };
}

export const dart: DeskSourceDefinition = {
  id: 'dart',
  category: 'stats',
  group: 'dart',
  label: 'DART 공시',
  labelEn: 'DART (Financial Disclosures)',
  hint: '상장사 사업보고서/매출 공시',
  regionOnly: ['KR'],
  envKeys: ['DART_API_KEY'],
  async fetch({ keyword, range, limit }) {
    const key = cleanApiKey(env.DART_API_KEY);
    if (!key) return [];

    // 검색어가 상장사 사명이면 corp_code 로 그 회사를 정확히 조회 (매출액 +
    // 정기공시). 실패하면 옛 피드 필터로 안전하게 fallback. corp 경로가 실제
    // 기사를 만들면 그대로 반환 (에러 채널은 fallback 이 소유 — 항상 마지막에
    // 도는 경로라 API status 를 가장 신뢰성 있게 관측한다).
    try {
      const corp = await resolveDartCorp(keyword, key);
      if (corp) {
        const byCorp = await fetchByCorp(corp, key, keyword, range, limit);
        if (byCorp.length) return byCorp;
      }
    } catch (err) {
      console.error('[dart] corp path failed, falling back', err);
    }

    try {
      return await fetchByFeedFilter(key, keyword, range, limit);
    } catch {
      return { articles: [], error: 'fetch_failed' };
    }
  },
};

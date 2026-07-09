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
import { listedRosterSize, resolveDartCorp, type DartCorp } from './dart-corp';
import {
  fetchDartFinancials,
  formatKrwAmount,
  yoyPct,
  type DartFinancialsFailReason,
  type DartMetric,
} from './dart-financials';

// 재무 조회 실패 사유 → 보고서에 병기할 한국어 라벨 (decision 3: "확보 실패"
// 단독 금지). LLM 이 주요 기업 매출 표의 괄호 사유로 그대로 옮겨 쓴다.
const REVENUE_FAIL_KO: Record<DartFinancialsFailReason, string> = {
  timeout: '조회 시간 초과',
  no_report: '공시 없음',
  api_error: 'API 오류',
};

// tier(어느 정규화 층에서 잡혔는지) → 스니펫 병기용 라벨. XBRL 표준계정으로
// 잡은 값이 라벨 변동에 가장 robust 함을 유저가 인지하게 한다.
function tierKo(tier: DartMetric['tier']): string {
  return tier === 1 ? 'XBRL 표준계정' : tier === 2 ? '한글 계정 매칭' : 'LLM 계정 선택';
}

// 지표의 3기간(당기/전기/전전기) 시계열을 보고서 LLM 이 그대로 옮겨 쓸 문자열로
// 만든다 — 연도별 금액 + **코드에서 계산한 YOY**(전년比, ▲/▼). 보고서 LLM 은 이
// 값을 표에 옮기기만 하고 스스로 계산하지 않는다(정책: LLM 계산 금지). 결측 기간은
// "데이터 확보 실패", 계산 불가 YOY 는 "—" 로 정직 표기. periods 는 [당기,전기,전전기]
// 내림차순이라 각 항목의 YOY 는 자기 다음(더 과거) 기간과의 비교다.
function formatMetricSeries(m: DartMetric): string {
  return m.periods
    .map((p, i) => {
      if (p.amount === null) return `${p.year}년 데이터 확보 실패`;
      const prev = m.periods[i + 1];
      const yoy = prev ? yoyPct(p, prev) : null;
      const yoyStr =
        yoy === null ? ' (YoY —)' : ` (YoY ${yoy >= 0 ? '▲' : '▼'}${Math.abs(yoy).toFixed(1)}%)`;
      return `${p.year}년 ${formatKrwAmount(p.amount)}${yoyStr}`;
    })
    .join(' · ');
}

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

  // 공시 목록과 재무 조회는 독립 — 병렬로 돌려 task 를 15s cap 에서 멀리
  // 둔다 (둘 다 소형 JSON 호출, 각각 safeFetch 상한).
  const [items, finResult] = await Promise.all([
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
    fetchDartFinancials(corp.corpCode, key),
  ]);

  // 매출액 링크로 쓸 대표 공시 — 사업보고서 우선, 없으면 첫 정기공시.
  const businessReport =
    items.find((it) => (it.report_nm ?? '').includes('사업보고서')) ?? items[0];

  const out: DeskArticle[] = [];
  const companySearchUrl = `https://dart.fss.or.kr/dsae001/main.do?autoSearch=true&textCrpNm=${encodeURIComponent(corp.corpName)}`;

  // (1) 재무 지표 headline + 지표별 article — 6개 핵심 지표(매출/영업이익/순이익/
  //     자산/부채/자본)를 XBRL 표준계정 1순위로 정규화해 뽑는다 (dart-financials).
  if (finResult.ok) {
    const fin = finResult.financials;
    // 값의 출처 = 실제 재무제표 공시(rcpNo). 없으면 사업보고서 → 회사검색.
    const finUrl = fin.rceptNo
      ? reportUrl(fin.rceptNo)
      : businessReport?.rcept_no
        ? reportUrl(businessReport.rcept_no)
        : companySearchUrl;
    const fsKo = fin.fsDiv === 'CFS' ? '연결' : '별도';
    // 연간 보고서는 이듬해 3월경 공시 → 근사 publishedAt. 분기/반기도 같은 근사.
    const publishedAt = `${fin.year + 1}-04-01`;

    const revenue = fin.metrics.find((m) => m.key === 'revenue');
    if (revenue) {
      out.push({
        source: 'dart',
        // period 병기 필수 — 연간 매출과 분기/반기 누적 매출을 같은 수치인 양 비교하면
        // 안 된다 (예: "농심 2025 3분기 누적 매출액 …"). 2026-07-06 사고 fix.
        title: `${corp.corpName} ${fin.period} ${revenue.labelKo} ${formatKrwAmount(revenue.amount)}`,
        url: finUrl,
        // 3개년 시계열 + 코드 계산 YOY 를 병기 — 보고서 "주요 기업 매출" 표가 회사당
        // 최대 3행(당기/전기/전전기)으로 렌더되게 한다(단일 fnlttSinglAcntAll 응답,
        // 추가 API 0). 보고서 LLM 은 이 연도별 값·YOY 를 그대로 옮기고 계산하지 않는다.
        snippet: `DART ${fin.period} 기준 ${revenue.accountNm || revenue.labelKo} · ${fsKo} · ${tierKo(revenue.tier)} · 연도별 매출: ${formatMetricSeries(revenue)}`,
        publishedAt,
        origin: corp.corpName,
        keyword,
        // primary 수치 근거 — market mode 샘플링이 이 매출 headline 을 뉴스 사이에서
        // dropout 시키지 않도록 pin 대상으로 표시 (2026-07-08 진단: 농심·삼양 탈락).
        kind: 'metric',
        // 구조화 매출 시계열 — 위 snippet 과 같은 값을 코드가 파싱 없이 소비하도록
        // 원값 그대로 실어 보낸다. "주요 기업 매출" 차트가 이 값으로 grouped bar +
        // YoY 를 만들어 표와 수치가 항상 일치한다(#461 — LLM 텍스트 파싱 금지).
        financials: {
          company: corp.corpName,
          sourceUrl: finUrl,
          period: fin.period,
          periods: revenue.periods.map((p) => ({
            year: p.year,
            amount: p.amount,
            cumulative: p.cumulative,
          })),
        },
      });
    } else {
      // 보고서는 락됐지만 매출 계정만 미매핑 — 무음 0건 금지. 사유를 남겨 보고서
      // LLM 이 임의 매출 수치를 지어내지 않게 한다.
      console.warn(
        `[dart] revenue unmapped — corp=${corp.corpName} code=${corp.corpCode} period=${fin.period}`,
      );
      out.push({
        source: 'dart',
        title: `${corp.corpName} 매출 — 계정 미매핑 (${fin.period})`,
        url: finUrl,
        snippet: `DART ${fin.period} 재무제표는 확보했으나 매출 계정을 특정하지 못했습니다. 수치를 임의로 채우지 말고 링크의 원문을 확인하세요.`,
        origin: corp.corpName,
        keyword,
      });
    }

    // (1-b) 나머지 지표(영업이익·순이익·자산·부채·자본) — 지표별 근거 article.
    // 매출 headline 만 pin(kind:'metric') 대상으로 두고 이들은 일반 근거로 둔다
    // (over-pin 방지 — pin 의 본래 의도는 SAM 앵커인 매출 보호. spec 보수 해석).
    for (const m of fin.metrics) {
      if (m.key === 'revenue') continue;
      out.push({
        source: 'dart',
        title: `${corp.corpName} ${fin.period} ${m.labelKo} ${formatKrwAmount(m.amount)}`,
        url: finUrl,
        snippet: `DART ${fin.period} 기준 ${m.accountNm || m.labelKo} ${m.amount.toLocaleString()}원 · ${fsKo} · ${tierKo(m.tier)}`,
        publishedAt,
        origin: corp.corpName,
        keyword,
      });
    }
  } else {
    // 조용한 null 금지 — 명부 매칭은 됐는데 재무 조회가 실패한 경우, 사유를
    // 담은 진단 항목을 근거로 흘려보낸다. 보고서 LLM 이 주요 기업 매출 표에서
    // 이 회사 행을 "데이터 확보 실패 (조회 시간 초과)" 처럼 사유와 함께 렌더한다.
    // Vercel 로그에도 남겨 다음 진단을 즉시 가능하게 한다 (2026-07-06 사고 교훈).
    const reasonKo = REVENUE_FAIL_KO[finResult.reason];
    console.warn(
      `[dart] financials lookup failed — corp=${corp.corpName} code=${corp.corpCode} reason=${finResult.reason}`,
    );
    out.push({
      source: 'dart',
      title: `${corp.corpName} 매출 — 데이터 확보 실패 (${reasonKo})`,
      url: businessReport?.rcept_no ? reportUrl(businessReport.rcept_no) : companySearchUrl,
      snippet: `DART 상장사 명부 매칭 성공(corp_code=${corp.corpCode}), 사업보고서 재무 조회 단계에서 실패 — ${reasonKo}. 수치를 임의로 채우지 말고 “데이터 확보 실패 (${reasonKo})”로 표기하세요.`,
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

// ── fallback 경로 (옛 동작) — 사명이 아닌 검색어(corp_code 미해석 시)용 ────────
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

    // market mode 는 DART 에 회사명(companies 축)만 보낸다 — 즉 이
    // keyword 는 항상 "회사"로 간주된다. corp_code 로 그 회사를 정확히 조회하고
    // (매출액 + 정기공시), 실패하면 피드 필터로 API status 를 관측한다. 그래도
    // 0 이면 조용히 비우지 않고 사유를 남긴다 (무음 0건 금지 — 2026-07-08 진단:
    // ‘팔도’/‘KIS정보통신’ 등 비상장·자회사가 corp 미해석 → 피드 필터 오늘-창
    // → 0건인데 아무 사유도 안 남아 유저가 버그와 구분 못 했다).
    let corp: DartCorp | null = null;
    try {
      corp = await resolveDartCorp(keyword, key);
      if (corp) {
        const byCorp = await fetchByCorp(corp, key, keyword, range, limit);
        console.info(
          `[desk-debug] dart corp — name=${keyword} code=${corp.corpCode} articles=${byCorp.length}`,
        );
        if (byCorp.length) return byCorp;
      }
    } catch (err) {
      console.error('[dart] corp path failed, falling back', err);
    }

    // corp 미해석(비상장/자회사) 또는 corp 경로 0건 → 피드 필터로 키/한도 오류를
    // 관측한다 (에러 채널 소유 경로).
    let feed: DeskFetchResult;
    try {
      feed = await fetchByFeedFilter(key, keyword, range, limit);
    } catch {
      feed = { articles: [], error: 'fetch_failed' };
    }
    // 명부 준비 여부로 "명부 미준비(warm-up 실패)"와 "명부엔 있으나 미등재
    // (비상장)"를 가른다 — 메모/캐시만 보므로 추가 왕복 없음.
    const rosterSize = corp ? -1 : await listedRosterSize(key);
    console.info(
      `[desk-debug] dart feed — name=${keyword} corp=${corp ? corp.corpCode : 'unresolved'} roster=${rosterSize} articles=${feed.articles.length} error=${feed.error ?? 'none'}`,
    );
    if (feed.articles.length || feed.error) return feed;

    // 여기 = corp 미해석 + 피드 0건 + API 오류 아님. 명부가 준비된 상태에서
    // 못 찾았다면 상장사가 아니란 뜻 — 조용한 0 대신 사유 article 을 흘려 보고서
    // LLM 이 "비상장이라 공시 없음"을 알고 임의 수치를 지어내지 않게 한다.
    // (명부 미준비면 root cause 가 달라 여기서 라벨을 붙이지 않고 그대로 반환 —
    // market 판단 로그가 "명부 준비 실패"를 이미 노출한다.)
    if (!corp && rosterSize > 0) {
      const searchUrl = `https://dart.fss.or.kr/dsae001/main.do?autoSearch=true&textCrpNm=${encodeURIComponent(keyword)}`;
      return {
        articles: [
          {
            source: 'dart',
            title: `${keyword} — DART 공시 없음 (비상장·자회사 추정)`,
            url: searchUrl,
            snippet: `‘${keyword}’ 은 DART 상장사 명부(코스피/코스닥 ${rosterSize.toLocaleString()}건)에서 찾지 못했습니다. 비상장·자회사·외국계 본사이면 전자공시 대상이 아니라 매출 공시가 없습니다. 수치를 임의로 채우지 말고 “공시 없음(비상장 추정)”으로 표기하세요.`,
            origin: keyword,
            keyword,
          },
        ],
      };
    }
    return feed;
  },
};

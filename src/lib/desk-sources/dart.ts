import { env } from '@/env';
import type { DeskArticle, DeskSourceDefinition } from './types';
import { inRange, safeFetch } from './helpers';
import {
  fetchDartRevenue,
  formatKrwAmount,
  resolveDartCorp,
  type DartCorp,
} from './dart-corp';

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

  let items: DartItem[] = [];
  try {
    const res = await safeFetch(
      `https://opendart.fss.or.kr/api/list.json?${params}`,
    );
    if (res.ok) {
      const json = (await res.json()) as { status?: string; list?: DartItem[] };
      if (json.status === '000') items = json.list ?? [];
    }
  } catch {
    // 공시 목록 실패해도 매출 article 은 만들 수 있으니 계속 진행.
  }

  // 매출액 링크로 쓸 대표 공시 — 사업보고서 우선, 없으면 첫 정기공시.
  const businessReport =
    items.find((it) => (it.report_nm ?? '').includes('사업보고서')) ?? items[0];

  const out: DeskArticle[] = [];

  // (1) 매출액 headline — SAM 핵심 수치. 사업보고서 기준 연결 매출액.
  const revenue = await fetchDartRevenue(corp.corpCode, key);
  if (revenue) {
    const url = businessReport?.rcept_no
      ? reportUrl(businessReport.rcept_no)
      : `https://dart.fss.or.kr/dsae001/main.do?autoSearch=true&textCrpNm=${encodeURIComponent(corp.corpName)}`;
    out.push({
      source: 'dart',
      title: `${corp.corpName} ${revenue.year} ${revenue.label} ${formatKrwAmount(revenue.amount)}`,
      url,
      snippet: `DART 사업보고서(${revenue.year}) 기준 ${revenue.label} ${revenue.amount.toLocaleString()}원 · 연결 우선`,
      publishedAt: `${revenue.year + 1}-04-01`,
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
): Promise<DeskArticle[]> {
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
  if (!res.ok) return [];
  const json = (await res.json()) as { status?: string; list?: DartItem[] };
  if (json.status !== '000') return [];

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
  return out.slice(0, limit);
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
    const key = env.DART_API_KEY;
    if (!key) return [];

    // 검색어가 상장사 사명이면 corp_code 로 그 회사를 정확히 조회 (매출액 +
    // 정기공시). 실패하면 옛 피드 필터로 안전하게 fallback.
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
      return [];
    }
  },
};

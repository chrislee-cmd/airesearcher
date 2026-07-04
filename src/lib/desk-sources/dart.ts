import { env } from '@/env';
import type { DeskArticle, DeskSourceDefinition } from './types';
import { inRange, safeFetch } from './helpers';

// DART (금융감독원 전자공시) — 상장사 사업보고서/공시 리스트. TAM/SAM 검증용
// (상장사 매출·시장 점유). The open API has no server-side keyword search, so we
// pull the listed-company (corp_cls=Y) disclosure feed and filter client-side by
// report title / company name — a spec decision (list.json + corp_cls=Y + client
// keyword filter). KR-only source; auto-disabled when DART_API_KEY is absent.
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

    const params = new URLSearchParams({
      crtfc_key: key,
      corp_cls: 'Y', // 상장사(유가증권)만
      // DART caps page_count at 100.
      page_count: String(Math.min(Math.max(limit, 1), 100)),
    });
    const bgn = toYyyymmdd(range.from);
    const end = toYyyymmdd(range.to);
    if (bgn) params.set('bgn_de', bgn);
    if (end) params.set('end_de', end);

    const res = await safeFetch(`https://opendart.fss.or.kr/api/list.json?${params}`);
    if (!res.ok) return [];
    const json = (await res.json()) as { status?: string; list?: DartItem[] };
    // status '000' = 정상. '013' = 조회된 데이터 없음, 그 외 = 키/파라미터 오류.
    if (json.status !== '000') return [];

    const out: DeskArticle[] = [];
    for (const item of json.list ?? []) {
      const reportNm = item.report_nm ?? '';
      const corpName = item.corp_name ?? '';
      // Client-side keyword filter — DART has no query param (spec decision 3).
      if (!reportNm.includes(keyword) && !corpName.includes(keyword)) continue;
      if (!item.rcept_no || !corpName) continue;
      const publishedAt = fromYyyymmdd(item.rcept_dt);
      if (!inRange(publishedAt, range)) continue;
      out.push({
        source: 'dart',
        title: `${corpName} · ${reportNm}`,
        url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.rcept_no}`,
        snippet: [item.flr_nm, publishedAt ?? item.rcept_dt].filter(Boolean).join(' · '),
        publishedAt,
        origin: corpName,
        keyword,
      });
    }
    return out.slice(0, limit);
  },
};

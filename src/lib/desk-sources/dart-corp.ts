// DART 회사 고유번호(corp_code) 해석 + 재무(매출) 조회. market mode 가 회사명을
// DART 검색어로 쓰는데, DART list.json 은 서버사이드 이름 검색이 없어 "최근
// 공시 피드 + 클라이언트 필터" 로는 특정 회사가 거의 0건으로 잡힌다. 이 모듈은
// corp_code 로 회사를 특정해 (1) 그 회사의 정기공시 링크와 (2) 사업보고서 기준
// 매출액 수치를 안정적으로 가져와 SAM 근거를 만든다.
//
// 모든 함수는 실패 시 throw 하지 않고 null/[] 로 degrade — DART 키 부재·API 오류·
// 파싱 실패 어디서든 crawl 이 계속되게 한다. dart.ts 만 import 하는 server 모듈.

import { unzipSync } from 'fflate';
import { getCache, setCache } from '@/lib/cache';
import { env } from '@/env';
import { cleanApiKey, pickTag, safeFetch } from './helpers';

export type DartCorp = { corpCode: string; corpName: string; stockCode: string };
export type DartRevenue = { year: number; amount: number; label: string };

// 상장사(고유번호+사명) 목록. corpCode.xml(전 기업 zip)에서 stock_code 가 있는
// 상장사만 추려 캐시한다. 'v1' 은 파싱 스키마 버전 — 구조 바뀌면 bump.
const LISTED_CACHE_KEY = 'dart:corpcode:listed:v1';

// 사명 매칭용 정규화 — 법인 접두/공백 제거 + 소문자.
function normName(s: string): string {
  return s
    .replace(/주식회사|\(주\)|㈜/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .trim();
}

// 한 serverless 실행 안에서 여러 DART task(회사 5개)가 상장사 map 을 공유하도록
// module-level 로 메모이즈 — Supabase 캐시 왕복을 1회로 줄인다.
let listedMemo: Promise<DartCorp[]> | null = null;

async function loadListedCorps(key: string): Promise<DartCorp[]> {
  if (listedMemo) return listedMemo;
  listedMemo = (async () => {
    const cached = await getCache<DartCorp[]>(LISTED_CACHE_KEY);
    if (cached && Array.isArray(cached) && cached.length) return cached;
    try {
      const res = await safeFetch(
        `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${key}`,
        undefined,
        20_000,
      );
      if (!res.ok) return [];
      const buf = new Uint8Array(await res.arrayBuffer());
      const files = unzipSync(buf);
      const xmlBytes = files['CORPCODE.xml'] ?? Object.values(files)[0];
      if (!xmlBytes) return [];
      const xml = new TextDecoder('utf-8').decode(xmlBytes);

      const corps: DartCorp[] = [];
      const re = /<list>([\s\S]*?)<\/list>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(xml)) !== null) {
        const block = m[1];
        const stockCode = (pickTag(block, 'stock_code') ?? '').trim();
        // 상장사만 — stock_code 가 비면(공백 한 칸으로 오기도 함) 비상장.
        if (!stockCode || !/^\d{5,6}$/.test(stockCode)) continue;
        const corpCode = (pickTag(block, 'corp_code') ?? '').trim();
        const corpName = (pickTag(block, 'corp_name') ?? '').trim();
        if (!corpCode || !corpName) continue;
        corps.push({ corpCode, corpName, stockCode });
      }
      if (corps.length) void setCache(LISTED_CACHE_KEY, corps);
      return corps;
    } catch (err) {
      console.error('[dart] loadListedCorps failed', err);
      return [];
    }
  })();
  return listedMemo;
}

// 회사명 → 상장사 corp_code. 정확 일치 우선, 없으면 포함 관계(짧은 사명 우선 —
// "코스맥스" 가 "코스맥스비티아이" 보다 먼저). 매칭 실패 시 null → 호출부가
// 옛 방식(공시 피드 필터)으로 fallback.
export async function resolveDartCorp(
  name: string,
  key: string = cleanApiKey(env.DART_API_KEY),
): Promise<DartCorp | null> {
  if (!key) return null;
  const corps = await loadListedCorps(key);
  if (!corps.length) return null;
  const q = normName(name);
  if (!q) return null;

  const exact = corps.find((c) => normName(c.corpName) === q);
  if (exact) return exact;

  const partial = corps
    .filter((c) => {
      const n = normName(c.corpName);
      return n.includes(q) || q.includes(n);
    })
    .sort((a, b) => a.corpName.length - b.corpName.length);
  return partial[0] ?? null;
}

// 매출로 인정하는 계정명 — 표준 '매출액' 외에 지주/금융사의 '영업수익',
// IFRS 표기 '수익(매출액)' 도 포함.
const REVENUE_ACCOUNTS = ['매출액', '수익(매출액)', '영업수익'];

type FnlttRow = {
  account_nm?: string;
  fs_div?: string; // CFS(연결) | OFS(별도)
  sj_div?: string; // BS | IS | CIS ...
  thstrm_amount?: string; // 당기금액 (콤마 포함 문자열)
};

// 사업보고서(연간, reprt_code=11011) 기준 매출액. 최근 완료 회계연도부터 2개
// 연도를 시도한다(사업보고서는 이듬해 3월경 공시 → 올해분은 아직 없을 수 있음).
// 연결(CFS) 우선. 실패 시 null.
export async function fetchDartRevenue(
  corpCode: string,
  key: string,
): Promise<DartRevenue | null> {
  const nowYear = new Date().getFullYear();
  for (const year of [nowYear - 1, nowYear - 2]) {
    try {
      const params = new URLSearchParams({
        crtfc_key: key,
        corp_code: corpCode,
        bsns_year: String(year),
        reprt_code: '11011',
      });
      const res = await safeFetch(
        `https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?${params}`,
      );
      if (!res.ok) continue;
      const json = (await res.json()) as { status?: string; list?: FnlttRow[] };
      if (json.status !== '000' || !Array.isArray(json.list)) continue;

      const rows = json.list.filter((r) => {
        const acc = (r.account_nm ?? '').replace(/\s/g, '');
        return REVENUE_ACCOUNTS.some((a) => acc.includes(a));
      });
      // 연결(CFS) 우선, 없으면 별도(OFS).
      const pick = rows.find((r) => r.fs_div === 'CFS') ?? rows[0];
      if (!pick) continue;
      const amount = Number(String(pick.thstrm_amount ?? '').replace(/[,\s]/g, ''));
      if (!Number.isFinite(amount) || amount === 0) continue;
      return { year, amount, label: pick.account_nm?.trim() || '매출액' };
    } catch {
      continue;
    }
  }
  return null;
}

// 원 단위 금액 → "N조 M억원" / "M억원" 표기 (읽기 쉬운 요약, 원 수치는 링크로
// 검증 가능). 음수/소수는 방어적으로 반올림.
export function formatKrwAmount(amount: number): string {
  const abs = Math.abs(Math.round(amount));
  const jo = Math.floor(abs / 1e12);
  const eok = Math.round((abs % 1e12) / 1e8);
  const sign = amount < 0 ? '-' : '';
  if (jo > 0) return `${sign}${jo}조${eok ? ` ${eok.toLocaleString()}억` : ''}원`;
  return `${sign}${Math.round(abs / 1e8).toLocaleString()}억원`;
}

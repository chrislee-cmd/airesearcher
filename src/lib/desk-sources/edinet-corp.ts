// EDINET 회사 해석 — (1) EDINET 코드 명부(제출자명↔EDINETコード↔証券コード)로
// 회사명→코드 해석, (2) 최근 공시 창을 스윕해 EDINETコード→최신 정기報告書 docID
// 인덱스 구축. **DART 의 `dart-corp.ts` + SEC 의 `sec-edgar-corp.ts` 등가**.
//
// 왜 스윕이 필요한가(보수적 설계 결정): DART 는 corp_code 로, SEC 는 CIK 로 회사를
// 직접 조회하지만 **EDINET v2 는 회사-인덱스 조회 엔드포인트가 없다** — 문서 목록은
// 오직 `documents.json?date=D`(날짜 인덱스)로만 나온다. 그래서 특정 회사의 최신
// 有価証券報告書 docID 를 얻으려면 날짜들을 스윕해 인덱스를 만들어야 한다. 무거운
// 스윕은 orchestrator warm-up(task cap 밖)에서 1회 수행해 Supabase 캐시에 실고, 각
// crawl task 는 캐시 히트로 즉시 docID 를 얻는다(DART corpCode.xml warm-up 과 동형).
//
// ⚠️ 스윕 창(EDINET_SWEEP_DAYS)은 유한하다 — 그 창 밖에 최신 보고서가 있는 회사는
// 인덱스에 없어 공시 검색 링크로 degrade 한다(무음 아님, 사유 병기). 3월 결산(대다수)
// 有報는 6월경 제출되므로 창은 그 계절 + 롤링 분기보고서를 덮게 잡는다.
//
// 모든 함수는 실패 시 throw 하지 않고 null/[]/{} 로 degrade — crawl 이 계속된다.
// server 모듈(edinet.ts / edinet-financials.ts 만 import).

import { getCache, setCache } from '@/lib/cache';
import { unzipSync } from 'fflate';
import {
  EDINET_API_BASE,
  EDINET_CODELIST_URL,
  edinetFetch,
  edinetThrottledAll,
  withKey,
} from './edinet-common';

// 한 제출자 = EDINETコード + 証券コード(상장사만) + 제출자명(ja/en).
export type EdinetCorp = {
  edinetCode: string;
  secCode: string; // 5자리(4자리 티커+말미 0). 비상장이면 ''.
  name: string;
  nameEn: string;
};

// 인덱스 한 항목 — 회사의 최신 정기보고서 참조.
export type EdinetDocRef = {
  docID: string;
  docTypeCode: string; // 120 有報 / 160 半期 / 140 四半期
  periodEnd: string; // YYYY-MM-DD (재무 시계열 baseYear 도출용)
  docDescription: string;
  submitDateTime: string; // YYYY-MM-DD HH:MM (최신 판정)
};

// 정기보고서 docTypeCode 우선순위 — 有報(120)가 3개년 XBRL 을 담아 가장 authoritative.
// 半期(160) → 四半期(140) 순. 창 안에 有報가 없을 때만 하위로 내려간다.
const REPORT_TYPE_RANK: Record<string, number> = { '120': 3, '160': 2, '140': 1 };
const REPORT_TYPE_CODES = new Set(Object.keys(REPORT_TYPE_RANK));

// 스윕 창(일). 3월 결산 有報 제출기(6월)를 덮고 롤링 분기보고서를 잡되, warm-up
// 비용(날짜당 1콜)을 유한하게 묶는다. 창 밖 회사는 링크 degrade — §PR 에 명시.
const EDINET_SWEEP_DAYS = 60;
const SWEEP_PER_CALL_MS = 8_000;
const SWEEP_CONCURRENCY = 4;

const CODELIST_CACHE_KEY = 'edinet:codelist:v1';
const DOCINDEX_CACHE_VERSION = 'v1';
function docIndexCacheKey(): string {
  const now = new Date();
  const bucket = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `edinet:docindex:${DOCINDEX_CACHE_VERSION}:${bucket}`;
}

// ── 코드 명부 ────────────────────────────────────────────────────────────────

// 법인 접미·구두점·공백 제거 + 소문자 (SEC normName 의 일본판 — 영문/한자 혼용
// 방어). 한자 사명은 그대로 두고 영문/괄호/기호만 정리한다.
function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/株式会社|有限会社|合同会社/g, '')
    .replace(/\b(corporation|company|holdings?|group|limited|incorporated|inc|corp|co|ltd|plc|llc|kk)\b/g, '')
    .replace(/[.,'"()\-・（）［］\[\]　\s]/g, '')
    .trim();
}

let rosterMemo: Promise<EdinetCorp[]> | null = null;

async function loadRoster(opts: { allowDownload: boolean }): Promise<EdinetCorp[]> {
  if (!rosterMemo) {
    rosterMemo = fetchRoster(opts).then((corps) => {
      if (!corps.length) rosterMemo = null; // 빈 결과는 고정 안 함(self-heal).
      return corps;
    });
  }
  return rosterMemo;
}

// Shift-JIS CSV 한 줄을 필드 배열로. EDINET code list 는 큰따옴표로 감싼 CSV.
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

async function fetchRoster(opts: { allowDownload: boolean }): Promise<EdinetCorp[]> {
  const cached = await getCache<EdinetCorp[]>(CODELIST_CACHE_KEY);
  if (cached && Array.isArray(cached) && cached.length) return cached;
  if (!opts.allowDownload) return []; // crawl task 안에서는 원거리 다운로드 금지.
  try {
    const res = await edinetFetch(EDINET_CODELIST_URL, 30_000);
    if (!res.ok) return [];
    const buf = new Uint8Array(await res.arrayBuffer());
    const files = unzipSync(buf);
    const csvName = Object.keys(files).find((n) => /\.csv$/i.test(n));
    if (!csvName) return [];
    // EdinetcodeDlInfo.csv 는 Shift-JIS. TextDecoder 가 못 읽으면 degrade.
    let text: string;
    try {
      text = new TextDecoder('shift-jis').decode(files[csvName]);
    } catch {
      return [];
    }
    const lines = text.split(/\r?\n/);
    // 1행=다운로드 일시, 2행=헤더. 헤더에서 열 인덱스를 찾는다(열 순서 드리프트 방어).
    const header = parseCsvLine(lines[1] ?? '');
    const col = (needle: string) => header.findIndex((h) => h.includes(needle));
    const iCode = col('ＥＤＩＮＥＴコード') >= 0 ? col('ＥＤＩＮＥＴコード') : 0;
    const iName = col('提出者名') >= 0 ? header.findIndex((h) => h === '提出者名') : 6;
    const iNameEn = col('提出者名（英字）');
    const iSec = col('証券コード');
    const corps: EdinetCorp[] = [];
    for (let i = 2; i < lines.length; i++) {
      const f = parseCsvLine(lines[i]);
      if (f.length < 3) continue;
      const edinetCode = (f[iCode] ?? '').trim();
      const name = (f[iName >= 0 ? iName : 6] ?? '').trim();
      if (!edinetCode || !name) continue;
      corps.push({
        edinetCode,
        secCode: (iSec >= 0 ? f[iSec] ?? '' : '').trim(),
        name,
        nameEn: (iNameEn >= 0 ? f[iNameEn] ?? '' : '').trim(),
      });
    }
    if (corps.length) {
      try {
        await setCache(CODELIST_CACHE_KEY, corps);
      } catch (err) {
        console.error('[edinet] codelist cache persist failed', err);
      }
    }
    return corps;
  } catch (err) {
    console.error('[edinet] fetchRoster failed', err);
    return [];
  }
}

// 명부 warm-up (orchestrator 단계). 반환 = 명부 건수(0=실패, 판단 로그용).
export async function warmEdinetCorps(): Promise<number> {
  const corps = await loadRoster({ allowDownload: true });
  return corps.length;
}

// 명부 크기(다운로드 없이) — 미해석이 "명부 미준비"인지 "미상장·미등록"인지 가른다.
export async function edinetRosterSize(): Promise<number> {
  const corps = await loadRoster({ allowDownload: false });
  return corps.length;
}

// 회사명 또는 증권코드(4/5자리) → EdinetCorp. 증권코드 정확 일치 우선 → 사명 정확
// 일치 → 포함(짧은 사명 우선). crawl task 안이라 캐시/메모만(다운로드 없음).
export async function resolveEdinetCorp(name: string): Promise<EdinetCorp | null> {
  const corps = await loadRoster({ allowDownload: false });
  if (!corps.length) {
    console.warn(`[desk-debug] edinet resolve — roster_unready name=${name}`);
    return null;
  }
  const raw = name.trim();
  if (!raw) return null;

  // 증권코드 직접 입력(예 "7203" / "72030"). EDINET 証券コード는 5자리(말미 0).
  if (/^\d{4,5}$/.test(raw)) {
    const sec5 = raw.length === 4 ? `${raw}0` : raw;
    const byCode = corps.find((c) => c.secCode === sec5);
    if (byCode) return byCode;
  }

  const q = normName(raw);
  if (!q) return null;
  const exact = corps.find((c) => normName(c.name) === q || normName(c.nameEn) === q);
  if (exact) return exact;

  const partial = corps
    .filter((c) => {
      const n = normName(c.name);
      const en = normName(c.nameEn);
      return (n && (n.includes(q) || q.includes(n))) || (en && (en.includes(q) || q.includes(en)));
    })
    .sort((a, b) => a.name.length - b.name.length);
  if (!partial.length) {
    console.info(`[desk-debug] edinet resolve — unlisted name=${name} roster=${corps.length}`);
  }
  return partial[0] ?? null;
}

// ── 문서 인덱스 (날짜 스윕) ──────────────────────────────────────────────────

type EdinetDocListItem = {
  docID?: string;
  edinetCode?: string;
  secCode?: string;
  docTypeCode?: string;
  periodEnd?: string;
  docDescription?: string;
  submitDateTime?: string;
  withdrawalStatus?: string; // '1' = 取下 (제외)
};
type EdinetDocListResp = {
  metadata?: { status?: string; message?: string; resultset?: { count?: number } };
  results?: EdinetDocListItem[];
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

// 최근 EDINET_SWEEP_DAYS 일을 스윕해 EDINETコード→최신 정기報告書 인덱스를 만들어
// 캐시에 실는다(warm-up, task cap 밖). 반환 = 인덱스 항목 수(0=실패/빈창, 판단 로그용).
export async function warmEdinetDocIndex(key: string): Promise<number> {
  if (!key) return 0; // v2 는 키 필수 — 없으면 스윕 불가(호출부가 사유 노출).
  const cacheKey = docIndexCacheKey();
  try {
    const cached = await getCache<Record<string, EdinetDocRef>>(cacheKey);
    if (cached && typeof cached === 'object' && Object.keys(cached).length) {
      return Object.keys(cached).length;
    }
  } catch {
    // 캐시 조회 실패는 무시하고 스윕.
  }

  const today = new Date();
  const days: string[] = [];
  for (let i = 0; i < EDINET_SWEEP_DAYS; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(ymd(d));
  }

  const index: Record<string, EdinetDocRef> = {};
  const better = (a: EdinetDocRef, b: EdinetDocRef) => {
    const ra = REPORT_TYPE_RANK[a.docTypeCode] ?? 0;
    const rb = REPORT_TYPE_RANK[b.docTypeCode] ?? 0;
    if (ra !== rb) return ra > rb; // 有報 > 半期 > 四半期
    return a.submitDateTime > b.submitDateTime; // 동급이면 최신 제출
  };

  await edinetThrottledAll(
    days,
    async (date) => {
      try {
        const url = withKey(`${EDINET_API_BASE}/documents.json?date=${date}&type=2`, key);
        const res = await edinetFetch(url, SWEEP_PER_CALL_MS);
        if (!res.ok) return; // 키 노출 방지 — URL 로그 금지, 상태만 무시.
        const json = (await res.json()) as EdinetDocListResp;
        for (const it of json.results ?? []) {
          const edinetCode = (it.edinetCode ?? '').trim();
          const docID = (it.docID ?? '').trim();
          const docTypeCode = (it.docTypeCode ?? '').trim();
          if (!edinetCode || !docID) continue;
          if (!REPORT_TYPE_CODES.has(docTypeCode)) continue;
          if (it.withdrawalStatus === '1') continue; // 取下(철회) 제외
          const ref: EdinetDocRef = {
            docID,
            docTypeCode,
            periodEnd: (it.periodEnd ?? '').trim(),
            docDescription: (it.docDescription ?? '').trim(),
            submitDateTime: (it.submitDateTime ?? '').trim(),
          };
          const prev = index[edinetCode];
          if (!prev || better(ref, prev)) index[edinetCode] = ref;
        }
      } catch {
        // 개별 날짜 실패는 무시 — 인덱스가 조금 작아질 뿐.
      }
    },
    SWEEP_CONCURRENCY,
  );

  const size = Object.keys(index).length;
  if (size) {
    try {
      await setCache(cacheKey, index);
    } catch (err) {
      console.error('[edinet] docindex cache persist failed', err);
    }
  }
  console.info(`[desk-debug] edinet docindex warm — days=${EDINET_SWEEP_DAYS} indexed=${size}`);
  return size;
}

// crawl task 안: 캐시된 인덱스에서 회사의 최신 보고서 참조를 읽는다(다운로드 없음).
// 캐시 미스(warm-up 실패/창 밖)면 null → 호출부가 링크 degrade + 사유.
export async function resolveEdinetDoc(edinetCode: string): Promise<EdinetDocRef | null> {
  try {
    const index = await getCache<Record<string, EdinetDocRef>>(docIndexCacheKey());
    return index?.[edinetCode] ?? null;
  } catch {
    return null;
  }
}

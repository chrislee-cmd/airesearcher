// Shared crawl utilities used across every source module. Moved verbatim out of
// the old `desk-crawl.ts` so each source module can reuse them without importing
// the crawl orchestrator.

import type { DeskArticle, DeskFetchResult } from './types';
import type { DeskDateRange } from './types';

// Normalise a source module's return into the richer `DeskFetchResult`. Sources
// that don't opt into the error channel keep returning a bare array; this wraps
// them so the crawl orchestrator has one shape to reason about.
export function toFetchResult(
  r: DeskArticle[] | DeskFetchResult,
): DeskFetchResult {
  return Array.isArray(r) ? { articles: r } : r;
}

// Map an HTTP status to an error reason for sources that fail at the transport
// layer (non-2xx). 429 is the one unambiguous rate-limit signal across APIs;
// everything else (timeout/5xx/4xx) is a generic fetch failure.
export function classifyHttpStatus(status: number): DeskFetchResult['error'] {
  return status === 429 ? 'rate_limited' : 'fetch_failed';
}

export const UA =
  'Mozilla/5.0 (compatible; ai-researcher-desk/0.1; +https://example.com/bot)';

// API 키에서 실수로 감싼 따옴표/공백을 벗긴다. `.env.local` 은 값에 따옴표를
// 두는 관례라 dotenv(로컬)는 자동으로 벗기지만, Vercel 대시보드에 따옴표째
// 붙여넣으면 벗겨지지 않아 그대로 API 로 전달돼 "invalid key" 로 조용히
// 실패한다 (DART 는 status 100 "잘못된 인증키(40자리)" 로 거부 → 소스 0건).
// 정상 키에는 따옴표/공백이 없으므로 이 정규화는 무해하다.
export function cleanApiKey(k: string | undefined): string {
  if (!k) return '';
  let v = k.trim();
  while (
    v.length >= 2 &&
    ((v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'")))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

// Per-source total budget. The route splits this evenly across keywords, so
// each (keyword × source) pull only takes its slice. This stops the first
// keyword from devouring the whole budget while later keywords starve.
export const SOURCE_BUDGET = 100;

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export function stripCdata(v: string): string {
  return v.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();
}

export function pickTag(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return undefined;
  return decodeEntities(stripCdata(m[1]));
}

export function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).trim();
}

export function safeFetch(
  url: string,
  init?: RequestInit,
  timeoutMs = 10_000,
): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  return fetch(url, { ...init, signal: ac.signal }).finally(() => clearTimeout(t));
}

// safeFetch + 5xx·네트워크 오류 짧은 재시도. 매크로 소스(World Bank/OECD)가 iad1
// 콜드스타트에서 간헐 502(Azure Application Gateway)·타임아웃을 맞고 재시도 없이
// 0건이 되던 문제(P3 "국내 vs G7 대비" 무데이터 회귀)를 막는다. 4xx 는 재시도가
// 무의미하므로 즉시 반환. 재시도 사이에만 짧은 백오프(200·400ms)를 둔다.
export async function safeFetchRetry(
  url: string,
  init?: RequestInit,
  timeoutMs = 10_000,
  tries = 3,
): Promise<Response> {
  let last: Response | undefined;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await safeFetch(url, init, timeoutMs);
      // 성공 또는 4xx(영구 오류) → 그대로 반환. 5xx 만 재시도 대상.
      if (res.ok || (res.status >= 400 && res.status < 500)) return res;
      last = res;
    } catch (err) {
      // 마지막 시도의 네트워크/timeout 오류는 호출부가 처리하도록 그대로 던진다.
      if (i === tries - 1) throw err;
    }
    if (i < tries - 1) {
      await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
  return last as Response;
}

// Universal post-filter — for sources whose API can't filter server-side. If
// publishedAt is missing or unparseable we keep the item rather than dropping
// it (false-negatives are worse than slight over-collection at this stage).
export function inRange(iso: string | undefined, range: DeskDateRange): boolean {
  if (!range.from && !range.to) return true;
  if (!iso) return true;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return true;
  if (range.from) {
    const f = Date.parse(`${range.from}T00:00:00Z`);
    if (t < f) return false;
  }
  if (range.to) {
    const e = Date.parse(`${range.to}T23:59:59Z`);
    if (t > e) return false;
  }
  return true;
}

export function rangeToRfc3339(range: DeskDateRange): {
  after?: string;
  before?: string;
} {
  return {
    after: range.from ? `${range.from}T00:00:00Z` : undefined,
    before: range.to ? `${range.to}T23:59:59Z` : undefined,
  };
}

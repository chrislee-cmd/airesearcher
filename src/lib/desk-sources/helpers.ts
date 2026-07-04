// Shared crawl utilities used across every source module. Moved verbatim out of
// the old `desk-crawl.ts` so each source module can reuse them without importing
// the crawl orchestrator.

import type { DeskDateRange } from './types';

export const UA =
  'Mozilla/5.0 (compatible; ai-researcher-desk/0.1; +https://example.com/bot)';

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

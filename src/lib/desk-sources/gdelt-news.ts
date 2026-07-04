import type { DeskRegion, DeskSourceDefinition } from './types';
import { safeFetch, UA } from './helpers';

// GDELT 2.0 DOC API (free, no key). GDELT lets us filter by `sourcecountry:`
// using FIPS 10-4 country codes, giving real per-region keyword search instead
// of relying on Google News' curation. GLOBAL omits the country filter.
const GDELT_SOURCE_COUNTRY: Record<DeskRegion, string | null> = {
  KR: 'KS',
  US: 'US',
  SG: 'SN',
  MY: 'MY',
  TH: 'TH',
  JP: 'JA',
  GLOBAL: null,
};

type GdeltArticle = {
  url?: string;
  title?: string;
  seendate?: string; // YYYYMMDDTHHMMSSZ
  domain?: string;
  language?: string;
  sourcecountry?: string;
};

function gdeltDateToIso(s: string): string | undefined {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return undefined;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

export const gdeltNews: DeskSourceDefinition = {
  id: 'gdelt_news',
  category: 'news',
  group: 'global',
  label: 'GDELT 뉴스',
  labelEn: 'GDELT News',
  hint: '글로벌 뉴스 DB · 지역 직접 필터 (키 불필요)',
  async fetch({ keyword, region, range, limit }) {
    const sc = GDELT_SOURCE_COUNTRY[region];
    // GDELT requires multi-word queries to be quoted to be treated as a phrase.
    const kw = /\s/.test(keyword) ? `"${keyword}"` : keyword;
    const queryParts = [kw];
    if (sc) queryParts.push(`sourcecountry:${sc}`);
    const params = new URLSearchParams({
      query: queryParts.join(' '),
      mode: 'ArtList',
      format: 'json',
      maxrecords: String(Math.min(250, Math.max(1, limit))),
      sort: 'DateDesc',
    });
    // GDELT date format is YYYYMMDDHHMMSS UTC.
    const fmt = (iso: string, end: boolean) =>
      iso.replace(/-/g, '') + (end ? '235959' : '000000');
    if (range.from) params.set('startdatetime', fmt(range.from, false));
    if (range.to) params.set('enddatetime', fmt(range.to, true));
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?${params}`;
    const res = await safeFetch(url, { headers: { 'user-agent': UA } }, 15_000);
    if (!res.ok) return [];
    // GDELT can return 200 with an HTML error page when the query is malformed.
    // Guard the JSON parse so a bad query doesn't poison the whole job.
    const text = await res.text();
    let json: { articles?: GdeltArticle[] };
    try {
      json = JSON.parse(text) as { articles?: GdeltArticle[] };
    } catch {
      return [];
    }
    const arts = json.articles ?? [];
    return arts
      .map((a) => ({
        source: 'gdelt_news' as const,
        title: a.title ?? '',
        url: a.url ?? '',
        snippet: undefined,
        publishedAt: a.seendate ? gdeltDateToIso(a.seendate) : undefined,
        origin: a.domain,
        keyword,
      }))
      .filter((a) => a.title && a.url)
      .slice(0, limit);
  },
};

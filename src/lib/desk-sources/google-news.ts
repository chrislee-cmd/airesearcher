import type { DeskRegion, DeskSourceDefinition } from './types';
import { inRange, pickTag, safeFetch, stripHtml, UA } from './helpers';

// Map target region to Google News (`hl`/`gl`/`ceid`). GLOBAL falls back to
// en/US — Google News requires a country code.
const GOOGLE_NEWS_BY_REGION: Record<DeskRegion, { hl: string; gl: string; ceid: string }> = {
  KR: { hl: 'ko', gl: 'KR', ceid: 'KR:ko' },
  US: { hl: 'en-US', gl: 'US', ceid: 'US:en' },
  SG: { hl: 'en-SG', gl: 'SG', ceid: 'SG:en' },
  MY: { hl: 'en-MY', gl: 'MY', ceid: 'MY:en' },
  TH: { hl: 'th', gl: 'TH', ceid: 'TH:th' },
  JP: { hl: 'ja', gl: 'JP', ceid: 'JP:ja' },
  GLOBAL: { hl: 'en', gl: 'US', ceid: 'US:en' },
};

export const googleNews: DeskSourceDefinition = {
  id: 'google_news',
  category: 'news',
  group: 'global',
  label: '구글 뉴스',
  labelEn: 'Google News',
  hint: '국내·해외 뉴스 RSS',
  async fetch({ keyword, region, range, limit }) {
    const { hl, gl, ceid } = GOOGLE_NEWS_BY_REGION[region];
    const parts = [keyword];
    if (range.from) parts.push(`after:${range.from}`);
    if (range.to) parts.push(`before:${range.to}`);
    const q = parts.join(' ');
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
    const res = await safeFetch(url, { headers: { 'user-agent': UA } });
    if (!res.ok) return [];
    const xml = await res.text();
    // RSS isn't paginated — just trim to this keyword's slice.
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
    return items
      .map((m) => {
        const block = m[1];
        const title = pickTag(block, 'title') ?? '';
        const link = pickTag(block, 'link') ?? '';
        const pub = pickTag(block, 'pubDate');
        const origin = pickTag(block, 'source');
        const desc = pickTag(block, 'description');
        const snippet = desc ? stripHtml(desc) : undefined;
        return {
          source: 'google_news' as const,
          title,
          url: link,
          snippet,
          publishedAt: pub,
          origin,
          keyword,
        };
      })
      .filter((a) => a.title && a.url)
      .filter((a) => inRange(a.publishedAt, range))
      .slice(0, limit);
  },
};

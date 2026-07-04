import { XMLParser } from 'fast-xml-parser';
import type { DeskArticle, DeskSourceDefinition } from './types';
import { inRange, safeFetch, stripHtml, UA } from './helpers';

// 국내 산하 연구소 공개 발간물 RSS aggregator. Several government-funded Korean
// research institutes (KISDI / KIET / KOTRA / KISTEP) publish reports via plain
// RSS 2.0 feeds — no API key. This source fans out across all of them in
// parallel, then keyword-filters the merged items client-side.
//
// Design (spec decisions):
//   1. multi-feed aggregate — all feeds fetched concurrently, then merged.
//   2. client-side keyword filter — feeds have no server-side search, so we
//      match `keyword` against title/description after the fact.
//   3. graceful per-feed skip — one institute being down (or having moved its
//      feed URL) must not sink the others. Every feed is wrapped so a non-200,
//      a non-XML body, or a parse error degrades that feed to [] rather than
//      throwing. This also makes the source resilient to a stale FEED URL: it
//      quietly returns nothing for that institute instead of breaking the crawl.
//
// The feed URLs below are best-effort. All four institute sites bot-block direct
// verification (403/JS-rendered), so a moved endpoint just yields [] for that
// institute until the URL here is updated — no code change beyond this table.
const INSTITUTE_FEEDS: { origin: string; url: string }[] = [
  { origin: 'KISDI', url: 'https://www.kisdi.re.kr/rss/publication.do' },
  { origin: 'KIET', url: 'https://www.kiet.re.kr/rss/rss.jsp' },
  { origin: 'KOTRA', url: 'https://dream.kotra.or.kr/kotranews/rss/rssKotraNews.do' },
  { origin: 'KISTEP', url: 'https://www.kistep.re.kr/rss/rssList.do' },
];

// RSS <item> nodes arrive as a single object or an array depending on count.
function toArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

type RssItem = {
  title?: unknown;
  link?: unknown;
  description?: unknown;
  pubDate?: unknown;
};

function asText(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number') return String(v);
  return undefined;
}

// Fetch + parse one institute feed. Never throws — any failure (network,
// non-200, non-XML body, parse error) resolves to [] so the aggregate keeps the
// other institutes (spec decision 3).
async function fetchFeed(
  feed: { origin: string; url: string },
  keyword: string,
): Promise<DeskArticle[]> {
  try {
    const res = await safeFetch(feed.url, { headers: { 'user-agent': UA } }, 12_000);
    if (!res.ok) return [];
    const xml = await res.text();
    // Cheap guard before handing to the parser — many dead institute endpoints
    // answer 200 with an HTML error page rather than a feed.
    if (!xml.includes('<item') && !xml.includes('<rss') && !xml.includes('<channel')) {
      return [];
    }
    const parser = new XMLParser({ ignoreAttributes: false });
    let items: RssItem[];
    try {
      items = toArray(parser.parse(xml)?.rss?.channel?.item as RssItem | RssItem[] | undefined);
    } catch {
      return [];
    }
    return items
      .map((item): DeskArticle | null => {
        const title = asText(item.title);
        const url = asText(item.link);
        if (!title || !url) return null;
        const description = asText(item.description);
        const snippet = description ? stripHtml(description).slice(0, 500) : undefined;
        const pub = asText(item.pubDate);
        return {
          source: 'institutes_kr',
          title,
          url,
          snippet: snippet || undefined,
          publishedAt: pub,
          origin: feed.origin,
          keyword,
        };
      })
      .filter((a): a is DeskArticle => a !== null);
  } catch {
    return [];
  }
}

export const institutesRss: DeskSourceDefinition = {
  id: 'institutes_kr',
  category: 'institute',
  group: 'institute_kr',
  label: '국내 산하 연구소',
  labelEn: 'Korean Research Institutes',
  hint: 'KISDI/KIET/KOTRA/KISTEP 공식 발간물 (키 불필요)',
  regionOnly: ['KR'],
  // No envKeys — the RSS feeds are public.
  async fetch({ keyword, range, limit }) {
    const perFeed = await Promise.all(
      INSTITUTE_FEEDS.map((feed) => fetchFeed(feed, keyword)),
    );
    return perFeed
      .flat()
      // Client-side keyword filter (spec decision 2) — feeds carry no query
      // param, so narrow the merged set here against title + snippet.
      .filter((a) => a.title.includes(keyword) || (a.snippet?.includes(keyword) ?? false))
      .filter((a) => inRange(a.publishedAt, range))
      .slice(0, limit);
  },
};

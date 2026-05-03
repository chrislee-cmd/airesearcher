import type { DeskArticle, DeskSourceId } from './desk-sources';

const UA = 'Mozilla/5.0 (compatible; ai-researcher-desk/0.1; +https://example.com/bot)';

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripCdata(v: string): string {
  return v.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();
}

function pickTag(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return undefined;
  return decodeEntities(stripCdata(m[1]));
}

function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 10_000);
  return fetch(url, { ...init, signal: ac.signal }).finally(() => clearTimeout(t));
}

async function fetchGoogleNews(keyword: string, locale: 'ko' | 'en'): Promise<DeskArticle[]> {
  const hl = locale === 'ko' ? 'ko' : 'en-US';
  const gl = locale === 'ko' ? 'KR' : 'US';
  const ceid = locale === 'ko' ? 'KR:ko' : 'US:en';
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
  const res = await safeFetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) return [];
  const xml = await res.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 10);
  return items.map((m) => {
    const block = m[1];
    const title = pickTag(block, 'title') ?? '';
    const link = pickTag(block, 'link') ?? '';
    const pub = pickTag(block, 'pubDate');
    const origin = pickTag(block, 'source');
    const desc = pickTag(block, 'description');
    const snippet = desc ? decodeEntities(desc.replace(/<[^>]*>/g, '')).trim() : undefined;
    return {
      source: 'google_news' as const,
      title,
      url: link,
      snippet,
      publishedAt: pub,
      origin,
      keyword,
    };
  }).filter((a) => a.title && a.url);
}

type HNHit = {
  title?: string;
  story_title?: string;
  url?: string;
  objectID?: string;
  story_text?: string;
  created_at?: string;
};

async function fetchHackerNews(keyword: string): Promise<DeskArticle[]> {
  const res = await safeFetch(
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(keyword)}&hitsPerPage=10`,
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { hits?: HNHit[] };
  const hits = json.hits ?? [];
  return hits
    .map((h) => {
      const title = h.title || h.story_title || '';
      const url = h.url || (h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : '');
      const snippet = h.story_text
        ? decodeEntities(h.story_text.replace(/<[^>]*>/g, '')).trim().slice(0, 280)
        : undefined;
      return {
        source: 'hacker_news' as const,
        title,
        url,
        snippet,
        publishedAt: h.created_at,
        origin: 'Hacker News',
        keyword,
      };
    })
    .filter((a) => a.title && a.url);
}

type RedditChild = {
  data?: {
    title?: string;
    url_overridden_by_dest?: string;
    permalink?: string;
    selftext?: string;
    created_utc?: number;
    subreddit_name_prefixed?: string;
  };
};

async function fetchReddit(keyword: string): Promise<DeskArticle[]> {
  const res = await safeFetch(
    `https://www.reddit.com/search.json?q=${encodeURIComponent(keyword)}&limit=10&sort=relevance`,
    { headers: { 'user-agent': UA } },
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: { children?: RedditChild[] } };
  const posts = json.data?.children ?? [];
  return posts
    .map((p) => {
      const d = p.data ?? {};
      const url = d.url_overridden_by_dest || (d.permalink ? `https://www.reddit.com${d.permalink}` : '');
      return {
        source: 'reddit' as const,
        title: d.title ?? '',
        url,
        snippet: d.selftext ? d.selftext.trim().slice(0, 280) : undefined,
        publishedAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : undefined,
        origin: d.subreddit_name_prefixed || 'reddit',
        keyword,
      };
    })
    .filter((a) => a.title && a.url);
}

export async function crawlSource(
  source: DeskSourceId,
  keyword: string,
  locale: 'ko' | 'en' = 'ko',
): Promise<DeskArticle[]> {
  try {
    if (source === 'google_news') return await fetchGoogleNews(keyword, locale);
    if (source === 'hacker_news') return await fetchHackerNews(keyword);
    if (source === 'reddit') return await fetchReddit(keyword);
  } catch (err) {
    console.error('[desk-crawl]', source, keyword, err);
  }
  return [];
}

export function dedupeArticles(articles: DeskArticle[]): DeskArticle[] {
  const seen = new Set<string>();
  const out: DeskArticle[] = [];
  for (const a of articles) {
    const key = a.url || `${a.source}|${a.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

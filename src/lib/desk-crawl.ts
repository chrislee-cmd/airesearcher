import type { DeskArticle, DeskSourceId } from './desk-sources';

const UA = 'Mozilla/5.0 (compatible; ai-researcher-desk/0.1; +https://example.com/bot)';

// Per-source target. Each source paginates up to this; smaller-cap sources
// (e.g. YouTube due to quota) stop early. Tweak here, not at call sites.
const TARGET = 500;

export type DeskDateRange = { from?: string; to?: string }; // YYYY-MM-DD

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

function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).trim();
}

function safeFetch(url: string, init?: RequestInit, timeoutMs = 10_000): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  return fetch(url, { ...init, signal: ac.signal }).finally(() => clearTimeout(t));
}

// Universal post-filter — for sources whose API can't filter server-side. If
// publishedAt is missing or unparseable we keep the item rather than dropping
// it (false-negatives are worse than slight over-collection at this stage).
function inRange(iso: string | undefined, range: DeskDateRange): boolean {
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

function rangeToRfc3339(range: DeskDateRange): { after?: string; before?: string } {
  return {
    after: range.from ? `${range.from}T00:00:00Z` : undefined,
    before: range.to ? `${range.to}T23:59:59Z` : undefined,
  };
}

// ─── Google News (RSS) ──────────────────────────────────────────────────────
async function fetchGoogleNews(
  keyword: string,
  locale: 'ko' | 'en',
  range: DeskDateRange,
): Promise<DeskArticle[]> {
  const hl = locale === 'ko' ? 'ko' : 'en-US';
  const gl = locale === 'ko' ? 'KR' : 'US';
  const ceid = locale === 'ko' ? 'KR:ko' : 'US:en';
  // Google News supports `after:YYYY-MM-DD before:YYYY-MM-DD` operators in q.
  const parts = [keyword];
  if (range.from) parts.push(`after:${range.from}`);
  if (range.to) parts.push(`before:${range.to}`);
  const q = parts.join(' ');
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
  const res = await safeFetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) return [];
  const xml = await res.text();
  // Google News RSS returns ~100 per query; take all of them.
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
    .filter((a) => inRange(a.publishedAt, range));
}

// ─── Hacker News (Algolia) ──────────────────────────────────────────────────
type HNHit = {
  title?: string;
  story_title?: string;
  url?: string;
  objectID?: string;
  story_text?: string;
  created_at?: string;
};
async function fetchHackerNews(keyword: string, range: DeskDateRange): Promise<DeskArticle[]> {
  const filters: string[] = [];
  if (range.from) {
    const ts = Math.floor(Date.parse(`${range.from}T00:00:00Z`) / 1000);
    if (!Number.isNaN(ts)) filters.push(`created_at_i>${ts}`);
  }
  if (range.to) {
    const ts = Math.floor(Date.parse(`${range.to}T23:59:59Z`) / 1000);
    if (!Number.isNaN(ts)) filters.push(`created_at_i<${ts}`);
  }
  // Algolia HN supports hitsPerPage up to 1000 in a single call.
  const params = new URLSearchParams({
    query: keyword,
    hitsPerPage: String(TARGET),
  });
  if (filters.length) params.set('numericFilters', filters.join(','));
  const res = await safeFetch(`https://hn.algolia.com/api/v1/search?${params}`);
  if (!res.ok) return [];
  const json = (await res.json()) as { hits?: HNHit[] };
  const hits = json.hits ?? [];
  return hits
    .map((h) => {
      const title = h.title || h.story_title || '';
      const url = h.url || (h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : '');
      const snippet = h.story_text ? stripHtml(h.story_text).slice(0, 280) : undefined;
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

// ─── Reddit (public JSON) ───────────────────────────────────────────────────
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
async function fetchReddit(keyword: string, range: DeskDateRange): Promise<DeskArticle[]> {
  // Reddit's public search.json caps `limit` at 100 per call but supports
  // cursor pagination via `after`. Loop until target or end of feed.
  const out: DeskArticle[] = [];
  let after: string | null = null;
  for (let page = 0; page < Math.ceil(TARGET / 100); page++) {
    const params = new URLSearchParams({
      q: keyword,
      limit: '100',
      sort: 'relevance',
    });
    if (after) params.set('after', after);
    const res = await safeFetch(
      `https://www.reddit.com/search.json?${params}`,
      { headers: { 'user-agent': UA } },
    );
    if (!res.ok) break;
    const json = (await res.json()) as {
      data?: { children?: RedditChild[]; after?: string | null };
    };
    const posts = json.data?.children ?? [];
    for (const p of posts) {
      const d = p.data ?? {};
      const url = d.url_overridden_by_dest || (d.permalink ? `https://www.reddit.com${d.permalink}` : '');
      const item: DeskArticle = {
        source: 'reddit',
        title: d.title ?? '',
        url,
        snippet: d.selftext ? d.selftext.trim().slice(0, 280) : undefined,
        publishedAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : undefined,
        origin: d.subreddit_name_prefixed || 'reddit',
        keyword,
      };
      if (item.title && item.url && inRange(item.publishedAt, range)) {
        out.push(item);
      }
    }
    after = json.data?.after ?? null;
    if (!after || posts.length === 0) break;
    if (out.length >= TARGET) break;
  }
  return out.slice(0, TARGET);
}

// ─── Naver Search API ───────────────────────────────────────────────────────
type NaverItem = {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
  bloggername?: string;
  postdate?: string;
  cafename?: string;
};
type NaverType = 'news' | 'blog' | 'cafearticle' | 'kin';

async function fetchNaver(
  type: NaverType,
  keyword: string,
  source: DeskSourceId,
  range: DeskDateRange,
): Promise<DeskArticle[]> {
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) return [];
  // Use `sort=date` whenever a range is set so we get the recent slice first
  // before post-filtering. KIN doesn't support date sort.
  const sort = (range.from || range.to) && type !== 'kin' ? 'date' : 'sim';
  // Naver: max display=100, start in 1..1000. Loop pages of 100 until target.
  const display = 100;
  const out: DeskArticle[] = [];
  for (let start = 1; start <= 1000 && out.length < TARGET; start += display) {
    const url = `https://openapi.naver.com/v1/search/${type}.json?query=${encodeURIComponent(
      keyword,
    )}&display=${display}&start=${start}&sort=${sort}`;
    const res = await safeFetch(url, {
      headers: {
        'X-Naver-Client-Id': id,
        'X-Naver-Client-Secret': secret,
        accept: 'application/json',
      },
    });
    if (!res.ok) break;
    const json = (await res.json()) as { items?: NaverItem[]; total?: number };
    const items = json.items ?? [];
    if (items.length === 0) break;
    for (const it of items) {
      const title = it.title ? stripHtml(it.title) : '';
      const link = it.link ?? '';
      if (!title || !link) continue;
      const snippet = it.description ? stripHtml(it.description).slice(0, 280) : undefined;
      const publishedAt = it.pubDate
        ? it.pubDate
        : it.postdate && it.postdate.length === 8
          ? `${it.postdate.slice(0, 4)}-${it.postdate.slice(4, 6)}-${it.postdate.slice(6, 8)}`
          : undefined;
      if (!inRange(publishedAt, range)) continue;
      out.push({
        source,
        title,
        url: link,
        snippet,
        publishedAt,
        origin: it.bloggername || it.cafename,
        keyword,
      });
    }
    if (items.length < display) break;
  }
  return out.slice(0, TARGET);
}

// ─── Kakao Search API ───────────────────────────────────────────────────────
type KakaoDoc = {
  title?: string;
  contents?: string;
  url?: string;
  datetime?: string;
  blogname?: string;
  cafename?: string;
};
type KakaoType = 'web' | 'blog' | 'cafe';

async function fetchKakao(
  type: KakaoType,
  keyword: string,
  source: DeskSourceId,
  range: DeskDateRange,
): Promise<DeskArticle[]> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return [];
  const sort = range.from || range.to ? 'recency' : 'accuracy';
  // Kakao: max size=50, page up to 50. Loop until is_end or target hit.
  const size = 50;
  const out: DeskArticle[] = [];
  for (let page = 1; page <= Math.ceil(TARGET / size) && out.length < TARGET; page++) {
    const url = `https://dapi.kakao.com/v2/search/${type}?query=${encodeURIComponent(
      keyword,
    )}&size=${size}&page=${page}&sort=${sort}`;
    const res = await safeFetch(url, {
      headers: { Authorization: `KakaoAK ${key}` },
    });
    if (!res.ok) break;
    const json = (await res.json()) as {
      documents?: KakaoDoc[];
      meta?: { is_end?: boolean; pageable_count?: number };
    };
    const docs = json.documents ?? [];
    if (docs.length === 0) break;
    for (const d of docs) {
      const title = d.title ? stripHtml(d.title) : '';
      const link = d.url ?? '';
      if (!title || !link) continue;
      const snippet = d.contents ? stripHtml(d.contents).slice(0, 280) : undefined;
      if (!inRange(d.datetime, range)) continue;
      out.push({
        source,
        title,
        url: link,
        snippet,
        publishedAt: d.datetime,
        origin: d.blogname || d.cafename,
        keyword,
      });
    }
    if (json.meta?.is_end) break;
  }
  return out.slice(0, TARGET);
}

// ─── YouTube Data API v3 ────────────────────────────────────────────────────
type YouTubeItem = {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    channelTitle?: string;
  };
};

async function fetchYouTube(
  keyword: string,
  locale: 'ko' | 'en',
  range: DeskDateRange,
): Promise<DeskArticle[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];
  const { after, before } = rangeToRfc3339(range);
  // YouTube: max 50/page. We intentionally do NOT paginate even though the
  // shared TARGET is higher — search.list costs 100 quota units/call and the
  // daily quota is 10,000. Going to 500 here would burn 1000u per (kw × src),
  // i.e. half the daily budget on a single search with 5 keywords.
  const params = new URLSearchParams({
    part: 'snippet',
    q: keyword,
    type: 'video',
    maxResults: '50',
    relevanceLanguage: locale === 'ko' ? 'ko' : 'en',
    key,
  });
  if (after) params.set('publishedAfter', after);
  if (before) params.set('publishedBefore', before);
  const res = await safeFetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!res.ok) return [];
  const json = (await res.json()) as { items?: YouTubeItem[] };
  const out: DeskArticle[] = [];
  for (const it of json.items ?? []) {
    const videoId = it.id?.videoId;
    if (!videoId) continue;
    const title = it.snippet?.title ? stripHtml(it.snippet.title) : '';
    if (!title) continue;
    out.push({
      source: 'youtube',
      title,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      snippet: it.snippet?.description
        ? stripHtml(it.snippet.description).slice(0, 280)
        : undefined,
      publishedAt: it.snippet?.publishedAt,
      origin: it.snippet?.channelTitle,
      keyword,
    });
  }
  return out;
}

// ─── Dispatch + missing-key detection ───────────────────────────────────────
export function sourceMissingKey(source: DeskSourceId): string | null {
  if (source.startsWith('naver_')) {
    if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
      return 'NAVER_CLIENT_ID / NAVER_CLIENT_SECRET';
    }
  }
  if (source.startsWith('kakao_')) {
    if (!process.env.KAKAO_REST_API_KEY) return 'KAKAO_REST_API_KEY';
  }
  if (source === 'youtube') {
    if (!process.env.YOUTUBE_API_KEY) return 'YOUTUBE_API_KEY';
  }
  return null;
}

export async function crawlSource(
  source: DeskSourceId,
  keyword: string,
  locale: 'ko' | 'en' = 'ko',
  range: DeskDateRange = {},
): Promise<DeskArticle[]> {
  try {
    switch (source) {
      case 'google_news':
        return await fetchGoogleNews(keyword, locale, range);
      case 'hacker_news':
        return await fetchHackerNews(keyword, range);
      case 'reddit':
        return await fetchReddit(keyword, range);
      case 'naver_news':
        return await fetchNaver('news', keyword, source, range);
      case 'naver_blog':
        return await fetchNaver('blog', keyword, source, range);
      case 'naver_cafe':
        return await fetchNaver('cafearticle', keyword, source, range);
      case 'naver_kin':
        return await fetchNaver('kin', keyword, source, range);
      case 'kakao_web':
        return await fetchKakao('web', keyword, source, range);
      case 'kakao_blog':
        return await fetchKakao('blog', keyword, source, range);
      case 'kakao_cafe':
        return await fetchKakao('cafe', keyword, source, range);
      case 'youtube':
        return await fetchYouTube(keyword, locale, range);
    }
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

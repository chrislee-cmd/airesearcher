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

function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).trim();
}

function safeFetch(url: string, init?: RequestInit, timeoutMs = 10_000): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  return fetch(url, { ...init, signal: ac.signal }).finally(() => clearTimeout(t));
}

// ─── Google News (RSS) ──────────────────────────────────────────────────────
async function fetchGoogleNews(keyword: string, locale: 'ko' | 'en'): Promise<DeskArticle[]> {
  const hl = locale === 'ko' ? 'ko' : 'en-US';
  const gl = locale === 'ko' ? 'KR' : 'US';
  const ceid = locale === 'ko' ? 'KR:ko' : 'US:en';
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
  const res = await safeFetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) return [];
  const xml = await res.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 10);
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
    .filter((a) => a.title && a.url);
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
): Promise<DeskArticle[]> {
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) return [];
  const url = `https://openapi.naver.com/v1/search/${type}.json?query=${encodeURIComponent(
    keyword,
  )}&display=10&sort=sim`;
  const res = await safeFetch(url, {
    headers: {
      'X-Naver-Client-Id': id,
      'X-Naver-Client-Secret': secret,
      accept: 'application/json',
    },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { items?: NaverItem[] };
  return (json.items ?? [])
    .map((it) => {
      const title = it.title ? stripHtml(it.title) : '';
      const link = it.link ?? '';
      const snippet = it.description ? stripHtml(it.description).slice(0, 280) : undefined;
      const publishedAt = it.pubDate
        ? it.pubDate
        : it.postdate && it.postdate.length === 8
          ? `${it.postdate.slice(0, 4)}-${it.postdate.slice(4, 6)}-${it.postdate.slice(6, 8)}`
          : undefined;
      const origin = it.bloggername || it.cafename;
      return { source, title, url: link, snippet, publishedAt, origin, keyword };
    })
    .filter((a) => a.title && a.url);
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
): Promise<DeskArticle[]> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return [];
  const url = `https://dapi.kakao.com/v2/search/${type}?query=${encodeURIComponent(
    keyword,
  )}&size=10&sort=accuracy`;
  const res = await safeFetch(url, {
    headers: { Authorization: `KakaoAK ${key}` },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { documents?: KakaoDoc[] };
  return (json.documents ?? [])
    .map((d) => {
      const title = d.title ? stripHtml(d.title) : '';
      const snippet = d.contents ? stripHtml(d.contents).slice(0, 280) : undefined;
      return {
        source,
        title,
        url: d.url ?? '',
        snippet,
        publishedAt: d.datetime,
        origin: d.blogname || d.cafename,
        keyword,
      };
    })
    .filter((a) => a.title && a.url);
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

async function fetchYouTube(keyword: string, locale: 'ko' | 'en'): Promise<DeskArticle[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];
  const params = new URLSearchParams({
    part: 'snippet',
    q: keyword,
    type: 'video',
    maxResults: '10',
    relevanceLanguage: locale === 'ko' ? 'ko' : 'en',
    key,
  });
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
): Promise<DeskArticle[]> {
  try {
    switch (source) {
      case 'google_news':
        return await fetchGoogleNews(keyword, locale);
      case 'hacker_news':
        return await fetchHackerNews(keyword);
      case 'reddit':
        return await fetchReddit(keyword);
      case 'naver_news':
        return await fetchNaver('news', keyword, source);
      case 'naver_blog':
        return await fetchNaver('blog', keyword, source);
      case 'naver_cafe':
        return await fetchNaver('cafearticle', keyword, source);
      case 'naver_kin':
        return await fetchNaver('kin', keyword, source);
      case 'kakao_web':
        return await fetchKakao('web', keyword, source);
      case 'kakao_blog':
        return await fetchKakao('blog', keyword, source);
      case 'kakao_cafe':
        return await fetchKakao('cafe', keyword, source);
      case 'youtube':
        return await fetchYouTube(keyword, locale);
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

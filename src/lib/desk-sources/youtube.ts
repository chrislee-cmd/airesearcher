import { env } from '@/env';
import type { DeskArticle, DeskRegion, DeskSourceDefinition } from './types';
import { rangeToRfc3339, safeFetch, stripHtml } from './helpers';

const YOUTUBE_BY_REGION: Record<DeskRegion, { regionCode: string; lang: string }> = {
  KR: { regionCode: 'KR', lang: 'ko' },
  US: { regionCode: 'US', lang: 'en' },
  SG: { regionCode: 'SG', lang: 'en' },
  MY: { regionCode: 'MY', lang: 'ms' },
  TH: { regionCode: 'TH', lang: 'th' },
  JP: { regionCode: 'JP', lang: 'ja' },
  GLOBAL: { regionCode: 'US', lang: 'en' },
};

type YouTubeItem = {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    channelTitle?: string;
  };
};

export const youtube: DeskSourceDefinition = {
  id: 'youtube',
  category: 'video',
  group: 'youtube',
  label: '유튜브',
  labelEn: 'YouTube',
  hint: '영상 제목·설명·채널',
  envKeys: ['YOUTUBE_API_KEY'],
  async fetch({ keyword, region, range, limit }) {
    const key = env.YOUTUBE_API_KEY;
    if (!key) return [];
    const { after, before } = rangeToRfc3339(range);
    const yt = YOUTUBE_BY_REGION[region];
    // YouTube: max 50/page. We intentionally do NOT paginate — search.list
    // costs 100 quota units/call and daily quota is 10,000. The per-keyword
    // limit caps the single-call maxResults at 50.
    const params = new URLSearchParams({
      part: 'snippet',
      q: keyword,
      type: 'video',
      maxResults: String(Math.min(50, Math.max(1, limit))),
      regionCode: yt.regionCode,
      relevanceLanguage: yt.lang,
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
    return out.slice(0, limit);
  },
};

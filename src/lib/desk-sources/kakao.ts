// Shared Kakao (Daum) Search API fetcher. The three Kakao sources (web/blog/
// cafe) differ only by API `type` + metadata, so they share one paginating
// fetcher built here and each thin `kakao-*.ts` module supplies its definition.

import { env } from '@/env';
import type { DeskSourceFetcher, DeskSourceId } from './types';
import { inRange, safeFetch, stripHtml } from './helpers';

type KakaoDoc = {
  title?: string;
  contents?: string;
  url?: string;
  datetime?: string;
  blogname?: string;
  cafename?: string;
};
export type KakaoType = 'web' | 'blog' | 'cafe';

export function kakaoFetcher(type: KakaoType, source: DeskSourceId): DeskSourceFetcher {
  return async ({ keyword, range, limit }) => {
    const key = env.KAKAO_REST_API_KEY;
    if (!key) return [];
    const sort = range.from || range.to ? 'recency' : 'accuracy';
    // Kakao: max size=50, page up to 50. Loop until is_end or limit hit.
    const size = 50;
    const out = [];
    for (let page = 1; page <= Math.ceil(limit / size) && out.length < limit; page++) {
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
    return out.slice(0, limit);
  };
}

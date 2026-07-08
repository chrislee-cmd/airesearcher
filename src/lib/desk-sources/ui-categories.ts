// UI-facing category grouping for the desk source picker. This is a *presentation
// layer* only: the backend registry (`registry.ts`) and each source's own
// `category` field are untouched. The picker used to expose 20 individual source
// checkboxes; the grid picker instead offers 5 coarse, all-or-nothing category
// cards, and selecting a card expands to every source id it maps to.
//
// The 5 categories partition all 20 registered sources exactly once — no source
// is omitted and none appears twice. Blog-flavoured sources (naver_blog,
// kakao_blog, hacker_news) are folded into `news` (뉴스·포털) per the spec's
// worker-choice recommendation. Video (youtube) is likewise a `news` member, not
// its own category (user decision: 5 categories, no separate Video card).
//
// Labels come from i18n (`Desk.category.*`, which already carries ko + en) so
// this module only owns the icon + source-id mapping.

import type { DeskSourceId } from './types';

// The 5 picker categories — a strict subset of `DeskSourceCategory` (drops the
// descriptive-only `thought` / `video` values that have no sources yet).
export type UICategory = 'news' | 'community' | 'stats' | 'academic' | 'institute';

// Display order of the cards in the grid popover (row-major, 2 columns).
export const UI_CATEGORY_ORDER: UICategory[] = [
  'news',
  'community',
  'stats',
  'academic',
  'institute',
];

export const UI_CATEGORY_META: Record<UICategory, { icon: string; sourceIds: DeskSourceId[] }> = {
  news: {
    icon: '📰',
    // naver_blog / kakao_blog / hacker_news folded in here (worker choice — the
    // spec left blog-source placement to the worker and recommended 뉴스·포털).
    sourceIds: [
      'naver_news',
      'naver_blog',
      'kakao_web',
      'kakao_blog',
      'google_news',
      'gdelt_news',
      'hacker_news',
      'youtube',
    ],
  },
  community: {
    icon: '💬',
    sourceIds: ['naver_cafe', 'naver_kin', 'kakao_cafe', 'reddit'],
  },
  stats: {
    icon: '📊',
    sourceIds: ['kosis', 'atfis', 'dart', 'sec_edgar', 'boj_ecos'],
  },
  academic: {
    icon: '🎓',
    sourceIds: ['kci', 'arxiv', 'semantic_scholar'],
  },
  institute: {
    icon: '🏛',
    sourceIds: ['institutes_kr'],
  },
};

// Core desk-research source types. Split out of the old flat `desk-sources.ts`
// so that each source module and the registry can import shared types without
// pulling in the whole registry (avoids a runtime import cycle: source modules
// depend only on types/helpers, registry depends on source modules).

export type DeskSourceId =
  // Naver Search API
  | 'naver_news'
  | 'naver_blog'
  | 'naver_cafe'
  | 'naver_kin'
  // Kakao (Daum) Search API
  | 'kakao_web'
  | 'kakao_blog'
  | 'kakao_cafe'
  // YouTube
  | 'youtube'
  // Global
  | 'google_news'
  | 'gdelt_news'
  | 'hacker_news'
  | 'reddit'
  // Korea disclosures (DART / FSS)
  | 'dart';

export type DeskSourceGroup = 'naver' | 'kakao' | 'youtube' | 'global' | 'dart';

// UI-facing category, one level coarser than `group`. Introduced to prepare the
// source picker for category grouping as the source count grows past 12. Purely
// descriptive metadata today — no runtime branch keys off it yet.
export type DeskSourceCategory =
  | 'news' // 뉴스·포털
  | 'community' // 커뮤니티
  | 'academic' // 학술·논문
  | 'stats' // 시장 통계
  | 'institute' // 산하 연구소
  | 'thought' // Thought leader
  | 'video'; // Video/Podcast

// Target region for crawling. Independent of UI locale: a Korean researcher
// can target the US, and an English-speaking researcher can target Korea.
// 'GLOBAL' means "no specific country" (Google News pulls international, etc).
export type DeskRegion =
  | 'KR'
  | 'US'
  | 'SG'
  | 'MY'
  | 'TH'
  | 'JP'
  | 'GLOBAL';

// YYYY-MM-DD bounds. Optional both ends — an empty range means "no filter".
export type DeskDateRange = { from?: string; to?: string };

export type DeskArticle = {
  source: DeskSourceId;
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
  origin?: string;
  keyword: string;
  // Domain-tier classification — populated by `classifyTier` after dedupe.
  // Optional so older code paths and persisted rows from before PR-1 stay
  // valid; downstream code should fall back to 'unknown' if missing.
  tier?: 'T1' | 'T2' | 'T3' | 'unknown';
};

// The single crawl entry point every source module implements. Region is always
// passed but region-agnostic sources (Naver/Kakao/Reddit/HackerNews) simply
// ignore it — the caller decides which (source × region) targets to fire.
export type DeskSourceFetcher = (params: {
  keyword: string;
  region: DeskRegion;
  range: DeskDateRange;
  limit: number;
}) => Promise<DeskArticle[]>;

// A source = its own self-contained module. Adding a source is: (1) create
// `<source>.ts` exporting one of these, (2) register it in `registry.ts`.
export interface DeskSourceDefinition {
  id: DeskSourceId;
  category: DeskSourceCategory;
  group: DeskSourceGroup;
  label: string;
  labelEn: string;
  hint: string;
  // Restrict this source to specific regions (metadata — used by the picker to
  // hide sources that would return nothing off-region). Absent = all regions.
  regionOnly?: DeskRegion[];
  // Env keys required for this source to run. Missing any → source is dropped
  // from `getEnabledSources()` (auto-disable, never throws).
  envKeys?: string[];
  fetch: DeskSourceFetcher;
}

// Back-compat alias. Older code referred to source metadata as `DeskSourceMeta`;
// `DeskSourceDefinition` is a superset (adds category / regionOnly / envKeys /
// fetch), so anything typed against the old shape still holds.
export type DeskSourceMeta = Pick<
  DeskSourceDefinition,
  'id' | 'group' | 'label' | 'labelEn' | 'hint'
>;

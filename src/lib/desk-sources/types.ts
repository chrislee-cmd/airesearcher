// Core desk-research source types. Split out of the old flat `desk-sources.ts`
// so that each source module and the registry can import shared types without
// pulling in the whole registry (avoids a runtime import cycle: source modules
// depend only on types/helpers, registry depends on source modules).

import type { MacroObservation } from '@/lib/global-macro/normalize';

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
  | 'dart'
  // US disclosures (SEC EDGAR — 미국 상장사 재무 XBRL, DART 의 미국 등가)
  | 'sec_edgar'
  // Korean academic
  | 'kci'
  // Academic (global, keyless)
  // Academic (global)
  | 'semantic_scholar'
  | 'arxiv'
  // Bank of Korea ECOS (경제통계시스템)
  | 'boj_ecos'
  // Japan statistics portal (e-Stat — KOSIS 의 일본 등가)
  | 'estat'
  // Japan disclosures (EDINET — DART 의 일본 등가, 상장사 재무 XBRL)
  | 'edinet'
  // Stats (market TAM/SAM)
  | 'kosis'
  // aTFIS 식품산업통계 — 가공식품 세분시장 시장규모 (소비재 TAM)
  | 'atfis'
  // Global macro baseline (초국가·키X) — G7 GDP·산업 대비 기준선
  | 'world_bank'
  | 'oecd'
  // Korean research institutes (RSS aggregate)
  | 'institutes_kr'
  // Web search (Tavily) — 공식 소스 미검출 시 웹 근거 보강용 보조 소스(D 하이브리드
  // fallback 기반, #597). tier 는 classifyTier 가 도메인으로 자동 부여.
  | 'web_search';

export type DeskSourceGroup =
  | 'naver'
  | 'kakao'
  | 'youtube'
  | 'global'
  | 'dart'
  | 'sec'
  | 'academic_kr'
  | 'bok'
  | 'estat'
  | 'edinet'
  | 'kosis'
  | 'atfis'
  | 'global_macro'
  | 'institute_kr';

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
  // Primary numeric evidence marker. Set only by sources that emit an explicit
  // metric an analyst would cite verbatim — DART 매출 headline, KOSIS 통계행.
  // market-mode 샘플링(route.ts splitPinnedPrimary)이 이 근거를 임베딩 클러스터링
  // dropout 에서 보호(pin)하는 데 쓴다. 뉴스/일반 소스는 미설정(undefined).
  kind?: 'metric';
  // 구조화된 매크로 관측치 — World Bank/OECD 만 채운다(국가×지표×USD 원값). P3
  // "국내 vs G7 대비" 차트가 문자열 파싱 없이 이 값으로 코드 정규화(정렬·USD 표기)
  // 한다. 옵셔널 — 매크로 외 소스·이전 저장 row 는 미설정(undefined).
  macro?: MacroObservation;
  // 구조화된 상장사 매출 시계열 — DART 매출 headline article 만 채운다(#457 이
  // fnlttSinglAcntAll 응답에서 뽑은 당기/전기/전전기 3기간 원값). "주요 기업 매출"
  // 차트가 이 값으로 코드에서 grouped bar + YoY 를 만든다 — snippet 텍스트 파싱이
  // 아니라 구조화 값 그대로라 표·차트 수치가 항상 일치한다(#461 정책). 옵셔널 —
  // DART 매출 외 article·이전 저장 row 는 미설정(undefined).
  financials?: DeskRevenueObservation;
};

// DART 매출 headline article 에 실리는 구조화 매출 시계열. amount 는 원 단위
// 원값(결측 기간은 null → "데이터 확보 실패"). cumulative 는 분기/반기 누적
// 기준 여부(YoY 동일기준 판정용 — DartPeriodValue 와 동일 의미). period 는
// "2024 연간" 처럼 기준 기간 라벨.
export type DeskRevenueObservation = {
  company: string;
  sourceUrl: string;
  period: string;
  periods: { year: number; amount: number | null; cumulative: boolean }[];
};

// Why a source produced 0 usable articles when the cause is an API-side error
// rather than a genuine "no results". Surfacing this is the whole point of the
// error channel: a bad KOSIS key (err=11) used to return `[]`, indistinguishable
// from "0 results", so it stayed latent for days (2026-07-06 incident).
//   - invalid_key   키가 틀림/등록 안 됨/사용중지 (KOSIS err=11, DART 010, 401 …)
//   - rate_limited  요청 한도 초과 (HTTP 429, DART 020, KOSIS 요청제한, S2 throttle)
//   - fetch_failed  timeout / 5xx / 파싱 실패 등 일시 오류
export type DeskSourceErrorReason = 'invalid_key' | 'rate_limited' | 'fetch_failed';

// Why a source was skipped or failed, as persisted in `desk_jobs.skipped` and
// rendered by the result banner. `no_key` is decided before the crawl (missing
// env key); the three DeskSourceErrorReason values are decided during the crawl
// (API-side failure). One entry per affected source.
export type DeskSkipReason = 'no_key' | DeskSourceErrorReason;

export type DeskSkippedEntry = {
  source: DeskSourceId;
  reason: DeskSkipReason;
  // Which env key(s) are missing — only set for reason 'no_key'.
  missing?: string;
};

// A source fetch either returns a plain article array (success / genuine empty)
// or this richer shape when it needs to report *why* it came back empty. The
// registry-level `crawlSource` normalises both into `DeskFetchResult`, so a
// source module can keep returning a bare array (back-compat) or opt in to the
// error channel by returning `{ articles, error }`. New sources SHOULD report
// errors via `{ articles: [], error }` instead of swallowing them into `[]`.
export type DeskFetchResult = {
  articles: DeskArticle[];
  error?: DeskSourceErrorReason;
};

// The single crawl entry point every source module implements. Region is always
// passed but region-agnostic sources (Naver/Kakao/Reddit/HackerNews) simply
// ignore it — the caller decides which (source × region) targets to fire.
// A module may return a bare `DeskArticle[]` (no error signalling) or a
// `DeskFetchResult` to classify an API-side failure (see DeskSourceErrorReason).
export type DeskSourceFetcher = (params: {
  keyword: string;
  region: DeskRegion;
  range: DeskDateRange;
  limit: number;
}) => Promise<DeskArticle[] | DeskFetchResult>;

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

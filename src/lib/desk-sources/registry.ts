// Source registry — the single place that assembles every source module into a
// lookup table. Adding a source is: (1) create `<source>.ts` exporting a
// `DeskSourceDefinition`, (2) import it here and add one line to the registry.
// No other file needs to change.

import { env } from '@/env';
import type { DeskSourceDefinition, DeskSourceId } from './types';
import { naverNews } from './naver-news';
import { naverBlog } from './naver-blog';
import { naverCafe } from './naver-cafe';
import { naverKin } from './naver-kin';
import { kakaoWeb } from './kakao-web';
import { kakaoBlog } from './kakao-blog';
import { kakaoCafe } from './kakao-cafe';
import { youtube } from './youtube';
import { googleNews } from './google-news';
import { gdeltNews } from './gdelt-news';
import { hackerNews } from './hacker-news';
import { reddit } from './reddit';
import { dart } from './dart';
import { secEdgar } from './sec-edgar';
import { kci } from './kci';
import { semanticScholar } from './semantic-scholar';
import { arxiv } from './arxiv';
import { bojEcos } from './boj-ecos';
import { estat } from './estat';
import { edinet } from './edinet';
import { kosis } from './kosis';
import { atfis } from './atfis';
import { worldBank } from './worldbank';
import { oecd } from './oecd';
import { institutesRss } from './institutes-rss';
import { webSearch } from './web-search';

// Insertion order here defines UI ordering (via `DESK_SOURCES` below). Keep it
// stable — the source picker and the report's per-channel sections read it.
export const DESK_SOURCE_REGISTRY: Record<DeskSourceId, DeskSourceDefinition> = {
  naver_news: naverNews,
  naver_blog: naverBlog,
  naver_cafe: naverCafe,
  naver_kin: naverKin,
  kakao_web: kakaoWeb,
  kakao_blog: kakaoBlog,
  kakao_cafe: kakaoCafe,
  youtube: youtube,
  google_news: googleNews,
  gdelt_news: gdeltNews,
  hacker_news: hackerNews,
  reddit: reddit,
  dart: dart,
  sec_edgar: secEdgar,
  kci: kci,
  semantic_scholar: semanticScholar,
  arxiv: arxiv,
  boj_ecos: bojEcos,
  estat: estat,
  edinet: edinet,
  kosis: kosis,
  atfis: atfis,
  world_bank: worldBank,
  oecd: oecd,
  institutes_kr: institutesRss,
  // 보조 소스 — 공식 소스 미검출 시 웹 근거 보강. UI 순서상 맨 끝.
  web_search: webSearch,
};

export const DESK_SOURCES: DeskSourceDefinition[] = Object.values(DESK_SOURCE_REGISTRY);

// Sources whose required env keys are all present. A source with no `envKeys`
// is always enabled (e.g. Google News / GDELT / HN / Reddit need no key).
// Auto-disable, never throws — a missing key just drops the source.
export function getEnabledSources(
  environment: Record<string, string | undefined> = env as Record<string, string | undefined>,
): DeskSourceId[] {
  return DESK_SOURCES.filter(
    (s) => !s.envKeys || s.envKeys.every((k) => !!environment[k]),
  ).map((s) => s.id);
}

// The env key(s) a source needs but is currently missing, joined for display.
// Returns null when the source is runnable. Replaces the old hand-written
// per-prefix switch — the answer now derives from each definition's `envKeys`.
export function sourceMissingKey(
  id: DeskSourceId,
  environment: Record<string, string | undefined> = env as Record<string, string | undefined>,
): string | null {
  const def = DESK_SOURCE_REGISTRY[id];
  if (!def?.envKeys || def.envKeys.length === 0) return null;
  const missing = def.envKeys.some((k) => !environment[k]);
  return missing ? def.envKeys.join(' / ') : null;
}

import { env } from '@/env';
import type { DeskArticle, DeskSourceDefinition } from './types';
import { searchWeb } from '@/lib/web-search/tavily';

// 웹 검색(Tavily) 소스 어댑터 — D 하이브리드 fallback 의 기반.
//
// 구조화 공식 소스(DART/KOSIS 등)가 비었을 때 맥락 근거를 채우기 위한 보조
// 소스. 이미 프로덕션 검증된 `searchWeb`(탑라인 웹모드 backing)을 그대로 래핑해
// `WebResult[]` → `DeskArticle[]` 로 매핑만 한다. 새 프로바이더/키 도입 없음.
//
// 스코프(#597): "소스로서 존재 + 수동 선택 시 동작"까지만. 자동 fallback 트리거
// (구조화 0건 감지 → 웹서치 발동)와 market/trend 소스 세트 주입은 후속 #599.
//
// tier: 여기서 tier 를 설정하지 않는다 — dedupe 후 `classifyTier` 가 URL 도메인
// 으로 T1/T2/T3 를 자동 부여한다(bloomberg/gov → T1, 블로그 → T3). 격리가 기존
// 메커니즘으로 공짜라 별도 tier 로직을 넣지 않는다.
//
// kind/financials/macro: 절대 미설정. 웹서치는 수치 headline 근거가 아니라(TAM/
// SAM pin 대상 아님) 맥락 보강용 텍스트 근거다.

// URL 에서 호스트명(www. 제거)만 뽑아 origin 라벨로 쓴다. 파싱 실패 시 undefined.
function hostOf(url: string): string | undefined {
  try {
    const h = new URL(url).hostname;
    return h.startsWith('www.') ? h.slice(4) : h;
  } catch {
    return undefined;
  }
}

export const webSearch: DeskSourceDefinition = {
  id: 'web_search',
  category: 'news',
  group: 'global',
  label: '웹 검색',
  labelEn: 'Web Search',
  hint: '공식 소스 미검출 시 웹 근거 보강',
  envKeys: ['TAVILY_API_KEY'],
  // region 무관 — Tavily 는 지역 필터가 없다. regionOnly 미설정 = 전 지역 허용.
  async fetch({ keyword, limit }) {
    const apiKey = env.TAVILY_API_KEY;
    // 키 없으면 [] degrade. (registry 가 getEnabledSources 에서 이미 자동 비활성
    // 하지만, 수동 경로로 호출돼도 안전하도록 여기서도 방어.)
    if (!apiKey) return [];
    // searchWeb 은 실패(네트워크/비-2xx/파싱)를 던지지 않고 [] 로 degrade 한다.
    const results = await searchWeb(keyword, {
      apiKey,
      maxResults: Math.min(Math.max(limit, 1), 10),
    });
    const out: DeskArticle[] = results.map((r) => ({
      source: 'web_search' as const,
      title: r.title,
      url: r.url,
      // r.content 는 searchWeb 이 이미 2k 로 컷한 발췌 스니펫.
      snippet: r.content || undefined,
      // Tavily 는 게시일을 주지 않는다 → undefined. range 필터는 미설정 시 통과.
      publishedAt: undefined,
      origin: hostOf(r.url),
      keyword,
    }));
    return out.slice(0, limit);
  },
};

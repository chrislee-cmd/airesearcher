// 소스 클래스별 검색어 라우팅 SSOT — market mode 가 사용한다.
//
// 이번 사고(2026-07-06)의 구조 원인: 한 키워드 세트(원문+뉴스형 phrase)를 전
// 소스에 그대로 던졌다. 그런데 소스 클래스마다 알아듣는 검색어가 다르다:
//   - stat_catalog(KOSIS) = 짧은 산업/품목 명사(stat_terms)
//   - macro_stat(ECOS)    = 고정 거시 anchor (시장 키워드론 매칭 0)
//   - company(DART)       = 한글 정식 사명(companies)
//   - feed(뉴스/학술/커뮤니티/유튜브) = 원문 + phrase
//
// 이 모듈은 클래스 판정 + ECOS anchor + KOSIS 결정론 fallback 토큰만 둔다.
// client-safe(순수 상수/함수, env·LLM 의존 없음).

import type { DeskSourceId } from '@/lib/desk-sources';

// 통계 카탈로그 검색(searchNm) 소스 — stat_terms(짧은 명사)로만 crawl 한다.
export const STAT_CATALOG_SOURCES = new Set<DeskSourceId>(['kosis']);

// 거시 경제통계 소스 — 시장 키워드로는 매칭 0 이라 고정 anchor 로 조회한다.
export const MACRO_STAT_SOURCES = new Set<DeskSourceId>(['boj_ecos']);

// 전자공시 소스 — 회사명(companies)으로만 crawl 한다.
export const COMPANY_SOURCES = new Set<DeskSourceId>(['dart']);

// ECOS(한국은행)는 거시 경제통계(환율/GDP/물가)라 시장 키워드("스킨케어 시장")
// 로는 매칭이 0 이다. STAT_NAME.includes(anchor) 필터라 아래 substring 이 관련
// 통계표(대원화환율 / 국내총생산 / 소비자물가지수 …)를 폭넓게 잡는다.
export const MACRO_ANCHORS = ['환율', '국내총생산', '소비자물가지수'];

// stat_terms 가 전부 0건일 때를 대비한 결정론 fallback (LLM 재호출 X). 원 키워드
// 첫 어절에서 흔한 조사/접미어를 떼어 짧은 명사 후보 하나를 만든다. 형태소
// 분석이 아니라 best-effort 라 완벽하진 않지만, "화장품시장" → "화장품" 처럼
// 명백한 케이스는 잡는다. stat_terms 에 이미 없을 때만 보태 쓴다.
const TRAILING_PARTICLES =
  /(시장규모|시장|규모|산업|업계|현황|동향|전망|매출|은|는|이|가|을|를|의|에서|으로|로|와|과|도|만|랑|이랑)$/;

export function firstNounToken(keyword: string): string {
  const first = keyword.trim().split(/\s+/)[0] ?? '';
  let token = first;
  // 접미어를 한 번씩 반복해서 벗긴다 ("화장품시장규모" → "화장품시장" → "화장품").
  let prev = '';
  while (token && token !== prev && token.length > 1) {
    prev = token;
    token = token.replace(TRAILING_PARTICLES, '');
  }
  return token.length > 1 ? token : first;
}

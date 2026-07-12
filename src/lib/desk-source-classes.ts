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

// 통계 카탈로그 검색(searchNm/searchWord) 소스 — stat_terms(짧은 명사)로만 crawl.
// e-Stat 은 KOSIS 의 일본 등가(getStatsList 서버사이드 검색) — 같은 클래스.
export const STAT_CATALOG_SOURCES = new Set<DeskSourceId>(['kosis', 'estat']);

// 거시 경제통계 소스 — 시장 키워드로는 매칭 0 이라 고정 anchor 로 조회한다.
export const MACRO_STAT_SOURCES = new Set<DeskSourceId>(['boj_ecos']);

// 글로벌 매크로 소스(World Bank·OECD) — ECOS 와 같은 부류지만 초국가·G7 축이다.
// 시장 키워드가 아니라 "국가 규모·산업 대분류" 지표 앵커로 조회해 G7 대비 기준선을
// 만든다. 키 없이 동작하고 region 무관(항상 글로벌 비교 컨텍스트로 얹는다).
export const GLOBAL_MACRO_SOURCES = new Set<DeskSourceId>(['world_bank', 'oecd']);

// 매크로 지표 앵커 — 유저 messy 입력을 국가별 지표 코드로 컴파일하는 결정론 축.
// 소스 모듈이 이 앵커를 MACRO_INDICATORS 로 해석한다(수치 생성 X, 코드 선택만).
// GDP=국가 규모, industry/manufacturing=산업 대분류, population=규모 정규화 분모.
// LLM 없이 고정 앵커로 두는 이유: 매크로는 시장별로 달라지지 않는 국가 기준선이라
// ECOS(MACRO_ANCHORS)와 동일하게 결정론이 recall·단순성·정책(추정 X)에 유리하다.
export const GLOBAL_MACRO_ANCHORS = ['gdp', 'industry', 'population'];
// OECD Economic Outlook 은 GDP 계열만 커버 — GDP 앵커만 던진다(나머지는 소스가
// no-op skip 하지만 불필요한 task 를 줄인다). World Bank 는 전 앵커를 받는다.
export const OECD_ANCHORS = ['gdp'];

// 전자공시 소스 — 회사명(companies)으로만 crawl 한다. EDINET 은 DART 의 일본 등가.
export const COMPANY_SOURCES = new Set<DeskSourceId>(['dart', 'edinet']);

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

// stat_term 이 KOSIS 카탈로그에서 0건일 때 한 번 더 시도할 **상위 카테고리어**를
// 만든다 (broaden-on-empty). statTerm 은 이미 짧은 명사지만, parseDeskQuery 가
// 가끔 "스킨케어 시장"/"화장품산업현황" 처럼 수식·범주 접미어가 붙은 채 컴파일해
// 통계 카탈로그에서 0건이 나는 게 빈값의 직접 원인이다. 문자열 끝의 범주/수식
// 접미어를 통째로 떼어 더 넓은 명사(→ 카탈로그 매칭 가능성 ↑)를 반환한다.
// LLM 재호출 X — 순수 결정론. 변화가 없거나 너무 짧아지면 null(재시도 안 함 =
// KOSIS daily-quota 낭비 방지).
const STAT_BROADEN_SUFFIX =
  /(\s*(시장규모|시장|규모|산업|업계|현황|동향|전망|서비스업|서비스|부문|분야))+$/;

export function broadenStatTerm(term: string): string | null {
  const t = term.trim();
  const stripped = t.replace(STAT_BROADEN_SUFFIX, '').trim();
  if (stripped === t || stripped.length <= 1) return null;
  return stripped;
}

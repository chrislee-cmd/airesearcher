// Desk 자연어 → 소스별 검색어 컴파일러 (source-aware query rewrite).
//
// 유저 입력은 항상 무분별한 자연어다 — 조사·수식어·문장형·구어체 ("스킨케어
// 회사 시장규모", "요즘 20대 화장품 뭐 쓰지?", "숙박업 창업하려는데 시장
// 어때?"). 소스마다 알아듣는 형태가 다르다:
//   - 뉴스·학술·유튜브 = 뉴스형 명사구(phrase) 6축 (broader/narrower/lateral)
//   - KOSIS/ECOS 통계 카탈로그 = 1-2어절 산업/품목 명사 (짧은 명사만 hit —
//     "화장품" ✅ / "스킨케어 시장" ❌, 2026-07-06 라이브 프로브로 확정)
//   - DART 공시 = 한글 정식 사명 (회사명 검색이 정확)
//
// 이 파서는 그 셋을 **한 번의 LLM 호출**로 뽑는다. runMarket / runCustom(통계·
// 공시 소스 선택 시)이 실행 계획을 만들기 직전에 호출하고, 결과는 소스 클래스
// 별 crawl 검색어 + AI 판단 로그에 쓰인다.
//
// 실패해도 절대 throw 하지 않는다 — 빈 구조를 돌려 crawl 이 원 키워드만으로라도
// 진행되게 한다 (LLM 이 임의 회사/통계를 지어내지 않는 것이 market mode citation
// 원칙과 일관).
//
// server 전용 모듈 — orchestrator(market.ts / custom.ts)만 import (env / LLM 의존).

import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { env } from '@/env';
import { ZERO_RETENTION } from '@/lib/llm/config';
import { getCache, hashString, setCache } from '@/lib/cache';

export type ParsedDeskQuery = {
  // 뉴스/학술/유튜브용 — 원 키워드 외 다양성 축 (broader/narrower/lateral).
  phrases: string[];
  // KOSIS/ECOS 통계 카탈로그용 — 1-2어절 산업/품목 명사.
  statTerms: string[];
  // DART 공시용 — 한글 정식 사명 (없으면 빈 배열).
  companies: string[];
  // 판단 로그 설명용 (선택).
  intent?: string;
};

const EMPTY: ParsedDeskQuery = { phrases: [], statTerms: [], companies: [] };

const ParseSchema = z.object({
  phrases: z.array(z.string()).max(6),
  stat_terms: z.array(z.string()).max(4),
  companies: z.array(z.string()).max(5),
  intent: z.string().optional(),
});

// stat_terms 품질 규칙 + few-shot 5형(messy 입력 대표)을 prompt 에 박제한다.
// 통계 카탈로그는 조사·수식어가 붙은 phrase 를 못 알아듣는다 — 통계청 분류
// 어휘에 가까운 짧은 일반명사여야 한다.
const PARSE_SYSTEM = `당신은 시장·산업 리서치 검색어 컴파일러입니다. 유저가 입력한 **무분별한 자연어**(조사·수식어·문장형·구어체 전부)를 받아, 세 종류의 데이터 소스가 각각 알아듣는 형태로 재작성합니다. 유저에게 "짧게 검색하라"고 요구하지 않습니다 — 파싱은 전적으로 당신의 몫입니다.

세 출력:

1. phrases (뉴스·학술·유튜브용, 최대 6개)
   - 원 키워드보다 상위(broader: 산업/시장 전체), 하위(narrower: 대표 제품군/브랜드 각도), 인접(lateral: 트렌드/전망/수출 등) 축으로 다양성 확보.
   - 각 항목 = 명확한 명사구(질문 X). 원 키워드와 같은 언어(한국어/영어) 유지.
   - 원 키워드 그대로 반복 X.

2. stat_terms (KOSIS/ECOS 통계 카탈로그용, 2-3개)
   - **조사·수식어·서술어 완전 제거, 1-2어절 명사만.** ("화장품" ✅ / "스킨케어 시장" ✗ / "화장품 시장 규모는" ✗)
   - 산업/품목 표준 용어 지향 — 통계청 분류 어휘에 가까운 일반명사 ("화장품", "숙박업", "이차전지").
   - **상위 카테고리 1개 반드시 포함** — 좁은 품목이 0건이어도 상위어가 잡게 한다.
   - 통계로 잡힐 국내 산업/품목이 명확하지 않으면 빈 배열.

3. companies (DART 전자공시용, 최대 5개)
   - 자연어에 회사명이 **명시**돼 있으면 그대로 추출(우선). 예: "아모레퍼시픽 매출" → 아모레퍼시픽.
   - 명시 회사가 없으면 그 시장의 대표 **한국 상장사(코스피/코스닥)** 를 매출 큰 순 최대 5개 추론. 반드시 한글 정식 사명("아모레퍼시픽", "LG생활건강").
   - 상장사만 — 비상장/외국계 본사 제외(DART 에 공시 없음). 뚜렷한 국내 상장사가 없으면 빈 배열(억지로 생성 X).

few-shot (messy 입력 대표 5형):
| 유저 자연어 | stat_terms | companies |
|---|---|---|
| "스킨케어 회사 시장규모" | 화장품, 뷰티 | 아모레퍼시픽, LG생활건강 (추론) |
| "요즘 20대가 쓰는 화장품 뭐가 잘나가?" | 화장품, 화장품 소비 | (추론) |
| "숙박업 창업하려는데 시장 어때?" | 숙박업, 관광 | (상장사 없으면 빈 배열) |
| "전기차 배터리 시장 얼마나 큰지" | 이차전지, 전기차 | LG에너지솔루션, 삼성SDI |
| "아모레퍼시픽 매출 알려줘" | 화장품 | 아모레퍼시픽 (명시 추출 우선) |

intent(선택): "market_size" | "trend" | "company_revenue" 등 유저 의도 한 단어.`;

function getModel() {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return createAnthropic({ apiKey })('claude-sonnet-4-6');
}

function clean(list: string[] | undefined, max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list ?? []) {
    const s = raw.trim().replace(/^[-•\d.\s"'`]+|["'`]+$/g, '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.slice(0, max);
}

// 소스별 검색어 재작성. 실패/키 없음 = 빈 구조(throw X). 캐시는 cross-org
// (유저 무관) — PARSE_SYSTEM 이 바뀌면 버전(v1)을 올린다.
export async function parseDeskQuery(
  keywords: string[],
  locale: 'ko' | 'en',
): Promise<ParsedDeskQuery> {
  const model = getModel();
  if (!model) return EMPTY;

  const cacheKey = `desk-query-parse:v1:${locale}:${hashString(
    keywords.map((k) => k.trim().toLowerCase()).sort().join('|'),
  )}`;
  try {
    const cached = await getCache<ParsedDeskQuery>(cacheKey);
    if (cached && Array.isArray(cached.phrases)) return cached;
  } catch {
    // 캐시 조회 실패는 무시하고 LLM 호출로 진행.
  }

  try {
    const { object } = await generateObject({
      model,
      system: PARSE_SYSTEM,
      prompt: [
        `유저 입력(자연어): ${keywords.join(' / ')}`,
        `요청 언어: ${locale === 'ko' ? '한국어' : 'English'} (단, companies 는 DART 검색용 한글 정식 사명)`,
      ].join('\n'),
      schema: ParseSchema,
      temperature: 0.2,
      maxOutputTokens: 400,
      maxRetries: 1,
      providerOptions: ZERO_RETENTION,
      timeout: 30_000,
    });
    const parsed: ParsedDeskQuery = {
      // phrases 만 원 키워드 반복 배제 (stat_terms/companies 는 원문과 겹쳐도
      // OK — 원 키워드 자체가 유효 통계어/사명일 수 있어 배제하면 recall 손해).
      phrases: clean(object.phrases, 6).filter(
        (p) => !keywords.some((k) => k.trim().toLowerCase() === p.toLowerCase()),
      ),
      statTerms: clean(object.stat_terms, 4),
      companies: clean(object.companies, 5),
      intent: object.intent?.trim() || undefined,
    };
    void setCache(cacheKey, parsed);
    return parsed;
  } catch (err) {
    console.error('[desk] parseDeskQuery failed', err);
    return EMPTY;
  }
}

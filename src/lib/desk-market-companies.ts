// Market mode 회사 축 — 원 키워드에서 DART 조회용 대표 상장사 3-5개를 LLM 이
// 추출한다. runMarket(orchestrator)이 실행 계획을 만들기 직전에 한 번 호출하며,
// 결과는 DART crawl 의 검색어(공시는 회사명 검색이 정확)와 AI 판단 로그에 쓰인다.
//
// 실패해도 절대 throw 하지 않고 빈 배열을 돌린다 — crawl 은 통계·학술·뉴스
// 소스만으로 진행되고, 판단 로그는 "회사 추출 실패"로 명시한다 (LLM 이
// 임의 회사를 지어내지 않게 하는 것이 이 mode 의 citation 원칙과 일관).
//
// server 전용 모듈 — market.ts 만 import 한다 (env / LLM 의존).

import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { env } from '@/env';
import { ZERO_RETENTION } from '@/lib/llm/config';

// DART 는 한국 상장사 전자공시 시스템이라, 영어 키워드가 들어와도 조회 대상은
// 한국 상장사(한글 정식 사명)여야 검색이 맞는다. 시장에 뚜렷한 국내 상장사가
// 없으면(순수 해외 시장 등) 억지로 만들지 말고 빈 결과를 낸다.
const COMPANY_SYSTEM = `당신은 시장 규모(TAM/SAM) 리서치를 돕는 애널리스트입니다.
입력으로 시장/산업 키워드를 받으면, 그 시장의 SAM(유효 시장) 규모를 추정할 근거가 되는
**한국 상장사(코스피/코스닥) 대표 기업 3~5개**를 고릅니다. 이 회사명은 DART 전자공시
검색에 그대로 쓰입니다.

[규칙]
- 반드시 **한글 정식 사명**으로 출력합니다 (DART 검색용). 예: "아모레퍼시픽", "LG생활건강".
- 해당 시장을 대표하고 매출 규모가 큰 순으로 최대 5개.
- 상장사만 — 비상장/외국계 본사는 제외 (DART 에 공시가 없어 조회 실패).
- 시장과 뚜렷이 관련된 국내 상장사가 없으면 **빈 줄 하나만** 출력합니다 (억지로 만들지 않습니다).
- 회사명만 쉼표 또는 줄바꿈으로 구분해 출력합니다. 설명·번호·기타 텍스트 금지.`;

export async function extractMarketCompanies(
  keywords: string[],
  locale: 'ko' | 'en',
): Promise<string[]> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];
  try {
    const { text } = await generateText({
      model: createAnthropic({ apiKey })('claude-sonnet-4-6'),
      system: COMPANY_SYSTEM,
      prompt: [
        `시장/산업 키워드: ${keywords.join(', ')}`,
        `요청 언어: ${locale === 'ko' ? '한국어' : 'English'} (단, 회사명은 DART 검색용 한글 정식 사명으로 출력)`,
      ].join('\n'),
      temperature: 0.2,
      maxOutputTokens: 200,
      maxRetries: 1,
      providerOptions: ZERO_RETENTION,
      timeout: 20_000,
    });
    return text
      .trim()
      .split(/[,\n]/)
      .map((s) => s.trim().replace(/^[-•\d.\s"'`]+|["'`]+$/g, '').trim())
      .filter(Boolean)
      .slice(0, 5);
  } catch (err) {
    console.error('[desk] extractMarketCompanies failed', err);
    return [];
  }
}

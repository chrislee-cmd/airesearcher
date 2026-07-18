import { z } from 'zod';
import { ISOLATION_NOTICE } from '@/lib/llm/sanitize';
import {
  type OutputLang,
  outputLangLabel,
} from '@/lib/i18n/output-language';

// Per-file quote extraction for insights_analyzer (PR 3).
//
// One LLM call per converted markdown file returns the full set of
// per-participant utterances. The shape is 1:1 with the `insights_quotes`
// table columns (migration 0025) so the route can INSERT without a
// translation layer:
//
//   participant_name → insights_quotes.participant_name
//   theme            → insights_quotes.theme            (nullable)
//   sentiment        → insights_quotes.sentiment        (nullable real 0..1)
//   text             → insights_quotes.text             (verbatim)
//   source_offset    → insights_quotes.source_offset    (char idx, nullable)
//
// `source_file` is injected by the route (not the model) — the model
// doesn't see other files and can't know its own filename.
export const insightsQuoteSchema = z.object({
  participant_name: z.string().min(1),
  theme: z.string().nullable(),
  sentiment: z.number().min(0).max(1).nullable(),
  text: z.string().min(1),
  source_offset: z.number().int().min(0).nullable(),
});

export const insightsExtractionSchema = z.object({
  quotes: z.array(insightsQuoteSchema),
});

export type InsightsQuote = z.infer<typeof insightsQuoteSchema>;
export type InsightsExtraction = z.infer<typeof insightsExtractionSchema>;

// Single-pass extraction prompt. Decisions baked in (see PR 3 scope):
//   • lossless: 응답자 발화는 빠짐없이, per-utterance 단위로
//   • single-pass: name + theme + sentiment + text + offset 동시 추출
//     (2-pass 보다 비용·지연 절반, 결과 일관성은 temperature=0.1 로 확보)
//   • 진행자 발화 제외: 분석 대상은 응답자 voice 만
//   • 원문 직접 인용 (번역/요약/재서술 금지) — FTS 가 원문을 그대로 색인
// theme 은 LLM 이 자유 서술하는 라벨이라 출력 언어로 로케일화한다. text(quote)는
// 항상 verbatim 이므로 원문 언어 그대로(아래 규칙 유지). lang 미전달 시 옛 동작
// (입력 언어 추종)을 보존하도록 호출부가 undefined 를 넘기면 directive 를 안 붙인다.
function insightsThemeLangDirective(lang?: OutputLang): string {
  if (!lang) return '';
  return `\n- **theme 라벨은 ${outputLangLabel(lang)}(으)로 작성**합니다(quote 원문은 그대로).`;
}

export function buildInsightsExtractionSystem(lang?: OutputLang): string {
  return `당신은 인사이트 분석가입니다. 단일 인터뷰/리포트 마크다운을 받아, 응답자들의 발화를 quote 단위로 빠짐없이 추출하세요. 결과는 정의된 JSON 스키마만, 그 외 텍스트 금지.

각 quote 항목:

1) **participant_name**
   - 발화자 이름 또는 식별자(예: "P01", "민지", "응답자 A", "이○○"). 마크다운에서 일관되게 쓰인 식별자를 그대로 사용.
   - 진행자/면접관/사회자/모더레이터/M/Q/Moderator/Interviewer 의 발화는 **제외**.
   - 화자 식별이 불가능한 발화는 추출하지 않음 (빈 결과가 정답).

2) **theme** (nullable)
   - 이 quote 가 다루는 핵심 주제를 자유 서술 (예: "가격 민감도", "온라인 구매 경험", "브랜드 충성도").
   - 한 quote 에 한 가지 핵심 주제만. 두 주제가 섞이면 quote 를 둘로 쪼개세요.
   - 명확한 주제를 못 잡으면 null.

3) **sentiment** (nullable, 0..1 실수)
   - 0.0 = 강한 부정, 0.5 = 중립, 1.0 = 강한 긍정. 그 사이 실수.
   - 사실 진술이나 모호한 감정은 null.

4) **text** (필수)
   - 입력 마크다운에 **그대로 존재하는** 응답자 발화를 직접 인용. 번역/요약/재서술/문장 합치기 금지.
   - 길이는 한 문장에서 한 문단까지 자유. 핵심 의미가 살아있을 만큼.
   - 큰따옴표/작은따옴표는 포함하지 마세요 (시스템이 따로 감쌉니다).
   - 본문에서 연속된 텍스트만. 떨어진 문장 두 개를 이어붙이지 마세요.

5) **source_offset** (nullable, 정수)
   - text 가 입력 마크다운에서 시작되는 문자 인덱스 (0-based). 추정해도 됨.
   - 정확히 못 짚겠으면 null.

원칙:
- **빠짐없이**: 응답자가 한 의미 있는 발언은 가능한 모두 quote 로 보존하세요. 한 인터뷰에서 보통 30~150개.
- 동일 응답자의 동일 주제 발화도 별개 utterance 라면 별개 quote.
- 출력은 한국어 quote 면 한국어 그대로, 영어면 영어 그대로 — 언어 변환 금지.${insightsThemeLangDirective(lang)}${ISOLATION_NOTICE}`;
}

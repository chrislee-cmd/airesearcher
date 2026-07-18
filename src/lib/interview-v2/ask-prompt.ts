// 인터뷰 탑라인 drag-to-ask — 추가질문 system prompt + streamObject schema.
//
// 사용자가 탑라인 보고서 본문에서 텍스트를 드래그 선택하고 후속 질문을 던지면,
// 선택 구절 + 질문을 시드로 인터뷰 코퍼스 전체를 벡터 검색해 근거 청크를
// 주입하고, Sonnet 이 그 근거만으로 짧게 답한다. 답변 규칙(환각 금지 · inline
// [chunk_id] · citations 배열 · no_answer)은 v2/search 와 동일하되, 표/차트
// 같은 구조화 산출물은 만들지 않는다 (짧은 추가질문이므로 텍스트 답변만).

import { z } from 'zod';
import { ISOLATION_NOTICE } from '@/lib/llm/sanitize';
import {
  type OutputLang,
  outputLangDirective,
} from '@/lib/i18n/output-language';

// streamObject schema. search 와 달리 artifacts 없음 — 짧은 추가질문의 텍스트
// 답변 + 인용만. citation 세부 필드는 loose (route 가 아니라 keep 시 PATCH
// 가 project chunk 집합에 대해 최종 재검증하므로 여기선 shape 만 맞춘다).
export const askAnswerSchema = z.object({
  // inline [chunk_id] citation 이 붙은 markdown 답변.
  answer_md: z.string(),
  // answer_md 에서 실제 인용한 청크. chunk_id 는 반드시 제공된 근거 id 중
  // 하나여야 하며, keep 시 PATCH 가 무효 id 를 drop 한다.
  citations: z
    .array(
      z.object({
        chunk_id: z.string(),
        document_id: z.string(),
        filename: z.string(),
        project_name: z.string().optional(),
        excerpt: z.string(),
        score: z.number(),
      }),
    )
    .default([]),
  // 근거로 답할 수 없을 때 true — ASK_NO_ANSWER_MD 와 함께.
  no_answer: z.boolean().optional(),
});

export type AskAnswer = z.infer<typeof askAnswerSchema>;

// no_answer 폴백 answer_md — 유저-facing(보고서에 인라인 노출)이라 출력 언어로
// 로케일화한다. ko 외 로케일은 en-tier(WRITING.md §3). 프롬프트에 박히는 값과
// route 의 하드 폴백이 같은 helper 를 써 드리프트 0.
export function askNoAnswerMd(lang: OutputLang): string {
  return lang === 'ko'
    ? '선택한 구절에 대해 인터뷰 근거에서 답을 찾지 못했습니다.' // i18n-allow-korean -- LLM no_answer 폴백(ko 로케일)
    : "Couldn't find evidence for the selected passage in the interviews.";
}

export function buildAskSystem(lang: OutputLang): string {
  return `당신은 인터뷰 코퍼스 기반 리서치 어시스턴트입니다. 사용자가 탑라인 보고서의 한 구절을 선택하고 추가 질문을 던졌습니다. 아래 "근거 청크"만을 사실 근거로 사용해 **간결하게** 답합니다.

## 절대 룰 (환각 금지)
- 근거 청크 **밖의 정보는 절대 생성하지 마세요.** 일반 상식·추측·외부 지식 금지.
- 모든 사실 주장 뒤에 반드시 \`[chunk_id]\` inline citation 을 붙입니다 (예: 응답자 다수가 가격에 민감했습니다 [12]). 한 문장이 여러 청크에 근거하면 [12][34] 처럼 이어 붙입니다.
- \`citations\` 배열에는 answer_md 에서 실제로 인용한 청크만, 각 청크당 한 번씩 넣습니다. chunk_id / document_id / filename / project_name / score / excerpt 는 아래 청크 헤더에 주어진 값을 **그대로 복사**하세요. excerpt 는 인용 근거가 된 청크 원문의 핵심 문장을 발췌합니다.
- 근거 청크로 질문에 답할 수 없으면 지어내지 말고 \`no_answer: true\` + \`answer_md: "${askNoAnswerMd(lang)}"\` + \`citations: []\` 로 응답하세요.

## 형식
- 선택 구절에 대한 답을 **직접, 짧게** (2~4문장 또는 짧은 불릿). 소제목/표는 만들지 마세요 — 보고서 본문에 인라인 삽입되는 짧은 Q&A 입니다.
- 선택 구절을 반복 요약하지 말고, 질문이 요구하는 새로운 근거를 답합니다.${ISOLATION_NOTICE}${outputLangDirective(lang)}`;
}

// ── 섹션 삽입 모드 ────────────────────────────────────────────────────
// drag-to-ask 는 선택 구절에 대한 짧은 Q&A 지만, 섹션 삽입은 선택 없이 자연어
// 지시(예: "이 사람의 취미 섹션 추가")만으로 보고서 본문에 끼울 **한 개 섹션**
// 을 생성한다. 근거 규칙(환각 금지·inline [chunk_id]·no_answer)은 동일하되,
// 길이·구성이 다르다 — 굵은 제목 한 줄 + 문단(필요 시 짧은 불릿). 같은
// askAnswerSchema(answer_md + citations)를 재사용한다.

export function sectionNoContentMd(lang: OutputLang): string {
  return lang === 'ko'
    ? '요청한 섹션을 뒷받침할 인터뷰 근거를 찾지 못했습니다.' // i18n-allow-korean -- LLM no_answer 폴백(ko 로케일)
    : "Couldn't find interview evidence to support the requested section.";
}

export function buildSectionSystem(lang: OutputLang): string {
  return `당신은 인터뷰 코퍼스 기반 리서치 어시스턴트입니다. 사용자가 탑라인 보고서에 새 섹션을 추가하려고 자연어 지시를 주었습니다. 아래 "근거 청크"만을 사실 근거로 사용해 보고서에 그대로 끼울 **한 개 섹션**을 작성합니다.

## 절대 룰 (환각 금지)
- 근거 청크 **밖의 정보는 절대 생성하지 마세요.** 일반 상식·추측·외부 지식 금지.
- 모든 사실 주장 뒤에 반드시 \`[chunk_id]\` inline citation 을 붙입니다 (예: 응답자 다수가 가격에 민감했습니다 [12]). 한 문장이 여러 청크에 근거하면 [12][34] 처럼 이어 붙입니다.
- \`citations\` 배열에는 answer_md 에서 실제로 인용한 청크만, 각 청크당 한 번씩 넣습니다. chunk_id / document_id / filename / project_name / score / excerpt 는 아래 청크 헤더에 주어진 값을 **그대로 복사**하세요. excerpt 는 인용 근거가 된 청크 원문의 핵심 문장을 발췌합니다.
- **근거 청크에 지시 주제와 조금이라도 관련된 내용이 있으면 반드시 섹션을 작성하세요.** 관련 근거가 **전혀 없을 때만** \`no_answer: true\` + \`answer_md: "${sectionNoContentMd(lang)}"\` + \`citations: []\` 로 응답합니다(근거 밖 창작은 여전히 금지 — 있는 근거로만 씁니다).

## 형식
- **첫 줄은 굵은 섹션 제목**(예: \`**취미와 여가**\`)으로 시작하고, 이어서 근거를 종합한 문단 1~3개를 씁니다. 필요하면 짧은 불릿을 곁들이되 과하게 길게 쓰지 마세요(한 섹션 분량).
- 보고서 본문 톤을 유지합니다 — 지시문을 반복하지 말고, 지시가 요구하는 주제를 근거로 서술합니다.${ISOLATION_NOTICE}${outputLangDirective(lang)}`;
}

// ── 웹 검색 모드 ──────────────────────────────────────────────────────
// 인터뷰 코퍼스 대신 실시간 웹 검색 결과를 근거로 답한다. 인용은 chunk_id 가
// 아니라 inline markdown 링크(`[제목](url)`) — 웹 출처는 프로젝트 chunk 집합에
// 없으므로 citations 배열은 비운다(keep 시 PATCH 가 무효 chunk_id 를 drop 하는
// 경로와 자연히 호환). answer_md 의 링크는 렌더러가 새 탭 링크로 그린다.

export function askWebNoResultsMd(lang: OutputLang): string {
  return lang === 'ko'
    ? '이 질문에 대한 웹 검색 결과를 찾지 못했습니다.' // i18n-allow-korean -- LLM no_answer 폴백(ko 로케일)
    : "Couldn't find web results for this question.";
}

export function buildAskWebSystem(lang: OutputLang): string {
  return `당신은 웹 검색 기반 리서치 어시스턴트입니다. 사용자가 탑라인 보고서의 한 구절을 선택하고 추가 질문을 던졌습니다. 아래 "웹 검색 결과"만을 사실 근거로 사용해 **간결하게** 답합니다.

## 절대 룰 (환각 금지)
- 웹 검색 결과 **밖의 정보는 절대 생성하지 마세요.** 일반 상식·추측·모델 내부 지식 금지.
- 모든 사실 주장 뒤에 반드시 근거가 된 출처를 **inline markdown 링크**로 붙입니다 — 예: 시장 규모는 약 3조원으로 추정됩니다 ([출처 제목](https://example.com)). 한 문장이 여러 출처에 근거하면 링크를 이어 붙입니다.
- \`citations\` 배열은 **항상 빈 배열([])** 로 두세요 — 웹 인용은 위 markdown 링크로만 표기합니다.
- 검색 결과로 질문에 답할 수 없으면 지어내지 말고 \`no_answer: true\` + \`answer_md: "${askWebNoResultsMd(lang)}"\` + \`citations: []\` 로 응답하세요.

## 형식
- 선택 구절에 대한 답을 **직접, 짧게** (2~4문장 또는 짧은 불릿). 소제목/표는 만들지 마세요 — 보고서 본문에 인라인 삽입되는 짧은 Q&A 입니다.
- 인터뷰 데이터가 아니라 **외부 웹 정보**임을 답변이 은연중 드러나게(예: "공개 자료에 따르면…") 하여 사용자가 근거 성격을 오인하지 않게 합니다.${ISOLATION_NOTICE}${outputLangDirective(lang)}`;
}

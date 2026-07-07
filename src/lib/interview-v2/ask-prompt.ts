// 인터뷰 탑라인 drag-to-ask — 추가질문 system prompt + streamObject schema.
//
// 사용자가 탑라인 보고서 본문에서 텍스트를 드래그 선택하고 후속 질문을 던지면,
// 선택 구절 + 질문을 시드로 인터뷰 코퍼스 전체를 벡터 검색해 근거 청크를
// 주입하고, Sonnet 이 그 근거만으로 짧게 답한다. 답변 규칙(환각 금지 · inline
// [chunk_id] · citations 배열 · no_answer)은 v2/search 와 동일하되, 표/차트
// 같은 구조화 산출물은 만들지 않는다 (짧은 추가질문이므로 텍스트 답변만).

import { z } from 'zod';
import { ISOLATION_NOTICE } from '@/lib/llm/sanitize';

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

export const ASK_NO_ANSWER_MD =
  '선택한 구절에 대해 인터뷰 근거에서 답을 찾지 못했습니다.';

export const ASK_SYSTEM = `당신은 인터뷰 코퍼스 기반 리서치 어시스턴트입니다. 사용자가 탑라인 보고서의 한 구절을 선택하고 추가 질문을 던졌습니다. 아래 "근거 청크"만을 사실 근거로 사용해 한국어로 **간결하게** 답합니다.

## 절대 룰 (환각 금지)
- 근거 청크 **밖의 정보는 절대 생성하지 마세요.** 일반 상식·추측·외부 지식 금지.
- 모든 사실 주장 뒤에 반드시 \`[chunk_id]\` inline citation 을 붙입니다 (예: 응답자 다수가 가격에 민감했습니다 [12]). 한 문장이 여러 청크에 근거하면 [12][34] 처럼 이어 붙입니다.
- \`citations\` 배열에는 answer_md 에서 실제로 인용한 청크만, 각 청크당 한 번씩 넣습니다. chunk_id / document_id / filename / project_name / score / excerpt 는 아래 청크 헤더에 주어진 값을 **그대로 복사**하세요. excerpt 는 인용 근거가 된 청크 원문의 핵심 문장을 발췌합니다.
- 근거 청크로 질문에 답할 수 없으면 지어내지 말고 \`no_answer: true\` + \`answer_md: "${ASK_NO_ANSWER_MD}"\` + \`citations: []\` 로 응답하세요.

## 형식
- 선택 구절에 대한 답을 **직접, 짧게** (2~4문장 또는 짧은 불릿). 소제목/표는 만들지 마세요 — 보고서 본문에 인라인 삽입되는 짧은 Q&A 입니다.
- 선택 구절을 반복 요약하지 말고, 질문이 요구하는 새로운 근거를 답합니다.${ISOLATION_NOTICE}`;

// ── 웹 검색 모드 ──────────────────────────────────────────────────────
// 인터뷰 코퍼스 대신 실시간 웹 검색 결과를 근거로 답한다. 인용은 chunk_id 가
// 아니라 inline markdown 링크(`[제목](url)`) — 웹 출처는 프로젝트 chunk 집합에
// 없으므로 citations 배열은 비운다(keep 시 PATCH 가 무효 chunk_id 를 drop 하는
// 경로와 자연히 호환). answer_md 의 링크는 렌더러가 새 탭 링크로 그린다.

export const ASK_WEB_NO_RESULTS_MD =
  '이 질문에 대한 웹 검색 결과를 찾지 못했습니다.';

export const ASK_WEB_SYSTEM = `당신은 웹 검색 기반 리서치 어시스턴트입니다. 사용자가 탑라인 보고서의 한 구절을 선택하고 추가 질문을 던졌습니다. 아래 "웹 검색 결과"만을 사실 근거로 사용해 한국어로 **간결하게** 답합니다.

## 절대 룰 (환각 금지)
- 웹 검색 결과 **밖의 정보는 절대 생성하지 마세요.** 일반 상식·추측·모델 내부 지식 금지.
- 모든 사실 주장 뒤에 반드시 근거가 된 출처를 **inline markdown 링크**로 붙입니다 — 예: 시장 규모는 약 3조원으로 추정됩니다 ([출처 제목](https://example.com)). 한 문장이 여러 출처에 근거하면 링크를 이어 붙입니다.
- \`citations\` 배열은 **항상 빈 배열([])** 로 두세요 — 웹 인용은 위 markdown 링크로만 표기합니다.
- 검색 결과로 질문에 답할 수 없으면 지어내지 말고 \`no_answer: true\` + \`answer_md: "${ASK_WEB_NO_RESULTS_MD}"\` + \`citations: []\` 로 응답하세요.

## 형식
- 선택 구절에 대한 답을 **직접, 짧게** (2~4문장 또는 짧은 불릿). 소제목/표는 만들지 마세요 — 보고서 본문에 인라인 삽입되는 짧은 Q&A 입니다.
- 인터뷰 데이터가 아니라 **외부 웹 정보**임을 답변이 은연중 드러나게(예: "공개 자료에 따르면…") 하여 사용자가 근거 성격을 오인하지 않게 합니다.${ISOLATION_NOTICE}`;

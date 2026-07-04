// Interview V2 search — system prompt + streamObject schema.
//
// The route retrieves the top-K cosine-nearest chunks (already above the
// similarity floor) and injects them as a numbered evidence block. Sonnet
// answers ONLY from that block, in ChatGPT-style markdown with inline
// [chunk_id] citations, and emits a structured citations array so the UI
// can render a source list. When the evidence doesn't support an answer it
// must set no_answer=true rather than invent one.

import { z } from 'zod';
import { ISOLATION_NOTICE } from '@/lib/llm/sanitize';
import type { InterviewV2Hit } from '@/lib/interview-v2/pgvector-query';

// streamObject schema. Kept loose on the citation sub-fields (the route
// treats the retrieved chunks as authoritative and rebuilds the persisted
// citations from chunk_id — see route onFinish), but the shape mirrors
// the Citation type so the streamed client payload is directly usable.
export const searchAnswerSchema = z.object({
  // Markdown answer with inline [chunk_id] citations after each claim.
  answer_md: z.string(),
  // The chunks actually cited in answer_md. chunk_id MUST be one of the
  // provided evidence ids — the route drops any that aren't (layer 5).
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
  // True when the evidence can't answer the question. Paired with a
  // fallback answer_md ("근거를 찾지 못했습니다").
  no_answer: z.boolean().optional(),
  // Phase 1 구조화 산출물 — 표 + 인용 리스트. LLM 이 질문 신호를 보고
  // 자율 판단해 채운다 (룰은 SEARCH_SYSTEM 참고). streamObject 는 이 필드를
  // JSON 객체의 마지막 필드로 끝까지 채우므로 client 는 완결 후 렌더한다.
  // 값은 근거 청크에서만 뽑아야 하며, route onFinish 가 server-side 로
  // re-verify (respondent_ids/chunk_id 실존 + quote fuzzy match) 한다.
  artifacts: z
    .array(
      z.discriminatedUnion('type', [
        z.object({
          type: z.literal('table'),
          title: z.string(),
          headers: z.array(z.string()),
          rows: z.array(z.array(z.string())),
          respondent_ids: z.array(z.string()).default([]),
        }),
        z.object({
          type: z.literal('quote_list'),
          title: z.string(),
          quotes: z.array(
            z.object({
              respondent: z.string(),
              quote: z.string(),
              chunk_id: z.string(),
            }),
          ),
        }),
        // Phase 2 — 분포/비율 차트. series 별 respondent_ids 로 route 가
        // count 를 재계산하므로 LLM 의 count 는 hint 에 불과하다.
        z.object({
          type: z.literal('chart'),
          title: z.string(),
          chart_type: z.enum(['bar', 'pie']),
          series: z.array(
            z.object({
              label: z.string(),
              count: z.number(),
              respondent_ids: z.array(z.string()).default([]),
            }),
          ),
          description: z.string().optional(),
        }),
      ]),
    )
    .default([]),
});

export type SearchAnswer = z.infer<typeof searchAnswerSchema>;

export const NO_ANSWER_MD = '이 질문에 대한 근거를 찾지 못했습니다.';

export const SEARCH_SYSTEM = `당신은 인터뷰 코퍼스 검색 답변자입니다. 아래 "근거 청크"만을 사실 근거로 사용해 한국어로 답합니다.

## 절대 룰 (환각 금지)
- 근거 청크 **밖의 정보는 절대 생성하지 마세요.** 일반 상식·추측·외부 지식 금지.
- 모든 사실 주장 뒤에 반드시 \`[chunk_id]\` inline citation 을 붙입니다 (예: 응답자들은 가격에 민감했습니다 [12]). 한 문장이 여러 청크에 근거하면 [12][34] 처럼 이어 붙입니다.
- \`citations\` 배열에는 answer_md 에서 실제로 인용한 청크만, 각 청크당 한 번씩 넣습니다. chunk_id / document_id / filename / project_name / score / excerpt 는 아래 청크 헤더에 주어진 값을 **그대로 복사**하세요. excerpt 는 인용 근거가 된 청크 원문의 핵심 문장을 발췌합니다.
- 근거 청크로 질문에 답할 수 없으면 지어내지 말고 \`no_answer: true\` + \`answer_md: "${NO_ANSWER_MD}"\` + \`citations: []\` 로 응답하세요.

## 형식
- ChatGPT 스타일 markdown — 필요하면 소제목·불릿·표를 쓰되, 사실 없이 형식만 채우지 마세요.
- 답변은 질문에 직접 답하는 것부터 시작합니다.

## artifact 판단 룰 (자율 판단)
answer_md 는 항상 채우고, 아래 신호가 잡히면 \`artifacts\` 에 구조화 산출물을 **추가**합니다. 신호가 없으면 \`artifacts: []\` (텍스트만).

- **표 (table)**: "응답자별", "누가 뭐라 했나", "비교" 같은 신호 → 3명 이상 응답자를 나열할 수 있을 때만.
  - headers = ['응답자', '<주제 컬럼 1>', '<주제 컬럼 2>', ...]
  - rows = 응답자별 값 (headers 와 열 개수 일치, 각 셀은 짧은 요약)
  - respondent_ids = 각 row 의 근거가 된 청크의 \`chunk_id\` (근거 청크 헤더의 [id] 값을 그대로). row 순서와 1:1.

- **인용 리스트 (quote_list)**: "정확히 뭐라 했나", "원문", "몇 명이 언급" 같은 신호 → 원문 발췌 3개 이상 가능할 때만.
  - quotes = { respondent: 응답자 이름 또는 파일명, quote: 청크 원문을 **그대로** 발췌(요약/의역 금지), chunk_id: 그 원문이 있는 근거 청크의 [id] }

- **차트 (chart)**: "몇 %", "비율", "얼마나 많이", "분포" 같은 신호 → 범주(category) 3개 이상으로 나눌 수 있을 때만.
  - chart_type = 'bar' (범주형 분포) 또는 'pie' (구성 비율). 범주가 5개를 넘으면 pie 대신 bar 를 쓰세요.
  - series = { label: 범주 이름(예: '매우 민감', '보통', '민감하지 않음'), count: 해당 범주 응답자 수, respondent_ids: 그 범주에 매칭되는 근거 청크의 [id] 배열 }
  - **respondent_ids 는 각 범주에 실제 매칭되는 근거 청크의 chunk_id 여야 하며(필수), count 는 respondent_ids 개수와 일치해야 합니다** — server 가 respondent_ids 실존을 검증하고 count 를 재계산합니다.
  - 범주가 2개 이하이면 chart 를 만들지 말고 텍스트로만 답하세요.

- artifact 는 **최대 2개** (예: 표 1 + 차트 1, 또는 표 1 + 인용 리스트 1). 근거가 3건 미만이면 그 artifact 는 만들지 마세요 — server 가 검증 실패 시 drop 합니다.
- artifact 안의 모든 값은 근거 청크에서만 뽑습니다. 지어낸 응답자·수치·인용 금지.${ISOLATION_NOTICE}`;

/**
 * Render retrieved chunks as a numbered evidence block. Each header
 * carries the exact fields the model must copy into `citations`, so the
 * streamed citation objects stay faithful to retrieval.
 */
export function formatEvidence(hits: InterviewV2Hit[]): string {
  if (hits.length === 0) {
    return '(검색된 청크 없음 — no_answer: true 로 응답하세요.)';
  }
  return hits
    .map((h) => {
      const proj = h.project_name ? `, project: ${h.project_name}` : '';
      return (
        `[${h.chunk_id}] filename: ${h.filename}${proj}, document_id: ${h.document_id}, score: ${h.score.toFixed(3)}\n` +
        '```\n' +
        h.content +
        '\n```'
      );
    })
    .join('\n\n---\n');
}

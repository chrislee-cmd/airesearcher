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
- 답변은 질문에 직접 답하는 것부터 시작합니다.${ISOLATION_NOTICE}`;

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

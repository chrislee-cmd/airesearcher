// 인터뷰 탑라인 보고서 — system prompt + generateObject 스키마.
//
// 프로젝트의 업로드 문서 전체 chunk 를 번호가 매겨진 근거 블록으로 주입하고,
// Opus 가 그 근거만으로 6개 고정 섹션의 **블록 배열** 보고서를 생성한다.
// 각 발견/인용/표 블록은 [chunk_id] 인용을 달고, route 가 근거 chunk 집합에
// 대해 재검증해서 지어낸 chunk_id 는 drop 한다 (v2/search buildCitations 원리).
//
// 블록 모델(§문서 모델): { type, md, citations, table? } — id 는 서버가 부여.
// inserted_qa 타입은 후속 drag-to-ask PR 에서 병합하므로 생성 스키마엔 없다.

import { z } from 'zod';
import { ISOLATION_NOTICE } from '@/lib/llm/sanitize';

// LLM 이 emit 하는 블록. id 는 서버(assignBlockIds)가 blk_NN 으로 부여하므로
// 스키마엔 없다. table 은 type='table' 일 때만 채운다.
export const toplineBlockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('heading'),
    // 섹션 제목 텍스트 (markdown # 없이 순수 텍스트).
    md: z.string(),
  }),
  z.object({
    type: z.literal('paragraph'),
    // 서술 markdown. 사실 주장마다 [chunk_id] inline citation.
    md: z.string(),
    citations: z.array(z.string()).default([]),
  }),
  z.object({
    // 교차분석 인사이트 — "문서 A 는 X 인데 B/C 는 Y" 형 대조. 필수 섹션의 몸통.
    type: z.literal('insight'),
    md: z.string(),
    citations: z.array(z.string()).default([]),
  }),
  z.object({
    // verbatim 원문 발췌 (요약/의역 금지). md = 인용문, attribution = 출처 표기.
    type: z.literal('quote'),
    md: z.string(),
    attribution: z.string().optional(),
    citations: z.array(z.string()).default([]),
  }),
  z.object({
    // 정량 스냅샷 — 집계표. table.headers/rows 로 렌더, citations 로 근거.
    type: z.literal('table'),
    md: z.string().optional(), // 표 캡션/제목 (선택)
    table: z.object({
      headers: z.array(z.string()),
      rows: z.array(z.array(z.string())),
    }),
    citations: z.array(z.string()).default([]),
  }),
]);

export type ToplineBlockRaw = z.infer<typeof toplineBlockSchema>;

export const toplineSchema = z.object({
  blocks: z.array(toplineBlockSchema).default([]),
});

export type ToplineGenerated = z.infer<typeof toplineSchema>;

// 6개 고정 섹션 — heading md 로 이 라벨을 그대로 쓰게 강제한다.
export const TOPLINE_SECTIONS = [
  '핵심 요약',
  '주요 발견',
  '교차분석 인사이트',
  '주목할 인용',
  '정량 스냅샷',
  '시사점 & 후속 리서치 제안',
] as const;

export const TOPLINE_SYSTEM = `당신은 정성 인터뷰 코퍼스를 분석해 **탑라인 보고서**를 작성하는 리서치 애널리스트입니다. 아래 "근거 청크"만을 사실 근거로 사용해 한국어 존댓말로 작성합니다.

## 절대 룰 (환각 금지)
- 근거 청크 **밖의 정보는 절대 생성하지 마세요.** 일반 상식·추측·외부 지식 금지.
- 사실 주장을 담은 모든 블록(paragraph·insight·quote·table)에는 그 근거가 된 청크의 \`chunk_id\` 를 \`citations\` 배열에 넣습니다. 근거가 없는 서술은 만들지 말고, 데이터에 없으면 "데이터에 없음"이라고 명시하세요.
- paragraph/insight 의 \`md\` 안에서도 각 주장 뒤에 \`[chunk_id]\` inline citation 을 답니다 (예: 가격 민감도가 높았습니다 [12][34]). \`citations\` 배열은 그 블록이 인용한 chunk_id 전체.
- 인용/수치/응답자는 지어내지 마세요. server 가 chunk_id 실존을 재검증해 지어낸 것은 제거합니다.

## 보고서 구조 — 아래 6개 섹션을 이 순서로 **모두** 만듭니다
각 섹션은 먼저 \`heading\` 블록(md = 섹션 이름 그대로)을 두고, 이어서 본문 블록들을 배치합니다.

1. **핵심 요약** — 5~8개의 paragraph 블록(또는 불릿 담은 paragraph 1개). 전체를 관통하는 최상위 발견.
2. **주요 발견** — 테마별 paragraph/insight 블록. 각 발견 = citations 필수.
3. **교차분석 인사이트** (필수) — insight 블록. 응답자 속성×답변, 문서 간 공통점/상충점, 세그먼트별 차이를 대조합니다. "문서 A 는 X 라고 했는데 B·C 는 Y 였습니다 [id][id]" 형태의 **명시적 대조**를 최소 2개 이상 담으세요. 근거가 서로 다른 문서/청크에서 와야 합니다.
4. **주목할 인용** — quote 블록 최소 1개. 청크 원문을 **그대로** 발췌(요약/의역 금지)하고 attribution 에 출처(파일명/응답자)를 답니다.
5. **정량 스냅샷** — table 블록 최소 1개. 언급 빈도·세그먼트 분포 등 근거에서 집계 가능한 것을 headers/rows 로. 근거 없는 수치 금지.
6. **시사점 & 후속 리서치 제안** — paragraph 블록. 발견에서 도출되는 실행 시사점 + 데이터로 답 못한 후속 질문.

## 아티팩트 다양화
- paragraph 만 나열하지 마세요. table·quote·insight 블록을 적극 사용합니다.
- table 은 headers 와 각 row 의 열 개수가 일치해야 합니다.
- quote 의 md 는 근거 청크에 실제로 존재하는 원문이어야 합니다 (server 가 fuzzy 검증).${ISOLATION_NOTICE}`;

/**
 * 근거 청크를 번호 매긴 블록으로 렌더. 각 헤더의 [chunk_id] 를 모델이
 * citations 로 그대로 복사한다. 교차분석을 위해 filename 을 노출해 모델이
 * 문서 간 대조를 할 수 있게 한다.
 */
export function formatToplineEvidence(
  chunks: Array<{ chunk_id: string; filename: string; content: string }>,
): string {
  if (chunks.length === 0) {
    return '(근거 청크 없음)';
  }
  return chunks
    .map(
      (c) =>
        `[${c.chunk_id}] filename: ${c.filename}\n` +
        '```\n' +
        c.content +
        '\n```',
    )
    .join('\n\n---\n');
}

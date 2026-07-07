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
// 스키마엔 없다. table/chart/pie 는 해당 type 일 때만 데이터를 채운다.
//
// 계층: heading(섹션) → subheading(서브토픽) → paragraph(바디, 불릿은 md 안
// markdown `- `) → quote/table/chart/pie(아티팩트). 렌더러가 이 순서를 시각
// 구획으로 그린다.
const chartDatumSchema = z.object({
  label: z.string(),
  value: z.number(),
});

export const toplineBlockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('heading'),
    // 최상위 섹션 제목 텍스트 (markdown # 없이 순수 텍스트).
    md: z.string(),
  }),
  z.object({
    // 섹션 안 서브토픽 제목 — 2단 계층의 중간 층. paragraph 앞에 둔다.
    type: z.literal('subheading'),
    md: z.string(),
  }),
  z.object({
    type: z.literal('paragraph'),
    // 서술 markdown. 핵심 불릿은 md 안에서 markdown `- ` 리스트로.
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
    // 주장 뒤에 뒷받침 근거로 문맥 중간중간 삽입한다(섹션 끝 몰아넣기 X).
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
  z.object({
    // 막대/선 차트 — 빈도·분포·추세 등. data=[{label,value}], value 는 근거에서
    // 집계 가능한 수치만(지어낸 수치 금지). 앞뒤 서술로 감싸 유기적으로 배치.
    type: z.literal('chart'),
    title: z.string(),
    chartKind: z.enum(['bar', 'line']).default('bar'),
    data: z.array(chartDatumSchema).default([]),
    description: z.string().optional(),
    citations: z.array(z.string()).default([]),
  }),
  z.object({
    // 파이 차트 — 점유·비중 등 부분/전체 관계. data=[{label,value}].
    type: z.literal('pie'),
    title: z.string(),
    data: z.array(chartDatumSchema).default([]),
    description: z.string().optional(),
    citations: z.array(z.string()).default([]),
  }),
]);

export type ToplineBlockRaw = z.infer<typeof toplineBlockSchema>;

export const toplineSchema = z.object({
  blocks: z.array(toplineBlockSchema).default([]),
});

export type ToplineGenerated = z.infer<typeof toplineSchema>;

// 고정 필수 섹션 — 나머지 테마 섹션은 모델이 코퍼스에서 도출한다(도메인 무관).
// 이 3개는 heading md 로 이 라벨을 그대로 쓰게 강제한다.
export const TOPLINE_REQUIRED_SECTIONS = [
  '핵심 요약', // 항상 첫 섹션
  '교차분석 인사이트', // 항상 후반
  '시사점 & 후속 리서치 제안', // 항상 마지막
] as const;

export const TOPLINE_SYSTEM = `당신은 정성 인터뷰 코퍼스를 분석해 **깊이 있는 탑라인 보고서**를 작성하는 시니어 리서치 애널리스트입니다. 아래 "근거 청크"만을 사실 근거로 사용해 한국어 존댓말로 작성합니다. 이 보고서는 클라이언트에게 전달되는 **핵심 산출물**이므로, 얕은 요약이 아니라 **충분히 길고 구조적이며 근거로 촘촘한** 문서를 만들어야 합니다.

## 절대 룰 (환각 금지)
- 근거 청크 **밖의 정보는 절대 생성하지 마세요.** 일반 상식·추측·외부 지식 금지.
- 사실 주장을 담은 모든 블록(paragraph·insight·quote·table·chart·pie)에는 그 근거가 된 청크의 \`chunk_id\` 를 \`citations\` 배열에 넣습니다. 근거가 없는 서술은 만들지 말고, 데이터에 없으면 "데이터에 없음"이라고 명시하세요.
- paragraph/insight 의 \`md\` 안에서도 각 주장 뒤에 \`[chunk_id]\` inline citation 을 답니다 (예: 가격 민감도가 높았습니다 [12][34]). \`citations\` 배열은 그 블록이 인용한 chunk_id 전체. (inline 토큰은 화면·문서에서 사람이 읽는 형태로 정리되어 노출되니 부담 없이 답니다.)
- 인용/수치/응답자는 지어내지 마세요. server 가 chunk_id 실존을 재검증해 지어낸 것은 제거합니다. chart/pie/table 의 수치도 근거에서 실제 집계 가능한 것만.

## 분량과 깊이 (가장 중요)
- **얕은 한 문단 요약을 금지합니다.** 각 섹션은 서브토픽(subheading) 으로 나눠 여러 각도에서 **깊이 있게 전개**하세요.
- 각 테마마다: 무엇을 발견했는가 → 근거(누가/어떤 맥락에서) → 세부 뉘앙스/예외 → 뒷받침 verbatim 인용, 순으로 촘촘히 풀어냅니다.
- 전체 보고서는 이전 버전보다 **훨씬 길고 상세**해야 합니다. 근거가 허용하는 한 최대한 많은 테마·서브토픽·아티팩트를 담으세요(근거 없는 지어내기는 금지).

## 계층 구조 (2단)
블록을 이 계층으로 배치합니다:
- \`heading\` = 최상위 섹션 제목.
- \`subheading\` = 그 섹션 안 서브토픽 제목. 한 섹션에 서브토픽이 여럿이면 subheading 을 여러 개 둡니다.
- \`paragraph\` = 바디 서술. 핵심 요점은 md 안에서 markdown \`- \` 불릿 리스트로 정리합니다(서술 + 불릿 병행).
- \`quote\` / \`table\` / \`chart\` / \`pie\` = 아티팩트. **주장 바로 뒤 문맥 중간에** 삽입하고 앞뒤 서술로 감쌉니다.

## 보고서 섹션 구성
다음 3개 섹션은 **반드시** 이 위치에 포함합니다(heading md 는 라벨 그대로):
- 맨 처음: **핵심 요약** — 전체를 관통하는 최상위 발견을 subheading + paragraph + 불릿으로 풍부하게.
- 후반: **교차분석 인사이트** (필수) — insight 블록으로 응답자 속성×답변, 문서 간 공통점/상충점, 세그먼트별 차이를 대조. "문서 A 는 X 라고 했는데 B·C 는 Y 였습니다 [id][id]" 형태의 **명시적 대조 최소 2개 이상**. 근거가 서로 다른 문서/청크에서 와야 합니다.
- 맨 마지막: **시사점 & 후속 리서치 제안** — 발견에서 도출되는 실행 시사점 + 데이터로 답 못한 후속 질문.

그 사이(핵심 요약 다음 ~ 교차분석 전)에는 **코퍼스에서 실제로 도출되는 주제별 섹션을 6개 내외로** 만듭니다. 섹션 이름은 데이터에 맞게 정하세요(예: 사용 행태 / 구매 채널 / 제품 선택 기준 / 페인포인트 / 정보 탐색·신뢰 / 브랜드·라벨 인식 등 — 코퍼스에 근거가 있는 주제만). 각 주제 섹션은 subheading 여러 개 + paragraph + 적절한 아티팩트로 깊이 있게.

## 아티팩트 (유기적 배치 — 섹션 끝 몰아넣기 금지)
- **quote**: 주장을 세운 직후 그것을 뒷받침하는 실제 응답자 verbatim 을 quote 블록으로 문맥 중간에 삽입합니다. md 는 근거 청크에 실제로 존재하는 원문이어야 합니다(server fuzzy 검증). attribution 에 출처(파일명/응답자).
- **table**: 우선순위·항목 비교·세그먼트 분포 등 표로 볼 때 명확한 지점에. headers 와 각 row 의 열 개수가 일치해야 합니다.
- **chart** (bar/line): 언급 빈도, 항목별 카운트, 추세 등 막대/선으로 보이는 분포에. data=[{label,value}], value 는 근거에서 실제 집계 가능한 정수.
- **pie**: 채널 점유·비중 등 부분/전체 관계에. data=[{label,value}].
- 아티팩트는 앞 문단에서 "무엇을 보여주는지" 예고하고 뒤 문단에서 "그래서 무엇을 뜻하는지" 해석해 **유기적으로 감쌉니다.**
- table 1개 이상 + chart 또는 pie 1개 이상을 반드시 포함하세요(근거가 허용하는 한).${ISOLATION_NOTICE}`;

// map-reduce reduce 단계 전용 추가 지침 — 입력이 raw chunk 가 아니라 **전
// 문서(응답자)를 순회해 뽑은 구조화 추출**임을 알리고, 수치는 제공된 전수
// 위에서 실제로 세게 한다(카드 #430 결정 #1·#3). TOPLINE_SYSTEM 뒤에 덧붙인다.
export const TOPLINE_REDUCE_NOTICE = `

## 입력 형식 (전수 map 추출 — 매우 중요)
아래 "근거"는 top-K 검색 결과가 아니라 **이 프로젝트의 모든 응답자(문서)를 한 명도 빠짐없이 순회**해 각자에게서 뽑은 주제·인용 추출입니다. "응답자 k/N" 헤더로 구분되어 있고 N = 전체 응답자 수입니다. 따라서:
- **집계 수치는 실제로 세십시오.** "N명 중 M명이 X 라고 했다" 는 제공된 N명의 추출을 훑어 X 를 언급한 응답자 수를 **직접 카운트**한 값이어야 합니다(추정·반올림 금지). 분모 N = 제공된 응답자 총수.
- chart/pie/table 의 수치도 이 전수 카운트에서 산출합니다(예: 주제별 언급 응답자 수). 근거에서 셀 수 없는 수치는 만들지 마세요.
- 어떤 주제를 언급한 응답자가 소수여도 누락하지 말고, 교차분석에서 "다수 vs 소수" 대조로 살리세요.
- citations 에는 각 응답자 추출에 딸린 chunk_id 를 그대로 사용합니다(서버가 실존 재검증).`;

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

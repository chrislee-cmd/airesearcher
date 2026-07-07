// 인터뷰 탑라인 map-reduce — **map** 단계 (문서별 전수 추출).
//
// 탑라인/집계는 "빠짐없는 포괄"이 생명이라 top-K 검색이 아니라 전 문서 순회여야
// 한다(카드 #430). map 은 각 문서(=응답자 1명)를 **전문(全文)** 읽어 탑라인에
// 필요한 주제/발언/verbatim 인용을 구조화 추출한다. 문서 하나가 컨텍스트에
// 편하게 들어가므로 chunk 샘플링 없이 전량을 넣는다 → 어떤 발언도 예산에 밀려
// 유실되지 않는다. reduce(Opus)는 이 압축 추출들을 N개 전부 받아 종합한다.
//
// 비용/유실 트레이드오프: map 은 문서 수만큼 LLM 호출이라 Sonnet(저비용·충분)로
// 돌리고, 종합의 품질이 중요한 reduce 만 Opus. content_hash 캐시(호출측)로
// 안 바뀐 문서는 map 을 건너뛴다.

import { generateObject } from 'ai';
import type { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { ZERO_RETENTION } from '@/lib/llm/config';
import { ISOLATION_NOTICE } from '@/lib/llm/sanitize';
import type { ToplineChunk } from '@/lib/interview-v2/topline';

// map 은 저비용 모델로 충분(구조화 추출은 종합보다 쉬움). reduce 만 Opus.
export const TOPLINE_MAP_MODEL = 'claude-sonnet-4-6';

// 문서별 동시 map 호출 상한 — 대량 코퍼스에서 provider rate-limit/타임아웃을
// 피하면서 벽시계 시간을 줄인다. maxDuration=300 안에서 안전한 폭.
export const MAP_CONCURRENCY = 6;

type Anthropic = ReturnType<typeof createAnthropic>;

// 문서 1개의 map 산출. themes = 탑라인에 쓸 주제별 발언 요약(+근거 chunk_id),
// quotes = 그대로 인용 가능한 verbatim(+chunk_id). 둘 다 근거 chunk 밖 정보를
// 만들지 않는다(환각 금지 — reduce 가 이 추출만 보고 종합하므로 여기서 새면
// 전체가 샌다).
export const docExtractSchema = z.object({
  // 이 응답자가 다룬 주제들 — reduce 가 문서 간 공통/상충을 집계하는 원자 단위.
  themes: z
    .array(
      z.object({
        // 짧은 주제 라벨(예: "가격 민감도", "구매 채널"). reduce 가 문서 간
        // 같은 주제를 묶는 힌트 — 완벽히 정규화될 필요는 없다(reduce 가 의미로 묶음).
        label: z.string(),
        // 이 응답자가 그 주제에 대해 말한 핵심(1~3문장, 근거 청크 기반 사실만).
        statement: z.string(),
        // 근거 chunk_id 들(제공된 청크 중에서만). reduce/검증이 재검증한다.
        chunk_ids: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  // 탑라인에 그대로 인용할 만한 대표 verbatim(요약/의역 금지 — 원문).
  quotes: z
    .array(
      z.object({
        text: z.string(),
        chunk_id: z.string(),
      }),
    )
    .default([]),
});

export type DocExtract = z.infer<typeof docExtractSchema>;

// reduce 가 문서를 식별·집계할 수 있도록 추출에 문서 메타를 붙인 형태.
export type DocExtractWithMeta = DocExtract & {
  document_id: string;
  filename: string;
  // map 이 실패해 빈 추출로 대체됐는지(부분 실패 가시화 — reduce/로그가 인지).
  failed?: boolean;
};

const MAP_SYSTEM = `당신은 정성 인터뷰 **한 명의 응답자 전사록 전체**를 읽고, 이후 탑라인(종합) 보고서 작성에 쓸 재료를 구조화 추출하는 애널리스트입니다. 아래 "근거 청크"는 이 응답자 한 명의 문서 전문입니다.

## 목표
- 이 응답자가 다룬 **모든 주제**를 빠짐없이 뽑습니다(themes). 탑라인은 전수 종합이므로, 사소해 보여도 응답자가 언급한 주제는 남깁니다.
- 각 theme 는 { label(짧은 주제명), statement(이 응답자가 그 주제에 대해 말한 핵심 1~3문장), chunk_ids(근거) } 입니다.
- 그대로 인용할 만한 대표 발언은 quotes 로 원문 그대로(요약·의역 금지) 뽑고 chunk_id 를 답니다.

## 절대 룰 (환각 금지)
- 근거 청크 **밖의 정보는 절대 만들지 마세요.** 추측·일반상식·외부지식 금지.
- 모든 statement/quote 에는 근거가 된 청크의 chunk_id 를 답니다(제공된 chunk_id 중에서만). 이후 서버가 chunk_id 실존을 재검증해 지어낸 것은 제거합니다.
- 이 응답자가 어떤 주제를 **언급하지 않았으면** 그 주제를 만들지 마세요(없는 걸 채우지 않음). 빈 배열도 정상입니다.${ISOLATION_NOTICE}`;

// 문서의 청크를 번호 매긴 근거 블록으로 렌더(map 입력). formatToplineEvidence
// 와 동일 포맷이되 단일 문서라 filename 은 헤더 한 번만 노출.
function formatDocEvidence(chunks: ToplineChunk[]): string {
  return chunks
    .map((c) => `[${c.chunk_id}]\n` + '```\n' + c.content + '\n```')
    .join('\n\n');
}

/**
 * 문서 1개를 map — 전문을 넣어 구조화 추출. 실패 시 예외를 던진다(호출측이
 * 재시도/빈 추출 대체를 결정). 반환은 문서 메타가 붙은 추출.
 */
export async function mapDocument(
  anthropic: Anthropic,
  doc: { document_id: string; filename: string; chunks: ToplineChunk[] },
): Promise<DocExtractWithMeta> {
  const { object } = await generateObject({
    model: anthropic(TOPLINE_MAP_MODEL),
    schema: docExtractSchema,
    system: `${MAP_SYSTEM}\n\n## 근거 청크 (응답자: ${doc.filename})\n${formatDocEvidence(doc.chunks)}`,
    prompt:
      '위 응답자 전사록에서 탑라인 종합에 쓸 themes 와 대표 quotes 를 빠짐없이 구조화 추출하세요. 근거 청크에 실제로 있는 내용만, 각 항목에 chunk_id 를 답니다.',
    temperature: 0.2,
    maxOutputTokens: 4_000,
    maxRetries: 1,
    providerOptions: ZERO_RETENTION,
  });
  return { ...object, document_id: doc.document_id, filename: doc.filename };
}

/**
 * 동시성 제한 배치 러너 — items 를 worker 풀(size=limit)로 병렬 처리한다.
 * 각 item 완료마다 onProgress 를 호출(진행률 publish). handler 가 던지면
 * 그 item 은 결과 배열에서 건너뛰지 않고 handler 안에서 fallback 을 반환해야
 * 한다(여기선 순수 풀만 담당 — 재시도/fallback 은 handler 책임).
 */
export async function runPool<T, R>(
  items: T[],
  limit: number,
  handler: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number) => void | Promise<void>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  const size = Math.max(1, Math.min(limit, items.length));

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await handler(items[i], i);
      done += 1;
      if (onProgress) await onProgress(done);
    }
  }

  await Promise.all(Array.from({ length: size }, () => worker()));
  return results;
}

/**
 * 문서별 map 추출을 사람이 읽는(=reduce 입력) 텍스트로 렌더. 각 문서를 번호와
 * filename 으로 구분해 reduce 가 "몇 명 중 몇 명" 을 실제 문서 단위로 셀 수 있게
 * 한다(추정 아니라 제공된 전수 위에서 카운트).
 */
export function formatExtractsForReduce(
  extracts: DocExtractWithMeta[],
): string {
  return extracts
    .map((e, i) => {
      const themes = e.themes.length
        ? e.themes
            .map(
              (t) =>
                `  - [${t.label}] ${t.statement} ${t.chunk_ids
                  .map((c) => `[${c}]`)
                  .join('')}`,
            )
            .join('\n')
        : '  - (추출된 주제 없음)';
      const quotes = e.quotes.length
        ? e.quotes
            .map((q) => `  - "${q.text}" [${q.chunk_id}]`)
            .join('\n')
        : '  - (대표 인용 없음)';
      const flag = e.failed ? ' ⚠️(추출 실패 — 이 응답자는 근거 없음)' : '';
      return `### 응답자 ${i + 1}/${extracts.length} — ${e.filename}${flag}\n주제:\n${themes}\n대표 인용:\n${quotes}`;
    })
    .join('\n\n');
}

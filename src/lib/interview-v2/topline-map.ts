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

// 문서 1건을 Sonnet map 에 통째로 넣을 때의 입력 문자 상한(회복력 가드). 인터뷰
// 1명 전사록은 보통 이 안에 들어오지만, 아주 긴 문서(수만 자)는 context 과대로
// 호출이 느려지거나 스키마 재시도를 유발한다(카드 #468 처리율 붕괴 요인). 상한을
// 넘으면 뒤쪽 청크를 생략하고 앞쪽(대표 구간)만 넣는다 — map 은 "빠짐없는 주제
// 추출"이 목표라 앞부분+대다수 청크로 충분하고, 청크를 통째로 드롭하므로 남은
// chunk_id 는 여전히 유효(잘린 청크를 인용할 수 없을 뿐). ~16k 토큰 상당.
export const MAX_MAP_INPUT_CHARS = 48_000;

// map 호출 문서별 최대 시도 횟수(일시 오류 백오프 흡수). 하드 장애(크레딧/인증)는
// 이 루프 밖에서 즉시 단락(재시도 무의미)된다.
export const MAP_MAX_ATTEMPTS = 3;
// 백오프 대기 상한 — Retry-After 가 비정상적으로 크거나 지수 백오프가 커져도
// 홉 예산(MAP_SOFT_DEADLINE)을 한 문서가 다 먹지 않게 캡.
export const MAP_RETRY_CAP_MS = 20_000;

type Anthropic = ReturnType<typeof createAnthropic>;

// map 호출 실패 분류 — 하드 장애(크레딧 소진·인증)는 재시도·체인 지속이
// 무의미하므로 즉시 표면화하고, 일시 장애(429/과부하/타임아웃/5xx)는 백오프로
// 흡수한다. 카드 #468: 크레딧 소진(402)이 generic stuck_timeout 으로 묻히던 걸
// 명확한 error_message 로 드러내는 게 이 fix 의 핵심.
export type MapErrorClass = {
  // error_message 에 실릴 사람이 읽는 사유(진행도와 결합돼 DB/이메일에 노출).
  label: string;
  // true 면 재시도/체인 지속이 무의미(크레딧/인증) — 즉시 error 로 종결.
  hardFault: boolean;
  // provider 가 준 Retry-After(ms) — 있으면 백오프에 존중.
  retryAfterMs?: number;
};

function parseRetryAfterMs(headers?: Record<string, string>): number | undefined {
  if (!headers) return undefined;
  const raMs = headers['retry-after-ms'];
  if (raMs) {
    const n = Number(raMs);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const ra = headers['retry-after'];
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs) && secs >= 0) return secs * 1_000;
  }
  return undefined;
}

export function classifyMapError(e: unknown): MapErrorClass {
  const err = e as
    | {
        statusCode?: number;
        status?: number;
        message?: string;
        responseHeaders?: Record<string, string>;
      }
    | undefined;
  const status = err?.statusCode ?? err?.status;
  const msg = (err?.message ?? String(e ?? '')).toLowerCase();
  const retryAfterMs = parseRetryAfterMs(err?.responseHeaders);

  // 크레딧 소진 / 결제 — 402 또는 메시지에 credit/billing/insufficient/quota.
  if (
    status === 402 ||
    /credit|billing|insufficient|payment|quota|balance/.test(msg)
  ) {
    return { label: 'Anthropic 크레딧/결제 소진(402)', hardFault: true };
  }
  // 인증 — 401/403 또는 api key/authentication.
  if (
    status === 401 ||
    status === 403 ||
    /\bapi key\b|authentication|unauthor|permission/.test(msg)
  ) {
    return { label: 'Anthropic 인증 실패(401/403)', hardFault: true };
  }
  // rate limit / overloaded — 429/529.
  if (status === 429 || status === 529 || /rate limit|overloaded|too many/.test(msg)) {
    return {
      label: `Anthropic ${status ?? '429'} rate-limit/overloaded`,
      hardFault: false,
      retryAfterMs,
    };
  }
  // 서버측 일시 오류.
  if (status && status >= 500) {
    return { label: `provider ${status}`, hardFault: false, retryAfterMs };
  }
  // 타임아웃 / 네트워크.
  if (/timeout|aborted|network|fetch failed|econn|socket/.test(msg)) {
    return { label: 'map 호출 타임아웃/네트워크', hardFault: false };
  }
  // 스키마/기타 — 재시도 가치는 낮지만 일시일 수 있어 soft.
  return {
    label: err?.message ? err.message.slice(0, 120) : 'map 호출 실패',
    hardFault: false,
    retryAfterMs,
  };
}

// map 호출 재시도 지수 백오프(ms) — 1s, 2s, 4s … MAP_RETRY_CAP_MS 상한.
export function mapRetryBackoffMs(attempt: number): number {
  return Math.min(MAP_RETRY_CAP_MS, 1_000 * 2 ** attempt);
}

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
// 와 동일 포맷이되 단일 문서라 filename 은 헤더 한 번만 노출. 입력 크기 가드
// (MAX_MAP_INPUT_CHARS): 아주 긴 문서는 앞쪽 청크만 넣어 context 과대로 인한
// 느림/실패를 막는다. 첫 청크는 홀로 상한을 넘어도 반드시 포함(빈 입력 방지),
// 이후 청크는 예산 안에서만. 생략된 청크는 통째로 빠지므로 남은 chunk_id 는
// 여전히 유효하다.
function formatDocEvidence(chunks: ToplineChunk[]): string {
  const parts: string[] = [];
  let used = 0;
  let omitted = 0;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const block = `[${c.chunk_id}]\n` + '```\n' + c.content + '\n```';
    if (parts.length > 0 && used + block.length > MAX_MAP_INPUT_CHARS) {
      omitted = chunks.length - i;
      break;
    }
    parts.push(block);
    used += block.length + 2; // '\n\n' join 오버헤드 근사.
  }
  let out = parts.join('\n\n');
  if (omitted > 0) {
    out += `\n\n[…이 응답자 문서가 매우 길어 뒤쪽 청크 ${omitted}개는 생략됨. 위 청크만으로 주제·인용을 빠짐없이 추출하세요.]`;
  }
  return out;
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
 * 시간예산 배치 러너 — runPool 과 같지만 **새 item 을 꺼내기 전에** shouldStop()
 * 을 확인해, 참이면 남은 item 을 건드리지 않고 워커를 비운다(현재 진행 중인
 * 호출은 끝까지 마친다). durable 재개(카드 #434)에서 한 함수 호출의 시간예산
 * (~230s) 이 소진되면 map 을 중단하고 커서(=extract 캐시)만 남긴 뒤 다음 홉으로
 * 넘기는 데 쓴다. 반환의 stopped=true 면 예산 소진으로 조기 종료된 것.
 *
 * results 배열은 꺼내지 못한 index 가 undefined 로 남을 수 있다(호출측이
 * 캐시로 재구성하므로 무해). processed = 이 홉에서 실제 handler 를 완료한 수.
 */
export async function runPoolUntil<T, R>(
  items: T[],
  limit: number,
  shouldStop: () => boolean,
  handler: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number) => void | Promise<void>,
): Promise<{ results: Array<R | undefined>; processed: number; stopped: boolean }> {
  const results = new Array<R | undefined>(items.length);
  let next = 0;
  let done = 0;
  let stopped = false;
  const size = Math.max(1, Math.min(limit, items.length));

  async function worker(): Promise<void> {
    while (true) {
      // 예산 소진 — 새 item 을 꺼내지 않고 이 워커 종료(진행 중 호출은 이미
      // 위에서 await 로 끝난 상태).
      if (shouldStop()) {
        stopped = true;
        return;
      }
      const i = next++;
      if (i >= items.length) return;
      results[i] = await handler(items[i], i);
      done += 1;
      if (onProgress) await onProgress(done);
    }
  }

  await Promise.all(Array.from({ length: size }, () => worker()));
  return { results, processed: done, stopped };
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

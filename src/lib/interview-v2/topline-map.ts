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
  // true 면 일시 장애(429/529/5xx/타임아웃/네트워크) — 다음 홉/재시도로 회복 가능.
  // false = 결정적 실패(재시도해도 동일 결과). no-progress 서킷브레이커(카드 #481)
  // 가 "무진전 홉이 결정적 실패면 재kick 무의미 → 즉시 종결" 을 판정하는 축.
  transient: boolean;
  // true 면 구조화 출력 파싱/스키마 실패("No object generated"/스키마 불일치).
  // 큰 문서의 context/출력 truncate 로 generateObject 가 유효 JSON 을 못 낸 경우.
  // 매 홉 동일하게 실패해 map 을 영구 차단하므로(카드 #481), 시도 소진 후엔
  // placeholder 로 마감해 커서를 전진시킨다.
  parseFault: boolean;
  // provider 가 준 Retry-After(ms) — 있으면 백오프에 존중.
  retryAfterMs?: number;
};

// generateObject 파싱/스키마 실패 시그니처 — AI SDK 의 NoObjectGeneratedError /
// TypeValidationError 는 statusCode 가 없어 메시지로 가른다. 이 패턴들은 재시도해도
// (같은 입력이면) 동일하게 실패하는 결정적 오류라 placeholder 마감 대상이다.
const PARSE_FAULT_RE =
  /no object generated|could not parse|failed to parse|did not match schema|type validation|invalid json|response_format|schema/i;

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
    return {
      label: 'Anthropic 크레딧/결제 소진(402)',
      hardFault: true,
      transient: false,
      parseFault: false,
    };
  }
  // 인증 — 401/403 또는 api key/authentication.
  if (
    status === 401 ||
    status === 403 ||
    /\bapi key\b|authentication|unauthor|permission/.test(msg)
  ) {
    return {
      label: 'Anthropic 인증 실패(401/403)',
      hardFault: true,
      transient: false,
      parseFault: false,
    };
  }
  // rate limit / overloaded — 429/529.
  if (status === 429 || status === 529 || /rate limit|overloaded|too many/.test(msg)) {
    return {
      label: `Anthropic ${status ?? '429'} rate-limit/overloaded`,
      hardFault: false,
      transient: true,
      parseFault: false,
      retryAfterMs,
    };
  }
  // 서버측 일시 오류.
  if (status && status >= 500) {
    return {
      label: `provider ${status}`,
      hardFault: false,
      transient: true,
      parseFault: false,
      retryAfterMs,
    };
  }
  // 타임아웃 / 네트워크.
  if (/timeout|aborted|network|fetch failed|econn|socket/.test(msg)) {
    return {
      label: 'map 호출 타임아웃/네트워크',
      hardFault: false,
      transient: true,
      parseFault: false,
    };
  }
  // 파싱/스키마 실패 — 구조화 출력이 유효 JSON 이 아님(NoObjectGeneratedError 등).
  // 결정적(재시도 무의미)이라 transient=false. 시도 소진 후 placeholder 로 마감해
  // map 을 전진시킨다(카드 #481 — map 영구 차단의 root cause).
  if (PARSE_FAULT_RE.test(msg)) {
    return {
      label: err?.message ? err.message.slice(0, 120) : 'map 구조화 출력 파싱 실패',
      hardFault: false,
      transient: false,
      parseFault: true,
    };
  }
  // 그 외 — 재시도 가치는 낮은 결정적 오류(4xx 등). transient=false 로 두어
  // no-progress breaker 가 무의미한 재kick 을 조기 종결하게 한다.
  return {
    label: err?.message ? err.message.slice(0, 120) : 'map 호출 실패',
    hardFault: false,
    transient: false,
    parseFault: false,
    retryAfterMs,
  };
}

// map 호출 재시도 지수 백오프(ms) — 1s, 2s, 4s … MAP_RETRY_CAP_MS 상한.
export function mapRetryBackoffMs(attempt: number): number {
  return Math.min(MAP_RETRY_CAP_MS, 1_000 * 2 ** attempt);
}

// map 추출 스키마 버전 — 이 값이 바뀌면 (document_id, content_hash) 추출 캐시가
// 무효화된다(topline.ts extractCacheHash 가 버전을 해시에 섞음). 구조화 필드
// (attributes·coded)를 추가할 때마다 bump 해 옛 추출(구 스키마)이 재사용돼
// tally 입력이 비는 것을 막는다. v1 = themes/quotes only, v2 = +attributes+coded.
export const EXTRACT_SCHEMA_VERSION = 2;

// 응답자 인구통계 속성 — **파일명 규칙**(예 `이름 - 인종 - 나이.txt`)과 발화 내
// 명시 언급에서만 추출(추정 금지). 없으면 null(=unknown). tally 가 세그먼트
// 크로스탭 축으로 쓰되, 속성 없는 응답자는 크로스탭에서 제외하고 전체 분모엔
// 포함한다(커버리지 정직 — 스펙 제약).
export const respondentAttributesSchema = z.object({
  // 인종/민족 — 원문 라벨 그대로(정규화는 tally 코드가). 예: "Black","White",
  // "Asian","백인","흑인" 등. 명시 근거 없으면 null.
  race: z.string().nullable().default(null),
  // 성별 — "female"/"male"/"여"/"남" 등 원문 라벨. 명시 근거 없으면 null.
  gender: z.string().nullable().default(null),
  // 명시 나이(정수) — 있으면. tally 가 18-24/25-34/35-44/45+ 버킷으로 환산.
  age: z.number().nullable().default(null),
  // 나이대만 언급됐을 때의 원문 라벨(예 "20대","30s"). age 가 없을 때 tally 가
  // 이 라벨을 세그먼트 그룹으로 그대로 쓴다.
  age_group: z.string().nullable().default(null),
});

export type RespondentAttributes = z.infer<typeof respondentAttributesSchema>;

// 닫힌(객관식) 문항 코딩 — 자유발화를 **정규화된 라벨**로 코딩한 응답자 단위
// 답. SOP 휴리스틱: 짧고(≈70자 미만) 값 종류가 적은 문항 = 닫힌 문항 후보 →
// 전수 코딩 대상. tally 가 (question, answer) 로 그룹핑해 코드로 카운트하므로,
// 같은 문항엔 **일관된 짧은 question 키**를, 같은 답엔 **일관된 answer 라벨**을
// 쓰는 게 중요하다(응답자마다 표현이 달라도 같은 카테고리면 같은 라벨로).
export const codedAnswerSchema = z.object({
  // 정규화된 짧은 문항 키(카테고리명). 예: "우선 케어 부위","자극 vs 속도 선호",
  // "주 구매 채널","성분 선호". 문항 자체의 카테고리를 짧게.
  question: z.string(),
  // 정규화된 답변 라벨(자유발화 → 카테고리). 예: "온라인","오프라인 매장",
  // "자극 최소","빠른 효과". 원문 그대로가 아니라 카테고리로.
  answer: z.string(),
  // 보조 인지 여부 — 보기/목록을 주고 고르게 한 문항이면 true(보조), 자발적으로
  // 떠올려 답한 문항이면 false(비보조). methodology §1-3: 둘은 다른 문항이라
  // 절대 뭉치면 안 되므로 라벨로 분리한다.
  aided: z.boolean().default(false),
  // 복수 귀속 여부 — 한 응답자가 이 문항에서 여러 답을 고를 수 있으면 true.
  // methodology §1-11: 단일선택 vs 복수귀속에 따라 순위가 뒤집히므로 기준 기록.
  multi: z.boolean().default(false),
  // 근거 chunk_id 들(제공된 청크 중에서만). 서버가 실존 재검증.
  chunk_ids: z.array(z.string()).default([]),
});

export type CodedAnswer = z.infer<typeof codedAnswerSchema>;

// 문서 1개의 map 산출. themes = 탑라인에 쓸 주제별 발언 요약(+근거 chunk_id),
// quotes = 그대로 인용 가능한 verbatim(+chunk_id). attributes = 응답자 속성,
// coded = 닫힌 문항 코딩(결정적 tally 입력). 모두 근거 chunk 밖 정보를 만들지
// 않는다(환각 금지 — reduce 가 이 추출만 보고 종합하므로 여기서 새면 전체가 샌다).
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
  // 응답자 인구통계 속성(파일명/발화 명시 근거만, 추정 금지). tally 세그먼트 축.
  attributes: respondentAttributesSchema.default({
    race: null,
    gender: null,
    age: null,
    age_group: null,
  }),
  // 닫힌(객관식) 문항 코딩 — 결정적 tally 의 입력. 없으면 빈 배열.
  coded: z.array(codedAnswerSchema).default([]),
  // 이 추출이 map 실패로 placeholder 마감된 것인지(카드 #481). 파싱실패 doc 을
  // 무한 재시도하지 않으려 시도 소진 후 빈 추출 + failed:true 로 캐시에 영속해
  // 커서를 전진시킨다. reduce 입력 재구성 시 ⚠️ "추출 실패" 로 표기된다. LLM 은
  // 이 필드를 채우지 않으며(프롬프트 무관), placeholder write 만 세팅한다.
  // optional 이라 기존 캐시 row(필드 없음)와 하위 호환 — jsonb 라 마이그 불필요.
  failed: z.boolean().optional(),
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
- **응답자 속성(attributes)** 을 뽑습니다 — 이후 서버가 세그먼트(그룹) 크로스탭을 코드로 집계하는 축입니다.
- **닫힌(객관식) 문항 코딩(coded)** — 이후 서버가 이 코딩을 세어 실측 표를 만듭니다. 아래 규칙을 지키세요.

## 응답자 속성 (attributes) — 명시 근거만
- 근거는 두 곳뿐입니다: **① 문서 헤더의 파일명**(예 \`이름 - 인종 - 나이.txt\` 같은 규칙이면 거기서), **② 응답자 발화 내 명시 언급**. 그 외 어투·이름 등으로 **추정하지 마세요.**
- \`race\`(인종/민족), \`gender\`(성별)는 근거에 나온 **원문 라벨 그대로**(정규화는 서버가 함). \`age\`는 명시된 정수 나이(있으면), 나이대만 언급되면 \`age_group\`에 원문 라벨(예 "20대").
- 근거가 없으면 각 필드를 **null**(빈 값)로 둡니다. 억지로 채우지 마세요 — null 은 정상이고, 서버가 "속성 미상"으로 정직하게 처리합니다.

## 닫힌(객관식) 문항 코딩 (coded) — 결정적 집계의 재료
- **탐지 휴리스틱(SOP)**: 응답이 (a) 짧고(대략 70자 미만) (b) 값의 종류가 적은(보기 개수 수준) 문항 = 닫힌 문항 후보입니다. 이런 문항의 이 응답자 답을 coded 항목으로 뽑습니다(예: 우선 케어 부위·성분 선호·자극 vs 속도·주 구매 채널·구매 결정 요인 등 코퍼스에 반복되는 문항).
- 각 coded 항목: { question(정규화된 짧은 문항 키), answer(정규화된 답변 라벨), aided, multi, chunk_ids }.
  - **question 은 문항의 카테고리를 짧게**(예 "주 구매 채널") — 같은 문항이면 응답자마다 **같은 키**를 쓰세요(서버가 키로 그룹핑해 셉니다).
  - **answer 는 자유발화를 카테고리 라벨로 정규화**(예 발화 "쿠팡에서 시켜요" → "온라인"). 같은 뜻이면 같은 라벨로.
  - \`aided\`=true: 보기/목록을 주고 고르게 한 문항(보조 인지). false: 스스로 떠올려 답한 문항(비보조). **둘은 다른 문항이라 절대 섞지 마세요.**
  - \`multi\`=true: 이 문항에서 응답자가 여러 답을 고른 경우(복수 귀속). 단일선택이면 false.
- **응답부만 코딩**하세요 — 질문·보기 목록 텍스트를 answer 로 넣지 마세요(가짜 100% 집계 방지). coded 근거가 없는 응답자는 빈 배열이 정상입니다.

## 절대 룰 (환각 금지)
- 근거 청크 **밖의 정보는 절대 만들지 마세요.** 추측·일반상식·외부지식 금지(속성·코딩 포함 — 근거 없으면 null/빈 배열).
- 모든 statement/quote/coded 에는 근거가 된 청크의 chunk_id 를 답니다(제공된 chunk_id 중에서만). 이후 서버가 chunk_id 실존을 재검증해 지어낸 것은 제거합니다.
- 이 응답자가 어떤 주제를 **언급하지 않았으면** 그 주제를 만들지 마세요(없는 걸 채우지 않음). 빈 배열도 정상입니다.${ISOLATION_NOTICE}`;

// 문서의 청크를 번호 매긴 근거 블록으로 렌더(map 입력). formatToplineEvidence
// 와 동일 포맷이되 단일 문서라 filename 은 헤더 한 번만 노출. 입력 크기 가드
// (MAX_MAP_INPUT_CHARS): 아주 긴 문서는 앞쪽 청크만 넣어 context 과대로 인한
// 느림/실패를 막는다. 첫 청크는 홀로 상한을 넘어도 반드시 포함(빈 입력 방지),
// 이후 청크는 예산 안에서만. 생략된 청크는 통째로 빠지므로 남은 chunk_id 는
// 여전히 유효하다.
function formatDocEvidence(
  chunks: ToplineChunk[],
  inputCharCap: number = MAX_MAP_INPUT_CHARS,
): string {
  const cap = Math.max(1, inputCharCap);
  const parts: string[] = [];
  let used = 0;
  let omitted = 0;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const block = `[${c.chunk_id}]\n` + '```\n' + c.content + '\n```';
    if (parts.length > 0 && used + block.length > cap) {
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
  // 입력 문자 상한 override — 파싱실패 재시도 시 더 작은 캡으로 재호출해
  // context/출력 truncate 로 인한 파싱실패를 줄인다(카드 #481). 미지정 시 기본 캡.
  opts?: { inputCharCap?: number },
): Promise<DocExtractWithMeta> {
  const { object } = await generateObject({
    model: anthropic(TOPLINE_MAP_MODEL),
    schema: docExtractSchema,
    system: `${MAP_SYSTEM}\n\n## 근거 청크 (응답자: ${doc.filename})\n${formatDocEvidence(doc.chunks, opts?.inputCharCap)}`,
    prompt:
      '위 응답자 전사록에서 탑라인 종합에 쓸 themes·대표 quotes 와 함께, 응답자 속성(attributes)·닫힌 문항 코딩(coded)을 빠짐없이 구조화 추출하세요. 근거 청크에 실제로 있는 내용만, 각 항목에 chunk_id 를 답니다. 속성·코딩 근거가 없으면 null/빈 배열로 둡니다(추정 금지).',
    temperature: 0.2,
    // themes/quotes 에 더해 속성·닫힌문항 코딩까지 담으므로 출력 예산을 상향
    // (닫힌 문항이 많은 응답자는 coded 항목이 늘어남).
    maxOutputTokens: 6_000,
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
      // 속성 한 줄 — 있는 값만(없으면 미상). reduce 가 프로필/교차분석에서 활용.
      const a = e.attributes;
      const attrBits = [
        a?.race ? `인종:${a.race}` : null,
        a?.gender ? `성별:${a.gender}` : null,
        a?.age != null ? `나이:${a.age}` : a?.age_group ? `나이대:${a.age_group}` : null,
      ].filter(Boolean);
      const attrLine = attrBits.length ? attrBits.join(' · ') : '미상(근거 없음)';
      const flag = e.failed ? ' ⚠️(추출 실패 — 이 응답자는 근거 없음)' : '';
      return `### 응답자 ${i + 1}/${extracts.length} — ${e.filename}${flag}\n속성: ${attrLine}\n주제:\n${themes}\n대표 인용:\n${quotes}`;
    })
    .join('\n\n');
}

/* ────────────────────────────────────────────────────────────────────
   체인 단계 설정 — 검증 + 머지 (순수 모듈).

   계약: `design-handoff/chain-inspector/WRITER-FIELD-DEFINITIONS.md` §6 +
   스펙 범위 §3(화이트리스트 + 종류별 검증) · §4(부분 머지).

   **왜 화이트리스트인가**: 미지의 키를 통과시켜 jsonb 에 쌓으면 다음 사람이
   그게 유효한 설정인지 알 수 없게 된다 — 어느 키가 소비되고 어느 키가 쓰레기
   인지 구분 불가. 그래서 `ui-meta.ts` 의 `inspectorSchema` 필드 id 집합이
   **유일한 허용 키 집합**이고, 벗어나면 400 이다.

   검증 규칙은 필드 **kind 에서 파생**한다(필드 id 별 분기 0) — "위젯별
   하드코딩 0"(CD Done-when)이 UI 뿐 아니라 검증에도 적용된다. 상한값도
   선언(ui-meta)에서 읽는다.

   **메타를 import 하지 않고 인자로 받는다**: 이 모듈이 `ui-meta` 를 런타임
   import 하면 그 모듈의 `@/` alias 체인이 따라와 `tests/` 로더(node
   --experimental-strip-types, alias 해석 없음)가 로드하지 못한다. 검증 규칙은
   체인에서 가장 틀리기 쉬운 부분이라 단위 테스트로 고정해야 하므로, 조회는
   호출부(라우트)가 `stepUiMeta(feature)` 로 하고 여기는 **순수 함수**로 둔다.
   ──────────────────────────────────────────────────────────────────── */

import { z } from 'zod';
// 타입 전용 import — 런타임에 사라진다(위 주석의 로더 제약 참고).
import type {
  ChainStepFieldDef,
  ChainStepFieldKind,
  ChainStepUiMeta,
} from './ui-meta';

// 사용자가 config 로 쓸 수 있는 kind. 나머지(dropzone/readonly)는 **값의
// 거처가 config 가 아니다** — 업로드는 기존 업로드 경로, 읽기 전용 행은
// 앞 단계/체인에서 파생된 표시값이다.
const WRITABLE_KINDS: readonly ChainStepFieldKind[] = [
  'segment',
  'select',
  'textarea',
  'toggle',
  'orderedList',
];

// 선언에 상한이 없는 경우의 보수적 기본값. 상한은 선언 쪽에 두는 것이 원칙
// 이고(ui-meta `maxLength`/`maxItems`/`itemMaxLength`), 이 값들은 누락 시의
// 안전망이다 — 상한 없는 문자열이 jsonb 에 들어가는 경로를 만들지 않는다.
const DEFAULT_TEXT_MAX = 1_000;
const DEFAULT_ITEM_MAX = 500;
const DEFAULT_ITEMS_MAX = 30;

export type StepConfigErrorCode =
  // 그 단계의 inspectorSchema 에 없는 키.
  | 'unknown_field'
  // 선언돼 있지만 사용자가 쓰는 값이 아님(source upstream/chain · dropzone ·
  // readonly). §0 구멍 ② 의 서버측 대응물.
  | 'readonly_field'
  // 종류별 값 검증 실패(옵션 밖 값 · 타입 불일치 · 길이/개수 초과).
  | 'invalid_value';

export type StepConfigValidation =
  | { ok: true; patch: Record<string, unknown> }
  | {
      ok: false;
      error: StepConfigErrorCode;
      /** 문제가 된 필드 id. */
      field: string;
      /** 진단용 상세 — 라우트가 body 에 그대로 흘린다. */
      detail: string;
    };

/** kind 별 값 스키마 — 상한은 선언에서 읽는다(필드 id 분기 0). */
function schemaFor(field: ChainStepFieldDef): z.ZodType {
  switch (field.kind) {
    case 'segment':
    case 'select': {
      // 선언된 `options` 안의 값만. 옵션 선언이 없으면 받을 기준이 없으므로
      // 어떤 값도 통과시키지 않는다(조용히 허용하는 것보다 안전).
      const allowed = new Set((field.options ?? []).map((o) => o.value));
      return z.string().refine((v) => allowed.has(v), {
        message: 'not_in_options',
      });
    }
    case 'toggle':
      return z.boolean();
    case 'textarea':
      return z.string().max(field.maxLength ?? DEFAULT_TEXT_MAX);
    case 'orderedList':
      return z
        .array(z.string().max(field.itemMaxLength ?? DEFAULT_ITEM_MAX))
        .max(field.maxItems ?? DEFAULT_ITEMS_MAX);
    default:
      // 쓰기 불가 kind — 아래 isWritable 이 먼저 걸러낸다.
      return z.never();
  }
}

function isWritable(field: ChainStepFieldDef): boolean {
  const source = field.source ?? 'user';
  return source === 'user' && WRITABLE_KINDS.includes(field.kind);
}

/**
 * PATCH 로 들어온 **부분 config** 를 검증한다. 하나라도 걸리면 전체 거절 —
 * 일부만 반영하면 사용자가 본 인스펙터와 저장된 값이 갈라진다.
 *
 * `null` 값은 **그 키를 비우는 것**으로 받는다(RFC 7396 merge-patch 시맨틱).
 * 부분 머지 계약에서 "선택 필드를 다시 비움" 을 표현할 다른 수단이 없기
 * 때문이다 — 키를 빼면 "변경 없음" 이라 지울 수 없다.
 */
export function validateStepConfigPatch(
  meta: ChainStepUiMeta,
  patch: Record<string, unknown>,
): StepConfigValidation {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const field = meta.inspectorSchema.find((f) => f.id === key) ?? null;
    if (!field) {
      return {
        ok: false,
        error: 'unknown_field',
        field: key,
        detail: `${key} is not a field of this step`,
      };
    }
    if (!isWritable(field)) {
      return {
        ok: false,
        error: 'readonly_field',
        field: key,
        detail: `${key} is supplied by ${field.source ?? field.kind}, not by the user`,
      };
    }
    if (value === null) {
      out[key] = null; // 머지에서 키 삭제로 해석된다.
      continue;
    }
    const parsed = schemaFor(field).safeParse(value);
    if (!parsed.success) {
      return {
        ok: false,
        error: 'invalid_value',
        field: key,
        detail: `${key}: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
      };
    }
    out[key] = parsed.data;
  }

  return { ok: true, patch: out };
}

/**
 * 부분 머지 — 전체 교체가 아니다. `null` 값은 키 삭제.
 *
 * 반환은 **새 객체**(입력 불변). 호출부는 이 결과를 그 단계 원소에만 꽂는다.
 */
export function mergeStepConfig(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

/**
 * 비어 있는 필수 필드 — unset / ready 판정(§1)과 체크리스트(최대 3행)의 입력.
 *
 * 비어 있다고 보는 값: 키 없음 · null/undefined · 빈 문자열 · 빈 배열.
 * `false`(토글)는 **채워진 값**이다 — 사용자가 끄기를 선택한 것이다.
 *
 * 반환이 빈 배열이면 ready. 애초에 `requiredFields` 가 빈 배열인 단계
 * (interview_ingest)는 항상 ready 다 — unset 을 건너뛴다(§0 구멍 ③).
 */
export function missingRequiredFields(
  meta: ChainStepUiMeta,
  config: Record<string, unknown>,
  ctx: Parameters<ChainStepUiMeta['requiredFields']>[0],
): readonly string[] {
  return meta.requiredFields(ctx).filter((id) => {
    const v = config[id];
    if (v === undefined || v === null) return true;
    if (typeof v === 'string') return v.trim().length === 0;
    if (Array.isArray(v)) return v.length === 0;
    return false;
  });
}

// ── 소비 해석 (어댑터·kick 경로가 쓰는 변환) ─────────────────────────────
//
// 저장된 config → **각 위젯 경로가 실제로 받는 파라미터**. 변환을 어댑터
// 안에 인라인으로 두지 않고 여기 둔 이유 두 가지:
//   1. 어댑터·advance 는 server-only(서비스롤·CRON_SECRET) 라 단위 테스트가
//      로드할 수 없다. "설정이 정말 소비되는가" 는 이 PR 의 핵심 계약인데,
//      그걸 기계로 고정할 수 있는 유일한 자리가 순수 모듈이다.
//   2. 폴백 규칙(설정 없음 = 현행 동작)이 한곳에 모인다 — 소비 지점이
//      늘어날 때 각자 자기 폴백을 발명하면 체인마다 기본값이 갈라진다.

export type TranscriptKickConfig = {
  /** 전사 언어 코드. null = 미지정 → getLanguage(null) 의 기본값(multi). */
  language: string | null;
  /** transcript_jobs.mode — DB 체크 제약 집합('research' | 'meeting'). */
  mode: 'research' | 'meeting';
};

/**
 * 전사 단계 설정 → 전사 job 파라미터.
 *
 * **폴백 = 현행 동작**: 설정이 없으면 language=null(→ multi → ElevenLabs
 * Scribe) · mode='research'. 이 PR 이전 체인의 동작이 그것이고, 바뀌면 회귀다.
 * 모르는 값도 같은 기본값으로 흡수한다 — 설정 하나 때문에 체인이 멈추는 것
 * 보다 현행 동작으로 도는 것이 낫다.
 */
export function resolveTranscriptKick(
  config: Record<string, unknown>,
): TranscriptKickConfig {
  return {
    language: typeof config.language === 'string' ? config.language : null,
    mode: config.method === 'meeting' ? 'meeting' : 'research',
  };
}

/**
 * 탑라인 단계 설정 → `POST /api/interviews/v2/topline` body 조각.
 *
 * **미설정 키는 싣지 않는다** — 라우트의 기존 폴백(output_lang 미지정 → 프로필
 * 로케일 → 기본 한국어 · 방향 없음 · allow_partial=false)을 그대로 타게 해
 * config 없는 기존 체인의 결과물이 변하지 않게 한다. 빈 문자열 방향도 "지정
 * 안 함" 으로 본다(라우트도 `trim() || null` 로 같게 해석한다).
 *
 * `force`(강제 재생성)는 설정이 아니라 재실행 동작이라 포함하지 않는다(§5.4).
 */
export function resolveToplineKick(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof config.output_lang === 'string') {
    out.output_lang = config.output_lang;
  }
  if (typeof config.user_direction === 'string' && config.user_direction.trim()) {
    out.user_direction = config.user_direction;
  }
  if (typeof config.allow_partial === 'boolean') {
    out.allow_partial = config.allow_partial;
  }
  return out;
}

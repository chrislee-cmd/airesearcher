/* ────────────────────────────────────────────────────────────────────
   체인 단계 설정 — 선언형 UI 메타 (요약 카드 + 인스펙터 공용 SSOT).

   계약 SSOT = `design-handoff/chain-inspector/WRITER-FIELD-DEFINITIONS.md`
   §1 공통 규칙 · §2~§5 노드 4종 필드 정의 · §6.2 선언형 계약. CD 컴프의
   필드 값은 제안이고 그 문서의 값이 확정이다(CD README §8 명시).

   **왜 선언이 코드 한 곳에 모이는가 (CD Done-when "위젯별 하드코딩 0")**:
   요약 카드 3행 · 인스펙터 섹션/필드 · 필수 판정(unset/ready) · 완료 요약이
   전부 이 메타 하나에서 파생된다. 위젯마다 카드 컴포넌트를 따로 쓰면 노드가
   추가될 때마다 네 군데가 갈라지고, "설정했는데 요약에 안 뜨는" 상태가 생긴다.

   ⚠️ **클라이언트-안전 — registry.ts 와 같은 제약**(그 파일 머리 참고).
   server-only(supabase admin · env · node 내장)를 절대 import 하지 않는다.
   이유가 registry 와 동일하다: **프론트 렌더러와 서버 검증(step-config.ts)이
   같은 모듈을 읽어야** 화이트리스트가 하나로 유지된다. 프론트에 스키마를
   복제하면 서버가 거절하는 필드를 UI 가 그리는 상태가 된다.

   레이블은 **전부 labelKey**(messages 경로)다 — 한글 리터럴 0,
   `check:i18n` 4로케일 parity 대상. 키는 `messages/*.json` 의
   `Chain.inspector.*` 아래 산다.

   검증 규칙(step-config.ts)은 이 선언을 **인자로 받는다** — 그쪽이 이 모듈을
   런타임 import 하면 아래 `@/` 체인이 따라와 단위 테스트가 로드할 수 없게
   된다(`tests/` 로더는 alias 를 해석하지 않는다). 조회는 라우트가 한다.
   ──────────────────────────────────────────────────────────────────── */

import { LANGUAGES } from '@/lib/transcripts/languages';
import { OUTPUT_LANGS } from '@/lib/i18n/output-language';
import type { ChainStepKey } from './registry';
// 타입 전용 import — 런타임/번들 영향 0(stripping 으로 사라진다). 아래
// 드리프트 가드가 "기존 라우트 enum 과 집합이 같다" 를 컴파일 타임에 못박는
// 용도로만 쓴다. 이 두 모듈은 **프롬프트 모듈**이라 런타임 import 는 금지 —
// 클라이언트 번들에 LLM 프롬프트 전문이 실린다.
import type {
  ToplineOutputLang,
  TOPLINE_DIRECTION_MAX,
} from '@/lib/interview-v2/topline-prompt';
import type { ProbingOutputLang } from '@/lib/probing-prompts';

// ── §6.2 선언형 계약 타입 ─────────────────────────────────────────────────

export type ChainStepFieldKind =
  | 'segment'
  | 'select'
  | 'textarea'
  | 'toggle'
  | 'orderedList'
  | 'dropzone'
  | 'readonly';

export type ChainStepFieldOption = {
  readonly value: string;
  readonly labelKey: string;
};

export type ChainStepFieldDef = {
  /** config 키. 소비 지점(어댑터/kick)이 읽는 이름과 **같아야** 한다. */
  readonly id: string;
  /** messages 경로. 해석값 6자 이내(ko) — §1 공통 규칙. */
  readonly labelKey: string;
  readonly kind: ChainStepFieldKind;
  /** 섹션 labelKey(§2~§5 의 섹션 제목). */
  readonly section: string;
  /**
   * 값의 출처. 기본 'user'.
   *   upstream — 앞 단계가 공급한다. 필수 계산에서 제외 + 읽기 전용 행(§1).
   *   chain    — 체인 레벨 값(프로젝트 등). 단계 설정이 아니다(§0 구멍 ②).
   * user 가 아닌 필드는 **쓰기 거절**(step-config.ts) — 사용자가 정하는
   * 값이 아니므로 config 에 들어오면 그 자체가 계약 위반이다.
   */
  readonly source?: 'user' | 'upstream' | 'chain';
  readonly options?: readonly ChainStepFieldOption[];
  readonly hintKey?: string;
  /**
   * §6.2 계약의 **선택 확장** — 범위 §3 "종류별 값 검증(textarea 는 문자열
   * 길이 상한 · orderedList 는 문자열 배열)" 을 선언형으로 구현하려면 상한이
   * 필드에 있어야 한다. 검증기에 id 별 상한을 하드코딩하면 "위젯별 하드코딩
   * 0" 이 깨지므로 선언 쪽에 둔다. 값은 각 필드의 **기존 소비 경로 상한과
   * 동일**하게 맞춘다(아래 상수 참고) — 여기만 느슨하면 저장은 되고 kick 이
   * 400 으로 거절하는 유령 설정이 생긴다.
   */
  readonly maxLength?: number;
  /** orderedList 항목 수 상한. */
  readonly maxItems?: number;
  /** orderedList 각 항목의 문자열 길이 상한. */
  readonly itemMaxLength?: number;
};

export type ChainStepUiMeta = {
  /** 요약 카드 행 — 최대 3, 순서 그대로(§1). */
  readonly summaryFields: readonly string[];
  /**
   * done 상태 요약 3행. 설정이 아니라 **결과**다(CD §1.3) — 그래서
   * inspectorSchema 의 필드 id 가 아니고, 값은 각 위젯 job 결과에서 온다.
   * 레이블은 `Chain.inspector.done.<feature>.<id>` 규약으로 해석한다
   * (§6.2 의 타입에 doneFields 용 def 가 없으므로 경로 규약으로 둔다).
   */
  readonly doneFields: readonly string[];
  /**
   * 필수 필드 — **정적 배열이 아니라 함수**(§3.2). 같은 위젯이 체인 위치에
   * 따라 필수 집합이 달라진다(전사록: 앞에 프로빙이 있으면 입력이 upstream).
   * 반환이 빈 배열이면 unset 을 건너뛰고 ready 로 시작한다(§0 구멍 ③).
   */
  readonly requiredFields: (ctx: {
    position: number;
    upstream: ChainStepKey | null;
  }) => readonly string[];
  readonly inspectorSchema: readonly ChainStepFieldDef[];
};

// ── 옵션 집합 (기존 enum 과 드리프트 0) ──────────────────────────────────

// 출력 언어 — 코드 집합 SSOT 는 `lib/i18n/output-language`(§Phase 7). 아래
// 대입이 **드리프트 가드**다: 기존 라우트 enum(TOPLINE_OUTPUT_LANGS /
// PROBING_OUTPUT_LANGS)과 집합이 어긋나면 타입 에러로 컴파일이 깨진다.
const OUTPUT_LANG_CODES: readonly (ToplineOutputLang & ProbingOutputLang)[] =
  OUTPUT_LANGS;

const OUTPUT_LANG_OPTIONS: readonly ChainStepFieldOption[] =
  OUTPUT_LANG_CODES.map((code) => ({
    value: code,
    // endonym(자국어 표기, 번역 안 함) — 기존 위젯 셀렉터와 같은 표기 규칙.
    labelKey: `Chain.inspector.option.outputLang.${code}`,
  }));

// 전사 원본 언어 — 전사록 위젯과 **같은 레지스트리**(`multi` = 자동 감지
// 포함, §3.4). 레이블은 기존 `Languages.<code>` 재사용(4로케일 이미 존재).
const TRANSCRIPT_LANGUAGE_OPTIONS: readonly ChainStepFieldOption[] =
  LANGUAGES.map((l) => ({ value: l.code, labelKey: `Languages.${l.code}` }));

// 전사 방식 — `transcript_jobs.mode` 체크 제약과 동일 집합
// (20260708151416_transcript_mode_speaker_count.sql: research | meeting).
const TRANSCRIPT_METHOD_OPTIONS: readonly ChainStepFieldOption[] = [
  { value: 'research', labelKey: 'Chain.inspector.option.method.research' },
  { value: 'meeting', labelKey: 'Chain.inspector.option.method.meeting' },
];

// 프로빙 입력 소스 — `probing_session_runs.source` 허용 집합과 동일
// (mic=오프라인 · both=온라인 · tab=참관).
const PROBING_SOURCE_OPTIONS: readonly ChainStepFieldOption[] = [
  { value: 'mic', labelKey: 'Chain.inspector.option.source.mic' },
  { value: 'both', labelKey: 'Chain.inspector.option.source.both' },
  { value: 'tab', labelKey: 'Chain.inspector.option.source.tab' },
];

// 길이 상한 — **기존 소비 경로와 같은 값**으로 맞춘다.
//   · 프로빙 조사 목적   = /api/probing/research-context 의 GOAL_MAX
//   · 프로빙 주입 질문   = 같은 라우트의 QUESTION_MAX / QUESTIONS_MAX_COUNT
//   · 토플라인 작성 방향 = TOPLINE_DIRECTION_MAX (타입 전용 import 로 교차 검증 —
//     라우트 상한이 바뀌면 이 대입이 컴파일 에러가 된다)
const PROBING_GOAL_MAX = 2_000;
const PROBING_QUESTION_MAX = 500;
const PROBING_QUESTIONS_MAX_COUNT = 30;
const TOPLINE_DIRECTION_MAX_LOCAL: typeof TOPLINE_DIRECTION_MAX = 600;

// ── 노드 4종 선언 (§2~§5) ────────────────────────────────────────────────

/**
 * 노드별 선언형 메타. `Record<ChainStepKey, …>` 라 레지스트리에 노드를
 * 추가하면 **여기도 채우지 않으면 컴파일이 깨진다** — "인스펙터는 체인에
 * 들어올 수 있는 모든 노드를 렌더한다"(필드정의 §범위)를 타입으로 강제한다.
 */
export const CHAIN_STEP_UI_META: Record<ChainStepKey, ChainStepUiMeta> = {
  // §2 probing — 인터뷰 어시스턴트.
  probing: {
    summaryFields: ['source', 'outputLang', 'questions'],
    doneFields: ['questionCount', 'duration', 'recording'],
    // §2.2 — **기본값을 두지 않는다**: 단독 위젯은 source 가 'mic' 로
    // 시작하지만 체인은 무인이라 온라인 인터뷰를 오프라인 캡처로 돌리면
    // 상대 음성이 통째로 빠지고 알아차릴 사람이 없다. 그래서 unset 이 있다.
    requiredFields: () => ['source', 'outputLang'],
    inspectorSchema: [
      {
        id: 'source',
        labelKey: 'Chain.inspector.field.probing.source',
        kind: 'segment',
        section: 'Chain.inspector.section.input',
        hintKey: 'Chain.inspector.hint.probing.input',
        options: PROBING_SOURCE_OPTIONS,
      },
      {
        id: 'outputLang',
        labelKey: 'Chain.inspector.field.probing.outputLang',
        kind: 'select',
        section: 'Chain.inspector.section.language',
        options: OUTPUT_LANG_OPTIONS,
      },
      {
        id: 'questions',
        labelKey: 'Chain.inspector.field.probing.questions',
        kind: 'orderedList',
        section: 'Chain.inspector.section.questions',
        hintKey: 'Chain.inspector.hint.probing.questions',
        maxItems: PROBING_QUESTIONS_MAX_COUNT,
        itemMaxLength: PROBING_QUESTION_MAX,
      },
      {
        id: 'researchGoal',
        labelKey: 'Chain.inspector.field.probing.researchGoal',
        kind: 'textarea',
        section: 'Chain.inspector.section.researchContext',
        hintKey: 'Chain.inspector.hint.probing.researchContext',
        maxLength: PROBING_GOAL_MAX,
      },
    ],
  },

  // §3 transcripts — 전사록 생성기.
  transcripts: {
    summaryFields: ['method', 'language', 'audio'],
    doneFields: ['duration', 'speakers', 'artifact'],
    // §3.2 — 앞 단계(프로빙)가 녹음을 공급하면 `audio` 는 upstream 이라 필수
    // 집합에서 빠지고, 체인 첫 단계면 사용자가 직접 올려야 하므로 필수다.
    // 호환 그래프상 transcripts 의 유일한 선행은 probing 이지만, 조건을
    // "프로빙이 앞에 있는가" 로 쓰는 쪽이 방어적이다 — 그래프가 넓어져
    // 녹음을 공급하지 않는 선행이 생기면 그때는 필수로 남아야 한다.
    requiredFields: ({ position, upstream }) =>
      position === 0 || upstream !== 'probing'
        ? ['method', 'language', 'audio']
        : ['method', 'language'],
    inspectorSchema: [
      {
        id: 'method',
        labelKey: 'Chain.inspector.field.transcripts.method',
        kind: 'segment',
        section: 'Chain.inspector.section.method',
        hintKey: 'Chain.inspector.hint.transcripts.method',
        options: TRANSCRIPT_METHOD_OPTIONS,
      },
      {
        id: 'language',
        labelKey: 'Chain.inspector.field.transcripts.language',
        kind: 'select',
        section: 'Chain.inspector.section.language',
        options: TRANSCRIPT_LANGUAGE_OPTIONS,
      },
      {
        // §3.4 — 앞 단계가 있으면 읽기 전용 행(앞 단계 녹음), 첫 단계면
        // 드롭존 + 녹음 버튼. 위치에 따라 렌더가 갈리므로 source 를 정적
        // 'upstream' 으로 못박지 않고 kind='dropzone' 으로 둔다(필수 판정은
        // 위 requiredFields 가 위치로 가른다).
        //
        // **config 에 쓰이지 않는다**: 업로드는 기존 업로드 경로(audio-uploads
        // + transcript_jobs)가 소유하고, dropzone/readonly kind 는
        // step-config 검증이 쓰기 거절한다. 여기 선언하는 이유는 인스펙터가
        // 이 행을 그려야 하기 때문이다.
        id: 'audio',
        labelKey: 'Chain.inspector.field.transcripts.audio',
        kind: 'dropzone',
        section: 'Chain.inspector.section.input',
      },
    ],
  },

  // §4 interview_ingest — 인터뷰 결과 생성기. **사용자가 정할 것이 0개**
  // (입력은 앞 단계 전사록이 자동, 분석 옵션은 API 에 없다 — §0 구멍 ③).
  interview_ingest: {
    summaryFields: ['upstreamTranscript', 'projectDocuments'],
    doneFields: ['analysis', 'documents', 'artifact'],
    // 빈 배열 → unset 생략, 처음부터 ready. 카드 푸터는 "설정하기" 대신
    // "입력 보기"(누를 것이 없는 버튼 금지 — §0 구멍 ③).
    requiredFields: () => [],
    inspectorSchema: [
      {
        id: 'upstreamTranscript',
        labelKey: 'Chain.inspector.field.interview_ingest.upstreamTranscript',
        kind: 'readonly',
        section: 'Chain.inspector.section.input',
        source: 'upstream',
      },
      {
        // 체인 레벨 프로젝트에 이미 적재된 문서 수 — 단계 설정이 아니다
        // (§0 구멍 ②: 프로젝트는 체인 설정). 읽기 전용 행으로만 보인다.
        id: 'projectDocuments',
        labelKey: 'Chain.inspector.field.interview_ingest.projectDocuments',
        kind: 'readonly',
        section: 'Chain.inspector.section.input',
        source: 'chain',
      },
    ],
  },

  // §5 topline — 전체 리포트 생성기. 필드 id = 라우트 body 키와 동일
  // (`POST /api/interviews/v2/topline`) — 소비 지점이 그 이름으로 읽는다.
  topline: {
    summaryFields: ['output_lang', 'user_direction', 'allow_partial'],
    doneFields: ['report', 'length', 'generatedAt'],
    requiredFields: () => ['output_lang'],
    inspectorSchema: [
      {
        id: 'output_lang',
        labelKey: 'Chain.inspector.field.topline.output_lang',
        kind: 'select',
        section: 'Chain.inspector.section.output',
        options: OUTPUT_LANG_OPTIONS,
      },
      {
        id: 'user_direction',
        labelKey: 'Chain.inspector.field.topline.user_direction',
        kind: 'textarea',
        section: 'Chain.inspector.section.direction',
        hintKey: 'Chain.inspector.hint.topline.direction',
        maxLength: TOPLINE_DIRECTION_MAX_LOCAL,
      },
      {
        id: 'allow_partial',
        labelKey: 'Chain.inspector.field.topline.allow_partial',
        kind: 'toggle',
        section: 'Chain.inspector.section.advanced',
        hintKey: 'Chain.inspector.hint.topline.allowPartial',
      },
      // `force`(강제 재생성)는 **설정이 아니라 재실행 동작**이므로 두지
      // 않는다(§5.4) — 완료 단계의 풀뷰에서 기존 경로로 재생성한다.
    ],
  },
};

// ── 조회 헬퍼 ────────────────────────────────────────────────────────────

/**
 * 사용자가 **인스펙터에서 직접 값을 정하는** 필드인가.
 *
 * `source` 가 user 가 아닌 필드(upstream = 앞 단계가 공급 · chain = 체인 레벨)와
 * `dropzone`/`readonly` kind 는 **값의 거처가 config 가 아니다** — 업로드는 기존
 * 업로드 경로가 소유하고, 읽기 전용 행은 앞 단계/체인에서 파생한 표시값이다.
 * 그래서 필수 판정·"외 n개 설정"·하단 진행도의 분모에서 전부 빠진다.
 *
 * ⚠️ `step-config.ts` 가 **같은 판정을 자기 안에 따로 들고 있다**(`isWritable`).
 * 그 모듈은 이 모듈을 런타임 import 할 수 없어서다(파일 머리 주석 — tests 로더가
 * `@/` alias 를 해석하지 못한다). 한쪽만 고치면 "UI 는 그리는데 서버가 거절하는"
 * 필드가 생기므로 **둘을 같이** 바꾼다.
 */
export function isUserConfigurableField(field: ChainStepFieldDef): boolean {
  if ((field.source ?? 'user') !== 'user') return false;
  return (
    field.kind === 'segment' ||
    field.kind === 'select' ||
    field.kind === 'textarea' ||
    field.kind === 'toggle' ||
    field.kind === 'orderedList'
  );
}


/**
 * 레지스트리 단계 key 인가 — **이 모듈의 키 집합으로** 판별한다.
 *
 * registry 의 `isChainStepKey` 를 쓰지 않는 이유: 그 함수를 런타임 import
 * 하면 registry → `@/lib/features` 체인이 따라와 tests 로더가 이 모듈을
 * 로드할 수 없다. 위 `Record<ChainStepKey, …>` 가 두 집합의 일치를 타입으로
 * 보장하므로 판정은 같다.
 */
export function hasStepUiMeta(feature: string): feature is ChainStepKey {
  return Object.prototype.hasOwnProperty.call(CHAIN_STEP_UI_META, feature);
}

export function stepUiMeta(feature: string): ChainStepUiMeta | null {
  return hasStepUiMeta(feature) ? CHAIN_STEP_UI_META[feature] : null;
}

/** 단계의 필드 정의 1개 — 없으면 null. */
export function stepFieldDef(
  feature: string,
  fieldId: string,
): ChainStepFieldDef | null {
  const meta = stepUiMeta(feature);
  if (!meta) return null;
  return meta.inspectorSchema.find((f) => f.id === fieldId) ?? null;
}

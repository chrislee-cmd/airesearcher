/* ────────────────────────────────────────────────────────────────────
   체인 요약 카드 · 인스펙터 — **파생 규칙 SSOT** (순수 모듈).

   CD SSOT = `design-handoff/chain-inspector/README.md` §1.3 상태 4종 ·
   §1.4 요약 행 · §3 미설정 · §4.6 필수 진행도 · §5 잠금, 그리고
   `chain-inspector-scenes.dc.html` I1 갤러리 5칸(비주얼 SSOT).
   필드 값 SSOT = `WRITER-FIELD-DEFINITIONS.md`(§1 공통 규칙 · §6.2 선언).

   **왜 파생이 한 모듈에 모이는가 (CD §10 Done-when "위젯별 하드코딩 0")**:
   카드 상태 · 남은 필수 항목 · 요약 3행 · 완료 3행 · 인스펙터 하단 진행도가
   전부 같은 두 입력(`ui-meta` 선언 + `ChainStepView`)에서 나온다. 컴포넌트가
   각자 계산하면 "카드는 준비됨인데 인스펙터 하단은 필수 2/3" 같은 갈라짐이
   생긴다 — 그 갈라짐이 곧 사용자가 못 믿는 화면이다.

   순수(React·페칭 0) — 카드·인스펙터·레인 헤더가 같이 쓴다. 로케일 해석이
   필요한 함수는 `t` 를 **인자로** 받는다(모듈이 next-intl 에 묶이지 않게).
   ──────────────────────────────────────────────────────────────────── */

import {
  isUserConfigurableField,
  stepUiMeta,
  type ChainStepFieldDef,
} from './ui-meta';
import type { ChainNodeStatus, ChainStepFeature, ChainStepView } from './view';

/**
 * **루트 스코프** 번역 함수(`useTranslations()`).
 *
 * 루트인 이유: `ui-meta` 의 `labelKey`/`hintKey`/옵션 키가 **전체 경로**
 * (`Chain.inspector.field.…` · `Languages.ko`)로 선언돼 있다. `Chain` 스코프로
 * 받으면 그 경로가 `Chain.Chain.…` 이 된다 — 선언을 상대 경로로 바꾸는 쪽은
 * 저장 계약(선행 PR) 수정이라 이 PR 범위 밖이다.
 */
export type ChainTranslate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

/**
 * 카드 본문 레이아웃 5종 — CD `.dc.html` I1 갤러리의 5칸과 1:1.
 *
 * `noconfig` 는 **5번째 상태 어휘가 아니다**(CD 확정: 배지는 `idle` "준비됨"
 * 그대로). 본문·푸터 액션만 다른 ready 의 변종이라 레이아웃 key 로만 둔다.
 */
export type ChainCardLayout = 'unset' | 'ready' | 'noconfig' | 'running' | 'done';

/** 시그널 계열 — 팔레트(`palette-model`)와 같은 4+1 집합. 신설 0. */
export type ChainCardSignal = 'ok' | 'run' | 'warn' | 'idle' | 'err';

export type ChainCardBadge = {
  tone: ChainCardSignal;
  /** `Chain.*` 아래 i18n 키. */
  labelKey: string;
  /** 맥동은 **진행 중에만**(CD §1.3 "맥동은 배지 점에만"). */
  pulse: boolean;
};

/** 파생에 필요한 단계 맥락 — 뷰에서 뽑아 한 번에 넘긴다. */
export type ChainStepContext = {
  feature: ChainStepFeature;
  /** 0-based 단계 index(= `requiredFields` 의 `position`). */
  position: number;
  /** 바로 앞 단계. 없으면 null. */
  upstream: ChainStepFeature | null;
  status: ChainNodeStatus;
  config: Record<string, unknown>;
};

export function stepContextOf(
  steps: readonly ChainStepView[],
  index: number,
): ChainStepContext | null {
  const step = steps[index];
  if (!step) return null;
  return {
    feature: step.feature,
    position: index,
    upstream: index > 0 ? (steps[index - 1]?.feature ?? null) : null,
    status: step.status,
    config: step.config,
  };
}

// ── 값이 비었는가 ────────────────────────────────────────────────────────

/**
 * config 값이 "채워졌다" 로 볼 수 있는가.
 *
 * `false` 를 **채워진 값으로 센다** — 토글을 끈 것은 설정하지 않은 것이
 * 아니다. 빈 문자열·빈 배열은 비었다(선택 필드를 되돌리는 수단이 `null` 이라
 * 빈 문자열이 남는 경로도 있다 — RFC 7396, step-config.ts).
 */
export function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

// ── 필수 · 편집 가능 집합 ────────────────────────────────────────────────

/**
 * 이 단계에서 **사용자가 인스펙터로 채울 수 있는 필수 필드**.
 *
 * ⚠️ 선언된 `requiredFields` 전부가 아니라 `isUserConfigurableField` 를 통과한
 * 것만이다. 보수적 해석의 근거(PR 본문에도 명시):
 *   `transcripts.audio` 는 체인 첫 단계일 때 필수로 선언돼 있지만 kind 가
 *   `dropzone` 이라 **값의 거처가 config 가 아니다**(업로드는 기존
 *   audio-uploads + transcript_jobs 경로가 소유하고, step-config 검증이 config
 *   쓰기를 거절한다). 그걸 "안 채워짐" 으로 세면 그 카드는 **영구 unset** 이
 *   되고 CD §3 런타임 규칙에 따라 체인이 그 앞에서 영구히 paused 로 멈춘다 —
 *   인스펙터에서 풀 방법이 없는 막힘이다. 그래서 판정 대상에서 제외하고,
 *   필드 자체는 인스펙터가 드롭존/읽기 전용 행으로 계속 그린다.
 */
export function evaluableRequiredFields(
  ctx: ChainStepContext,
): readonly ChainStepFieldDef[] {
  const meta = stepUiMeta(ctx.feature);
  if (!meta) return [];
  const required = new Set(
    meta.requiredFields({ position: ctx.position, upstream: ctx.upstream }),
  );
  return meta.inspectorSchema.filter(
    (f) => required.has(f.id) && isUserConfigurableField(f),
  );
}

/** 인스펙터에서 사용자가 만질 수 있는 필드 전부(필수 + 선택). */
export function userConfigurableFields(
  feature: ChainStepFeature,
): readonly ChainStepFieldDef[] {
  return stepUiMeta(feature)?.inspectorSchema.filter(isUserConfigurableField) ?? [];
}

/** 아직 안 채운 필수 필드 — unset 체크리스트와 하단 진행도의 근거. */
export function missingRequiredFields(
  ctx: ChainStepContext,
): readonly ChainStepFieldDef[] {
  return evaluableRequiredFields(ctx).filter((f) => !isFilled(ctx.config[f.id]));
}

export type ChainRequiredProgress = {
  /** 채운 개수. */
  filled: number;
  /** 판정 가능한 필수 개수. 0 이면 "설정 없음"(§4.4 끝 각주). */
  total: number;
  missing: readonly ChainStepFieldDef[];
};

export function requiredProgressOf(ctx: ChainStepContext): ChainRequiredProgress {
  const required = evaluableRequiredFields(ctx);
  const missing = required.filter((f) => !isFilled(ctx.config[f.id]));
  return { filled: required.length - missing.length, total: required.length, missing };
}

// ── 카드 레이아웃 · 배지 ─────────────────────────────────────────────────

/**
 * 설정이 0개인 단계인가 — CD 확정 `noconfig`.
 *
 * 판정은 CD 원문 그대로 "`requiredFields` · 편집 필드가 0개면" 이다. 그래서
 * `interview_ingest`(읽기 전용 2행뿐)만 해당하고, 노드가 추가돼도 선언만 보고
 * 갈린다 — 위젯 key 분기 0.
 */
export function hasNoUserConfig(ctx: ChainStepContext): boolean {
  return (
    evaluableRequiredFields(ctx).length === 0 &&
    userConfigurableFields(ctx.feature).length === 0
  );
}

/**
 * 카드 본문 레이아웃.
 *
 * 실행/완료는 **노드 상태**가 정하고, 그 전은 **설정**이 정한다. CD 가 그리지
 * 않은 노드 상태(awaiting · paused · error)는 **레이아웃을 새로 만들지 않고**
 * 설정 기준 레이아웃을 쓴다 — 멈춤의 가장 흔한 사유가 "설정 필요"(§3)이고,
 * 그때 사용자가 봐야 하는 것이 바로 남은 필수 항목이기 때문이다. 상태의 차이는
 * **배지**가 말한다(상태 어휘 신설 0).
 */
export function cardLayoutOf(ctx: ChainStepContext): ChainCardLayout {
  if (ctx.status === 'running') return 'running';
  if (ctx.status === 'done' || ctx.status === 'skipped') return 'done';
  if (hasNoUserConfig(ctx)) return 'noconfig';
  return missingRequiredFields(ctx).length > 0 ? 'unset' : 'ready';
}

/** 상태 배지 — 기존 어휘만 쓴다(§3 "상태 어휘를 새로 만들지 않습니다"). */
export function cardBadgeOf(ctx: ChainStepContext): ChainCardBadge {
  switch (ctx.status) {
    case 'running':
      return { tone: 'run', labelKey: 'Chain.card.badge.running', pulse: true };
    case 'done':
      return { tone: 'ok', labelKey: 'Chain.card.badge.done', pulse: false };
    case 'skipped':
      return { tone: 'idle', labelKey: 'Chain.chip.state.skipped', pulse: false };
    case 'error':
      return { tone: 'err', labelKey: 'Chain.card.badge.error', pulse: false };
    case 'paused':
      return { tone: 'warn', labelKey: 'Chain.chip.state.stopped', pulse: false };
    case 'awaiting':
      return { tone: 'warn', labelKey: 'Chain.chip.state.awaiting', pulse: false };
    case 'pending':
    default:
      // unset 만 warn. noconfig 는 **ready 그대로**(CD 확정 — 배지 신설 0).
      return cardLayoutOf(ctx) === 'unset'
        ? { tone: 'warn', labelKey: 'Chain.card.badge.unset', pulse: false }
        : { tone: 'idle', labelKey: 'Chain.card.badge.ready', pulse: false };
  }
}

// ── 잠금 (CD §5) ────────────────────────────────────────────────────────

/**
 * 이 단계의 설정을 지금 쓸 수 있는가 — 서버 `isStepConfigEditable` 의 미러.
 *
 * 서버는 **양성 선언**이다: `pending`·`awaiting_approval` 만 쓰기 가능하고 그
 * 외(running·done·skipped·error·종결 체인)는 409. 뷰 어휘로 옮기면
 * `pending`·`awaiting` 이다 — 행 어휘를 문자열째 베끼면 항상 false 가 된다
 * (LEARNINGS §8-4 의 재발 지점).
 *
 * 대기 단계가 실행 중에도 편집 가능한 것이 이 술어에서 자동으로 따라온다
 * (다른 단계가 running 이어도 이 단계는 pending).
 */
/**
 * 체인이 활성(비종결)인가 — 서버 `ACTIVE_STATUSES`(state.ts)의 미러.
 *
 * 그 상수를 런타임 import 하지 않는 이유: `state.ts` 는 supabase 클라이언트를
 * 끌고 오는 서버측 모듈이라 클라이언트 번들에 들여올 수 없다. 같은 사유로
 * `chain-lane-provider` 도 `isTerminal` 을 자기 안에 두고 있다(선례).
 */
export function isChainActive(status: string): boolean {
  return (
    status === 'running' ||
    status === 'awaiting_approval' ||
    status === 'paused_insufficient_credits'
  );
}

export function isStepConfigWritable(
  ctx: ChainStepContext,
  chainActive: boolean,
): boolean {
  if (!chainActive) return false;
  return ctx.status === 'pending' || ctx.status === 'awaiting';
}

// ── 값 포맷 (로케일 해석 필요 — `t` 를 인자로) ──────────────────────────

/**
 * 요약 행/읽기 전용 행의 **값 문자열**.
 *
 * 분기는 `kind` 하나로만 한다(필드 id·위젯 key 분기 0). 문구의 차이는 코드가
 * 아니라 **메시지**가 흡수한다 — 필드마다 `Chain.inspector.value.<feature>.<id>`
 * 키 하나를 두고 ICU `plural`/`select` 로 "n개 주입 / 없음", "지정함 / 기본"
 * 같은 분기를 메시지 안에서 처리한다. 그래서 노드가 추가돼도 이 함수는
 * 그대로다.
 *
 * 반환 null = "아직 없음"(카드가 `—` 로 그린다).
 */
export function formatFieldValue(
  ctx: ChainStepContext,
  field: ChainStepFieldDef,
  t: ChainTranslate,
  derived: ChainDerivedValues,
): string | null {
  const raw = ctx.config[field.id];
  switch (field.kind) {
    case 'segment':
    case 'select': {
      const opt = (field.options ?? []).find((o) => o.value === raw);
      return opt ? t(opt.labelKey) : null;
    }
    case 'toggle':
      return t(valueKey(ctx.feature, field.id), {
        on: raw === true ? 'yes' : 'no',
      });
    case 'textarea':
      return t(valueKey(ctx.feature, field.id), {
        set: isFilled(raw) ? 'yes' : 'no',
      });
    case 'orderedList':
      return t(valueKey(ctx.feature, field.id), {
        n: Array.isArray(raw) ? raw.length : 0,
      });
    case 'dropzone':
    case 'readonly':
      // 값의 거처가 config 가 아니다 — 앞 단계/체인에서 파생한다.
      return t(valueKey(ctx.feature, field.id), {
        upstream: derived.upstreamStepNumber ?? 0,
        n: derived.projectDocumentCount ?? 0,
        known: derived.projectDocumentCount === null ? 'no' : 'yes',
      });
    default:
      return null;
  }
}

function valueKey(feature: ChainStepFeature, fieldId: string): string {
  return `Chain.inspector.value.${feature}.${fieldId}`;
}

/**
 * config 밖에서 와야 하는 표시값 — 읽기 전용 행과 완료 요약이 쓴다.
 * 모르는 값은 null 로 두고 메시지가 그 경우를 흡수한다(문구 발명 금지).
 */
export type ChainDerivedValues = {
  /** 앞 단계의 1-based 번호. 첫 단계면 null. */
  upstreamStepNumber: number | null;
  /** 체인 프로젝트에 적재된 문서 수. 미조회면 null. */
  projectDocumentCount: number | null;
};

export const NO_DERIVED: ChainDerivedValues = {
  upstreamStepNumber: null,
  projectDocumentCount: null,
};

export function derivedValuesOf(params: {
  ctx: ChainStepContext;
  projectDocumentCount: number | null;
}): ChainDerivedValues {
  return {
    upstreamStepNumber: params.ctx.upstream === null ? null : params.ctx.position,
    projectDocumentCount: params.projectDocumentCount,
  };
}

// ── 요약 행 ──────────────────────────────────────────────────────────────

export type ChainSummaryRow = {
  id: string;
  label: string;
  /** null = 아직 값이 없다(카드가 em dash 로 그린다). */
  value: string | null;
};

/**
 * ready/noconfig 카드 본문의 요약 행 — 선언 순서 그대로 **최대 3행**(§1.4).
 * 선언에 없는 id 는 조용히 버린다(ui-meta 가 SSOT, 카드가 보정하지 않는다).
 */
export function summaryRowsOf(
  ctx: ChainStepContext,
  t: ChainTranslate,
  derived: ChainDerivedValues,
): ChainSummaryRow[] {
  const meta = stepUiMeta(ctx.feature);
  if (!meta) return [];
  return meta.summaryFields
    .slice(0, SUMMARY_MAX)
    .flatMap((id) => {
      const field = meta.inspectorSchema.find((f) => f.id === id);
      if (!field) return [];
      return [
        {
          id,
          label: t(field.labelKey),
          value: formatFieldValue(ctx, field, t, derived),
        },
      ];
    });
}

/** CD §1.4 — 본문은 최대 3행. */
export const SUMMARY_MAX = 3;

/**
 * "외 n개 설정" 의 n — 요약에 못 들어간 **사용자 설정 필드** 수(§1.4).
 * 0 이면 그 줄을 그리지 않는다.
 */
export function hiddenConfigCount(ctx: ChainStepContext): number {
  const meta = stepUiMeta(ctx.feature);
  if (!meta) return 0;
  const shown = new Set(meta.summaryFields.slice(0, SUMMARY_MAX));
  return userConfigurableFields(ctx.feature).filter((f) => !shown.has(f.id)).length;
}

// ── 완료 요약 (CD §1.3 done — "설정이 아니라 결과") ─────────────────────

/**
 * 완료 카드의 결과 요약 행.
 *
 * ⚠️ **값의 출처가 아직 없다**(PR 본문에 명시한 보수적 처리). `doneFields` 는
 * 선언돼 있지만 그 값은 각 위젯 job 결과("48분 · 8,200자" · "인용 23개")에서
 * 오고, 그것은 `ChainStepView` 에 실려 있지 않다 — 싣는 일은 저장 계약 소관
 * (선행 PR 범위, 이 PR 범위 밖)이다. 그래서 **파생 가능한 행만** 내보내고,
 * 빠진 행이 있으면 카드가 "결과 보기" 안내 한 줄로 대신 말한다. 없는 숫자를
 * 발명하거나 em dash 3줄을 그리는 것보다 정직하다.
 *
 * 지금 파생 가능한 것:
 *   · `documents`(interview_ingest) — 체인 프로젝트 문서 수
 *   · `artifact`  — 산출물 1건(단계가 done 이면 참)
 */
export function doneRowsOf(
  ctx: ChainStepContext,
  t: ChainTranslate,
  derived: ChainDerivedValues,
): { rows: ChainSummaryRow[]; omitted: number } {
  const meta = stepUiMeta(ctx.feature);
  if (!meta) return { rows: [], omitted: 0 };
  const rows: ChainSummaryRow[] = [];
  let omitted = 0;
  for (const id of meta.doneFields.slice(0, SUMMARY_MAX)) {
    const value = doneValue(id, derived, t, ctx.feature);
    if (value === null) {
      omitted += 1;
      continue;
    }
    rows.push({ id, label: t(`Chain.inspector.done.${ctx.feature}.${id}`), value });
  }
  return { rows, omitted };
}

function doneValue(
  id: string,
  derived: ChainDerivedValues,
  t: ChainTranslate,
  feature: ChainStepFeature,
): string | null {
  if (id === 'artifact') return t('Chain.card.done.artifact');
  if (id === 'documents' && derived.projectDocumentCount !== null) {
    return t(`Chain.inspector.value.${feature}.projectDocuments`, {
      n: derived.projectDocumentCount,
      known: 'yes',
      upstream: derived.upstreamStepNumber ?? 0,
    });
  }
  return null;
}

// ── 카드 표시 모델 (프레젠테이션이 그대로 그리는 값) ────────────────────

/** 푸터 오른쪽 액션 — CD §1.3 의 세 형태(주 버튼 · 링크 · 텍스트). */
export type ChainCardAction =
  /** ink pill 주 버튼 "설정하기" — 누르면 인스펙터. */
  | { kind: 'primary'; label: string }
  /** 링크 "결과 보기 ↗" — 누르면 기존 풀뷰(별도 타깃). */
  | { kind: 'link'; label: string }
  /** 텍스트 "편집" / "입력 보기" — **별도 타깃이 아니다**(§1.5). */
  | { kind: 'text'; label: string }
  | null;

/** 배지 — 모델 단계에서 이미 로케일 해석을 끝낸 형태. */
export type ChainCardBadgeView = {
  tone: ChainCardSignal;
  label: string;
  pulse: boolean;
};

export type ChainCardModel = {
  layout: ChainCardLayout;
  badge: ChainCardBadgeView;
  /** 1-based 단계 번호 표기("3단계"). */
  stepText: string;
  /** unset 본문 머리글 + 남은 필수 항목 레이블(최대 3). */
  needText: string | null;
  needs: readonly string[];
  /** ready/noconfig/done 본문의 행. running 은 2행으로 줄여 흐리게 그린다. */
  rows: readonly ChainSummaryRow[];
  /** 행 흐리기 — running 에서만 .55(CD §1.3). 잠금 표현이 아니다. */
  dimRows: boolean;
  /** "외 n개 설정" / "따로 설정할 것이 없어요" / 완료 안내. 없으면 null. */
  moreText: string | null;
  /** running 진행 바 0~100. 모르면 null → 바를 그리지 않는다. */
  progress: number | null;
  /** running "지금 하는 일" 한 줄. 모르면 null. */
  runText: string | null;
  /** 푸터 왼쪽 mono 문구. */
  footLeft: string;
  action: ChainCardAction;
};

export type ChainCardInput = {
  ctx: ChainStepContext;
  t: ChainTranslate;
  derived: ChainDerivedValues;
  /** 생성 시점 비용 스냅샷(크레딧). 0 = 무과금 → "포함". */
  cost: number;
  /** 실행 중 진척 0~100 (위젯 상태 채널). 모르면 null. */
  progress: number | null;
  /** 실행 중 "지금 하는 일" 한 줄 (위젯 상태 채널). 모르면 null. */
  runLabel: string | null;
  /** 완료 시각 표기(이미 포맷된 문자열). 모르면 null. */
  doneAt: string | null;
  /** 실패 사유 — error 노드의 안내 한 줄. */
  error?: string | null;
};

export function chainCardModel(input: ChainCardInput): ChainCardModel {
  const { ctx, t, derived } = input;
  const layout = cardLayoutOf(ctx);
  const raw = cardBadgeOf(ctx);
  const badge: ChainCardBadgeView = {
    tone: raw.tone,
    label: t(raw.labelKey),
    pulse: raw.pulse,
  };
  const stepText = t('Chain.card.stepNumber', { n: ctx.position + 1 });
  const costText =
    input.cost > 0
      ? t('Chain.card.costEstimate', { cost: input.cost })
      : t('Chain.costIncluded');

  if (layout === 'unset') {
    const missing = missingRequiredFields(ctx);
    return {
      layout,
      badge,
      stepText,
      needText: t('Chain.card.needCount', { n: missing.length }),
      needs: missing.slice(0, SUMMARY_MAX).map((f) => t(f.labelKey)),
      rows: [],
      dimRows: false,
      moreText: input.error ?? null,
      progress: null,
      runText: null,
      footLeft: costText,
      action: { kind: 'primary', label: t('Chain.card.action.configure') },
    };
  }

  if (layout === 'running') {
    return {
      layout,
      badge,
      stepText,
      needText: null,
      needs: [],
      // CD: 설정 요약을 2행으로 줄이고 흐리게.
      rows: summaryRowsOf(ctx, t, derived).slice(0, 2),
      dimRows: true,
      moreText: null,
      progress: input.progress,
      runText: input.runLabel,
      footLeft:
        input.progress === null
          ? costText
          : t('Chain.card.progressPercent', { pct: Math.round(input.progress) }),
      action: null,
    };
  }

  if (layout === 'done') {
    const { rows, omitted } = doneRowsOf(ctx, t, derived);
    return {
      layout,
      badge,
      stepText,
      needText: null,
      needs: [],
      rows,
      dimRows: false,
      // 값 출처가 아직 없는 행은 숫자를 발명하지 않고 안내 한 줄로 대신한다.
      moreText: omitted > 0 ? t('Chain.card.doneElsewhere') : null,
      progress: null,
      runText: null,
      footLeft: input.doneAt ?? costText,
      action: { kind: 'link', label: t('Chain.card.action.openResult') },
    };
  }

  // ready · noconfig — 본문은 같은 요약 행이고 "외 n개" 자리와 푸터만 다르다.
  const hidden = hiddenConfigCount(ctx);
  const noConfig = layout === 'noconfig';
  return {
    layout,
    badge,
    stepText,
    needText: null,
    needs: [],
    rows: summaryRowsOf(ctx, t, derived),
    dimRows: false,
    moreText: noConfig
      ? t('Chain.card.noConfigNote')
      : (input.error ?? (hidden > 0 ? t('Chain.card.moreCount', { n: hidden }) : null)),
    progress: null,
    runText: null,
    footLeft: costText,
    action: {
      kind: 'text',
      label: t(noConfig ? 'Chain.card.action.viewInput' : 'Chain.card.action.edit'),
    },
  };
}

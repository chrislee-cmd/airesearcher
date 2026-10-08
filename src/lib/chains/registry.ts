import type { FeatureKey } from '@/lib/features';
import { FEATURE_COSTS } from '@/lib/features';

// 위젯 연쇄 체인 — 호환 그래프 레지스트리 (코드 상수, DAG).
//
// 체인의 단계 정의는 **DB 가 아니라 코드**에 둔다 — 순환·무한 체인을 원천
// 차단하고, 단계/연결 추가를 PR 리뷰 게이트 아래 둔다(점검 보고서 §3).
// DB(widget_chains.steps)에는 검증을 통과한 시퀀스의 진행 상태만 영속한다.
//
// **자유 조합(A')**: 체인은 "시스템이 정한 파이프라인"이 아니다. 사용자가 빈
// 체인에 위젯을 드래그로 도킹해 **임의의 시퀀스**를 조립하고, 서버는 그 시퀀스가
// 호환 그래프 위의 경로인지만 검증한다. 고정 템플릿(interview_pipeline) +
// 진입점 suffix(startAt) 모델은 이 모델로 대체됐다 — 레거시 수용은
// legacyTemplateSteps 참고(하위호환 전용, 호출자 전환 후 삭제).
//
// ⚠️ **이 모듈은 클라이언트-안전하게 유지한다** — server-only(supabase admin ·
// env · node 내장)를 절대 import 하지 않는다. 이유: 호환 판정의 SSOT 가 모듈
// 하나여야 한다. 프론트(드롭 가드: "이 위젯을 여기 붙일 수 있나")와 서버
// (POST 권위 재검증)가 **같은 CHAIN_COMPAT_EDGES · validateSteps** 를 직접
// import 해서 쓴다. 판정을 API 로 노출하거나 프론트에 복제하면 두 판정이
// 갈라진다.

// 한 단계의 정적 메타. cost 는 여기 하드코딩하지 않는다 — featureKey 로
// FEATURE_COSTS 를 **표시 시점에** 조회한다(가격 SSOT 는 features.ts). topline
// 처럼 현재 무과금(FEATURE_COSTS 미등재) 단계는 featureKey=null → 비용 0/미표시.
// 가격 책정은 별도 트랙(pr-topline-usage-metering)에서 실측 후.
export type ChainStepDef = {
  // 단계 식별자(체인 내부 키). widget_chains.steps[].feature 에 저장되는 값.
  readonly key: string;
  // FEATURE_COSTS 조회 키. 무과금 단계(topline)는 null.
  readonly featureKey: FeatureKey | null;
};

// 체인의 노드 집합 — 체인 단계로 쓸 수 있는 위젯.
//
// 선언 순서 = 파일럿 파이프라인 순서. 이 순서는 **표시 순서로만** 쓴다
// (어드민 집계의 단계 행 정렬 — chain-observability). 조립 가능 여부는 순서가
// 아니라 아래 CHAIN_COMPAT_EDGES 가 결정한다.
//
// featureKey 매핑:
//   probing          → 'probing'      (25cr)
//   transcripts      → 'transcripts'  (1cr)
//   interview_ingest → 'interviews'   (10cr, 분석 선차감)
//   topline          → null           (현재 무과금)
export const CHAIN_STEPS = {
  probing: { key: 'probing', featureKey: 'probing' },
  transcripts: { key: 'transcripts', featureKey: 'transcripts' },
  interview_ingest: { key: 'interview_ingest', featureKey: 'interviews' },
  topline: { key: 'topline', featureKey: null },
} as const satisfies Record<string, ChainStepDef>;

export type ChainStepKey = keyof typeof CHAIN_STEPS;

// 선언 순서의 단계 key 목록(표시 순서 SSOT).
export const CHAIN_STEP_KEYS = Object.keys(CHAIN_STEPS) as ChainStepKey[];

export function isChainStepKey(v: unknown): v is ChainStepKey {
  return typeof v === 'string' && v in CHAIN_STEPS;
}

export type ChainCompatEdge = {
  readonly from: ChainStepKey;
  readonly to: ChainStepKey;
};

// ══════════════════════════════════════════════════════════════════════════
// 호환 그래프 — 연결 가능한 단계 쌍
// ══════════════════════════════════════════════════════════════════════════
// **불변식: 엣지 1개 = 인제스트 어댑터 1개.** 여기 있는 쌍은 "A 의 산출물을
// B 의 입력으로 서버가 실제로 넘길 수 있다"(C/#1326 의 어댑터가 실존한다)는
// 뜻이다. 어댑터 없이 엣지를 추가하면 체인이 그 지점에서 조용히 멈춘다 —
// **엣지 추가는 어댑터 구현과 동시에만** 한다.
//
// 현재 어댑터 대응:
//   probing → transcripts        = kickTranscriptFromProbingRecording (어댑터 1)
//   transcripts → interview_ingest = kickInterviewIngestFromTranscript (어댑터 2)
//   interview_ingest → topline   = kickTopline (advance.ts, 넘길 파일 없음)
//
// DAG 이므로(엣지가 선언 순서를 거스르지 않음) 사이클은 원천 불가. 따라서
// validateSteps 는 사이클 탐지를 하지 않는다 — 중복 금지만으로 충분하다.
//
// 진입 가능 단계도 그래프가 결정한다 — 나가는 엣지가 없는 단계(topline)는
// 길이 2+ 시퀀스의 첫 칸에 올 수 없으므로, 별도 entry 플래그가 필요 없다.
export const CHAIN_COMPAT_EDGES = [
  { from: 'probing', to: 'transcripts' },
  { from: 'transcripts', to: 'interview_ingest' },
  { from: 'interview_ingest', to: 'topline' },
] as const satisfies readonly ChainCompatEdge[];

/** from → to 쌍이 호환(어댑터 실존)인가. 프론트 드롭 가드가 그대로 쓴다. */
export function isCompatEdge(from: string, to: string): boolean {
  return CHAIN_COMPAT_EDGES.some((e) => e.from === from && e.to === to);
}

/** `from` 뒤에 붙일 수 있는 단계 목록 — UI 가 도킹 후보를 그릴 때. */
export function nextCompatSteps(from: string): ChainStepKey[] {
  return CHAIN_COMPAT_EDGES.filter((e) => e.from === from).map((e) => e.to);
}

// 단계의 표시 비용 — 표시 시점에 FEATURE_COSTS 에서 조회. featureKey 가 null
// (무과금)이거나 FEATURE_COSTS 에 없으면 0. 하드코딩 금지(가격 SSOT 유지).
export function stepCost(step: ChainStepDef): number {
  if (!step.featureKey) return 0;
  return FEATURE_COSTS[step.featureKey] ?? 0;
}

/** 단계 key 로 비용 조회 — 레지스트리에 없는 key 는 0. */
export function stepCostByKey(key: string): number {
  return isChainStepKey(key) ? stepCost(CHAIN_STEPS[key]) : 0;
}

// widget_chains.steps jsonb 에 저장되는 단계 인스턴스 shape.
export type ChainStepStatus =
  | 'pending'
  | 'awaiting_approval'
  | 'running'
  | 'done'
  | 'skipped'
  | 'error';

export type ChainStepInstance = {
  // 정적 레지스트리 단계 key(ChainStepDef.key).
  feature: string;
  status: ChainStepStatus;
  // 이 단계가 kick 한 위젯 job id. B(advance 훅)가 채운다. 초기 null.
  job_ref: string | null;
  // 생성 시점 비용 스냅샷(표시용). 가격이 나중에 바뀌어도 당시 고지값 보존.
  cost_at_creation: number;
  // 이 단계가 실패한 사유. 인제스트 어댑터(C)가 실패 즉시 기록한다 — 체인이
  // 조용히 멈춘 채 남는 "유령 전이"를 금지하기 위한 필드(#1319 교훈). 성공
  // 경로에서는 없거나 null. optional 이라 기존 steps jsonb(이 필드 없는 A 시절
  // 인스턴스)도 그대로 읽힌다.
  error?: string | null;
};

// ── 시퀀스 검증 ──────────────────────────────────────────────────────────

/**
 * 검증 실패 사유. 라우트가 그대로 400 body(`{error, detail}`)로 흘린다.
 *
 * **`error` 코드가 로컬라이즈 키**다 — UI 는 코드로 messages 를 조회해 자기
 * 로케일 문구를 그리고, `detail`(+ incompatible_steps 의 from/to)은 "어느 쌍이
 * 막혔는지" 를 채워 넣는 데이터로 쓴다. detail 자체의 한글 문구는 i18n 경로가
 * 아직 없는 동안의 기본값(로그·진단에도 그대로 남는다).
 */
export type ChainStepsError =
  | 'too_short'
  | 'unknown_step'
  | 'duplicate_step'
  | 'incompatible_steps';

export type ValidateStepsResult =
  | { ok: true; features: ChainStepKey[] }
  | {
      ok: false;
      error: ChainStepsError;
      detail: string;
      /** incompatible_steps 에서 막힌 쌍 — UI 가 detail 을 파싱하지 않고 자기
       *  로케일 문구를 조립할 수 있게 구조로도 넘긴다. */
      from?: string;
      to?: string;
    };

/**
 * 임의로 조립된 feature 시퀀스가 호환 그래프 위의 경로인지 검증한다.
 *
 * 규칙:
 *   1. 길이 2+ — 단계 1개는 체인이 아니라 그냥 위젯 사용이다.
 *   2. 모든 원소가 레지스트리 단계(CHAIN_STEPS)여야 한다.
 *   3. 같은 feature 중복 금지 — 같은 위젯을 두 번 거치는 체인은 어댑터가
 *      가리키는 앞 단계가 모호해지고(advance 의 prev 매칭), 그래프가 DAG 인
 *      한 유용한 경로도 아니다. 중복을 막으면 사이클도 원천 불가.
 *   4. 인접 쌍 전부가 compat edge — 즉 어댑터가 실존하는 연결.
 *
 * 하위호환: A 의 `interview_pipeline` suffix(= 이 그래프의 경로)는 전부 이
 * 검증을 자연 통과한다.
 */
export function validateSteps(features: readonly string[]): ValidateStepsResult {
  if (features.length < 2) {
    return {
      ok: false,
      error: 'too_short',
      // 로컬라이즈 키는 error 코드('too_short') — UI 가 코드로 조회한다.
      // i18n-allow-korean -- 검증 사유 기본 문구
      detail: '체인은 단계 2개 이상이 필요합니다',
    };
  }

  for (const f of features) {
    if (!isChainStepKey(f)) {
      return {
        ok: false,
        error: 'unknown_step',
        // i18n-allow-korean -- 검증 사유 기본 문구(키는 'unknown_step').
        detail: `${f} 은(는) 체인 단계가 아닙니다`,
      };
    }
  }
  const keys = features as readonly ChainStepKey[];

  const seen = new Set<string>();
  for (const f of keys) {
    if (seen.has(f)) {
      return {
        ok: false,
        error: 'duplicate_step',
        // i18n-allow-korean -- 검증 사유 기본 문구(키는 'duplicate_step').
        detail: `${f} 단계가 중복됩니다`,
      };
    }
    seen.add(f);
  }

  for (let i = 0; i < keys.length - 1; i += 1) {
    const from = keys[i];
    const to = keys[i + 1];
    if (!isCompatEdge(from, to)) {
      return {
        ok: false,
        error: 'incompatible_steps',
        // 스펙 지정 문구 — UI 가 드롭 거부 사유로 그대로 쓸 수 있는 형태.
        // i18n-allow-korean -- 검증 사유 기본 문구(키는 'incompatible_steps')
        detail: `${from}→${to} 어댑터 없음`,
        from,
        to,
      };
    }
  }

  return { ok: true, features: [...keys] };
}

// 검증을 통과한 시퀀스를 pending 단계 배열로 인스턴스화한다.
// 첫 단계만 즉시 러너블/승인대기로 두는 것은 호출부(라우트)의 몫 — 여기선
// 순수하게 pending 스냅샷만 만든다.
export function instantiateSteps(
  features: readonly ChainStepKey[],
): ChainStepInstance[] {
  return features.map((key) => ({
    feature: key,
    status: 'pending' as const,
    job_ref: null,
    cost_at_creation: stepCost(CHAIN_STEPS[key]),
  }));
}

// ── 레거시 하위호환 (호출자 전환 후 삭제) ────────────────────────────────

// A(#1323) 의 `{template, startAt}` 생성 body 를 feature 시퀀스로 환원하기 위한
// 고정 시퀀스. 자유 조합 모델에서는 템플릿이라는 개념이 없지만, v2 UI(#1329)가
// 홀드 중이라 호출자가 아직 이 body 를 보낸다 — **전환 완료 전 삭제 금지**.
// 변환 후에는 신규 경로와 완전히 동일한 validateSteps 를 통과해야 한다.
const LEGACY_TEMPLATE_SEQUENCES: Record<string, readonly ChainStepKey[]> = {
  interview_pipeline: [
    'probing',
    'transcripts',
    'interview_ingest',
    'topline',
  ],
};

export function isLegacyTemplateKey(v: unknown): boolean {
  return typeof v === 'string' && v in LEGACY_TEMPLATE_SEQUENCES;
}

/**
 * 레거시 `{template, startAt}` → feature 시퀀스. 템플릿 미등재 또는 startAt 이
 * 범위 밖이면 null(라우트가 A 와 동일한 400 코드로 응답).
 *
 * startAt 의 entry 플래그 검증은 사라졌다 — 그래프가 같은 일을 한다. suffix 가
 * 1단(topline 단독)이면 validateSteps 의 too_short 에 걸리므로, A 에서
 * entry:false 로 거부됐던 startAt=3 은 지금도 거부된다(코드만 다름 — 라우트가
 * 레거시 경로에서는 A 와 같은 invalid_start 로 매핑한다).
 */
export function legacyTemplateSteps(
  template: string,
  startAt: number,
): ChainStepKey[] | null {
  const seq = LEGACY_TEMPLATE_SEQUENCES[template];
  if (!seq) return null;
  if (!Number.isInteger(startAt) || startAt < 0 || startAt >= seq.length) {
    return null;
  }
  return seq.slice(startAt);
}

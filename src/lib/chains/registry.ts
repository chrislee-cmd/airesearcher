import type { FeatureKey } from '@/lib/features';
import { FEATURE_COSTS } from '@/lib/features';

// 위젯 연쇄 체인 — 정적 단계 레지스트리 (DAG, 코드 상수).
//
// 체인의 단계 정의는 **DB 가 아니라 코드**에 둔다 — 순환·무한 체인을 원천
// 차단하고, 단계 추가/변경을 PR 리뷰 게이트 아래 둔다(점검 보고서 §3).
// DB(widget_chains.steps)에는 이 템플릿을 인스턴스화한 진행 상태만 영속한다.
//
// 진입점 가변(점검 §2): 체인은 "고정 템플릿 실행"이 아니라 "템플릿의 임의
// suffix 에서 시작"할 수 있다. 전사록부터 진입하면 steps[1..]만 인스턴스화한다
// (instantiateSteps 의 startAt).

// 한 단계의 정적 메타. cost 는 여기 하드코딩하지 않는다 — featureKey 로
// FEATURE_COSTS 를 **표시 시점에** 조회한다(가격 SSOT 는 features.ts). topline
// 처럼 현재 무과금(FEATURE_COSTS 미등재) 단계는 featureKey=null → 비용 0/미표시.
// 가격 책정은 별도 트랙(pr-topline-usage-metering)에서 실측 후.
export type ChainStepDef = {
  // 단계 식별자(체인 내부 키). widget_chains.steps[].feature 에 저장되는 값.
  readonly key: string;
  // FEATURE_COSTS 조회 키. 무과금 단계(topline)는 null.
  readonly featureKey: FeatureKey | null;
  // 이 단계에서 체인을 시작할 수 있는가(가변 진입점 후보).
  readonly entry: boolean;
};

export type ChainTemplate = {
  readonly key: string;
  readonly steps: readonly ChainStepDef[];
};

// 파일럿 체인: 인터뷰 파이프라인.
//   probing(인터뷰 어시스턴트) → transcripts(스크립트 생성) →
//   interview_ingest(인터뷰 분석·인덱싱) → topline(탑라인 보고서)
//
// featureKey 매핑:
//   probing          → 'probing'      (25cr)
//   transcripts      → 'transcripts'  (1cr)
//   interview_ingest → 'interviews'   (10cr, 분석 선차감)
//   topline          → null           (현재 무과금)
export const CHAIN_TEMPLATES = {
  interview_pipeline: {
    key: 'interview_pipeline',
    steps: [
      { key: 'probing', featureKey: 'probing', entry: true },
      { key: 'transcripts', featureKey: 'transcripts', entry: true },
      { key: 'interview_ingest', featureKey: 'interviews', entry: true },
      { key: 'topline', featureKey: null, entry: false },
    ],
  },
} as const satisfies Record<string, ChainTemplate>;

export type ChainTemplateKey = keyof typeof CHAIN_TEMPLATES;

export function isChainTemplateKey(v: unknown): v is ChainTemplateKey {
  return typeof v === 'string' && v in CHAIN_TEMPLATES;
}

export function getTemplate(key: ChainTemplateKey): ChainTemplate {
  return CHAIN_TEMPLATES[key];
}

// 단계의 표시 비용 — 표시 시점에 FEATURE_COSTS 에서 조회. featureKey 가 null
// (무과금)이거나 FEATURE_COSTS 에 없으면 0. 하드코딩 금지(가격 SSOT 유지).
export function stepCost(step: ChainStepDef): number {
  if (!step.featureKey) return 0;
  return FEATURE_COSTS[step.featureKey] ?? 0;
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

// 템플릿을 인스턴스화 — startAt 인덱스부터의 suffix 를 pending 단계 배열로.
// 진입점 가변: startAt=1 이면 전사록부터, steps[1..]만 인스턴스화된다.
// 첫 단계(인덱스 startAt)만 즉시 러너블하게 두는 것은 호출부(라우트)의 몫 —
// 여기선 순수하게 pending 스냅샷만 만든다.
export function instantiateSteps(
  templateKey: ChainTemplateKey,
  startAt: number,
): ChainStepInstance[] {
  const tmpl = CHAIN_TEMPLATES[templateKey];
  const start = Math.max(0, Math.min(startAt, tmpl.steps.length - 1));
  return tmpl.steps.slice(start).map((def) => ({
    feature: def.key,
    status: 'pending' as const,
    job_ref: null,
    cost_at_creation: stepCost(def),
  }));
}

// 가변 진입점 검증 — startAt 인덱스가 범위 내이고 entry 가능 단계인지.
export function isValidStartAt(
  templateKey: ChainTemplateKey,
  startAt: number,
): boolean {
  const tmpl = CHAIN_TEMPLATES[templateKey];
  if (!Number.isInteger(startAt) || startAt < 0 || startAt >= tmpl.steps.length) {
    return false;
  }
  return tmpl.steps[startAt].entry;
}

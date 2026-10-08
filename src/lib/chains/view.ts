/* ────────────────────────────────────────────────────────────────────
   위젯 체인 — 프레젠테이션 뷰 모델 (ChainView).

   계약 SSOT = `design-handoff/widget-chain/CONTEXT-FOR-CD.md §3` +
   `WRITER-ANSWERS.md`(fileCount?·creditBalance? 채택, cancelled→skipped 표시
   매핑 승인). 서버 row(`widget_chains`)는 **실행 상태**를, 이 모듈이 만드는
   ChainView 는 **표시 상태**를 담는다 — 둘은 1:1 이 아니다:

     · steps[].status 'awaiting_approval' → 뷰 'awaiting' (CD 명명)
     · status 'paused_insufficient_credits' → steps[currentStep] 을 뷰 전용
       'paused' 로 (계약에 없는 표시 상태 — BUILD-SPEC §1.3 각주)
     · 종결 체인(cancelled/done/error)의 **비종결 단계를 반드시 종결 표시로
       접는다** — BUILD-SPEC §3 "유령 상태 금지"의 데이터측 절반이다. 서버는
       cancel 시 남은 단계를 pending 으로 남기고(WRITER-ANSWERS §4), done 시
       마지막 단계를 running 으로 남긴다(advance.ts isLast 분기). 그대로 그리면
       멈춘 체인에 processing 링·펄스가 뜬다. 매핑은 **표시만** — 서버 상태는
       불변이다.

   순수 모듈(페칭·구독 0) — 서버 라우트와 클라 컨테이너가 같이 쓴다.
   ──────────────────────────────────────────────────────────────────── */

import {
  CHAIN_TEMPLATES,
  stepCost,
  type ChainStepInstance,
  type ChainTemplateKey,
} from './registry';
import type { ChainRow, ChainStatus } from './state';

// 파일럿 체인의 단계 key. 레지스트리(interview_pipeline)의 steps[].key 와 1:1.
export type ChainStepFeature =
  | 'probing'
  | 'transcripts'
  | 'interview_ingest'
  | 'topline';

// 트랙 노드 상태 6종 + 표시 전용 'paused' (BUILD-SPEC §1.3).
export type ChainNodeStatus =
  | 'pending'
  | 'running'
  | 'awaiting'
  | 'done'
  | 'skipped'
  | 'error'
  | 'paused';

export type ChainStepView = {
  feature: ChainStepFeature;
  status: ChainNodeStatus;
  /** 생성 시점 비용 스냅샷(크레딧). 0 = "포함"(금액 미표시 — BUILD-SPEC §3). */
  cost: number;
  /** 실패 사유 — B6 메시지의 강조 구(msgB). */
  error?: string | null;
  /**
   * 이 단계가 처리하는 파일 수(WRITER-ANSWERS §1 — 옵셔널). 어댑터가 kick
   * 시점에 기록하면 "💎75 (파일 3 × 25)" 분해 표시에 쓰인다. 현재 어댑터(C)는
   * 기록하지 않으므로 항상 undefined → 프레젠테이션은 cost 합계 폴백.
   */
  fileCount?: number;
};

export type ChainView = {
  id: string;
  mode: 'approve' | 'auto';
  status: ChainStatus;
  steps: ChainStepView[];
  currentStep: number;
  /** null 이면 프로젝트 선택 필요(B3). */
  projectId: string | null;
  /** 잔액(WRITER-ANSWERS §2). null = 미조회 → B5 의 "잔액 💎N" 구절 생략. */
  creditBalance?: number | null;
};

// 단계를 맡은 위젯의 헤더 톤 — 트랙 노드 채움(BUILD-SPEC §1.2). 실제 위젯
// accent 와 동일: probing=sky · quotes(전사록)=lav · interviews=rose.
export const CHAIN_STEP_TONE: Record<ChainStepFeature, 'sky' | 'lav' | 'rose'> =
  {
    probing: 'sky',
    transcripts: 'lav',
    interview_ingest: 'rose',
    topline: 'rose',
  };

// 단계 → 그 단계를 수행/표시하는 canvas 위젯 key. B6 "{위젯} 열기" · B8
// "보고서 열기" 가 여는 fullview 대상이고, 카드 칩이 어느 카드에 붙는지도 이
// 매핑이 결정한다. 탑라인은 전용 위젯이 숨김(CANVAS_VISIBILITY=false)이고 CD
// B8 이 "인터뷰 결과 생성기 전체보기에서 엽니다" 라 interviews 로 보낸다.
export const CHAIN_STEP_WIDGET_KEY: Record<ChainStepFeature, string> = {
  probing: 'probing',
  transcripts: 'quotes',
  interview_ingest: 'interviews',
  topline: 'interviews',
};

const FEATURES = new Set<string>(Object.keys(CHAIN_STEP_TONE));

export function isChainStepFeature(v: string): v is ChainStepFeature {
  return FEATURES.has(v);
}

/** 종결(더 이상 움직이지 않는) 노드 상태. */
function isTerminalNode(status: ChainNodeStatus): boolean {
  return status === 'done' || status === 'skipped' || status === 'error';
}

function nodeStatusOf(step: ChainStepInstance): ChainNodeStatus {
  return step.status === 'awaiting_approval' ? 'awaiting' : step.status;
}

/**
 * 서버 row → 프레젠테이션 ChainView. 알 수 없는 단계 key 는 버린다(레지스트리
 * 와 어긋난 레거시 row 가 빈 노드로 그려지는 것보다 낫다).
 */
export function toChainView(
  row: ChainRow,
  creditBalance?: number | null,
): ChainView {
  const steps: ChainStepView[] = row.steps
    .filter((s) => isChainStepFeature(s.feature))
    .map((s) => ({
      feature: s.feature as ChainStepFeature,
      status: nodeStatusOf(s),
      cost: s.cost_at_creation ?? 0,
      error: s.error ?? null,
      fileCount:
        typeof (s as { file_count?: unknown }).file_count === 'number'
          ? ((s as { file_count?: number }).file_count as number)
          : undefined,
    }));

  const cursor = Math.max(0, Math.min(row.current_step, steps.length - 1));

  // ── 종결/멈춤 접기 (유령 상태 금지) ───────────────────────────────────
  if (row.status === 'cancelled') {
    // 남은 pending·awaiting·running 전부 skipped 표시(WRITER-ANSWERS §4).
    for (const s of steps) {
      if (!isTerminalNode(s.status)) s.status = 'skipped';
    }
  } else if (row.status === 'done') {
    // 마지막 단계를 running 으로 남긴 채 체인만 done 으로 닫는 경로가 있다
    // (advance.ts isLast). 완료 바에 펄스가 남지 않게 접는다.
    for (const s of steps) {
      if (!isTerminalNode(s.status)) s.status = 'done';
    }
  } else if (row.status === 'error') {
    // 실패 단계는 어댑터가 error 로 마킹하지만, kick 예외 경로에서 단계가
    // running 으로 남을 수 있다 — 커서 단계를 error 로 못박고 사유는
    // error_message 로 폴백한다.
    const cur = steps[cursor];
    if (cur && cur.status !== 'error') {
      cur.status = 'error';
      cur.error = cur.error ?? row.error_message;
    }
    for (const s of steps) {
      if (s.status === 'running' || s.status === 'awaiting') s.status = 'error';
    }
  } else if (row.status === 'paused_insufficient_credits') {
    // 멈춤은 커서 단계에만. 대기(amber 점선)와 선종으로 가린다(§1.3).
    const cur = steps[cursor];
    if (cur && !isTerminalNode(cur.status)) cur.status = 'paused';
  }

  return {
    id: row.id,
    mode: row.mode,
    status: row.status,
    steps,
    currentStep: cursor,
    projectId: row.project_id,
    creditBalance: creditBalance ?? null,
  };
}

/** 완료(done) 단계 수 — 상태 텍스트 "N/M 완료". */
export function doneCount(view: ChainView): number {
  return view.steps.filter((s) => s.status === 'done').length;
}

/** 마지막으로 완료된 단계 — B9 "{전사}까지의 결과". */
export function lastDoneStep(view: ChainView): ChainStepView | null {
  for (let i = view.steps.length - 1; i >= 0; i -= 1) {
    if (view.steps[i].status === 'done') return view.steps[i];
  }
  return null;
}

/** 다음 단계(승인 대상 뒤) — 진행 버튼 비용은 **현재(승인 대기) 단계**의 비용. */
export function currentStepOf(view: ChainView): ChainStepView | null {
  return view.steps[view.currentStep] ?? null;
}

// ── 진입점 미리보기 (BUILD-SPEC §1.5) ──────────────────────────────────────

export type ChainPreviewRow = {
  feature: ChainStepFeature;
  cost: number;
  /** 템플릿 기준 1-based 단계 번호(진입 단계를 빼고 보여줘도 번호는 보존). */
  index: number;
  /** 체인 시작 전 이미 차감된 진입 단계 — 합계 제외. */
  entryStep: boolean;
};

/**
 * 진입점 블록의 미리보기 행 — 템플릿 suffix(startAt..) 를 그대로 나열한다.
 * 비용은 레지스트리(FEATURE_COSTS)에서 읽어 가격 SSOT 를 유지한다(하드코딩 0).
 */
export function chainPreviewRows(
  template: ChainTemplateKey,
  startAt: number,
): ChainPreviewRow[] {
  const defs = CHAIN_TEMPLATES[template].steps;
  const start = Math.max(0, Math.min(startAt, defs.length - 1));
  return defs.slice(start).flatMap((def, i) =>
    isChainStepFeature(def.key)
      ? [
          {
            feature: def.key,
            cost: stepCost(def),
            index: start + i + 1,
            entryStep: i === 0,
          },
        ]
      : [],
  );
}

// ── v2 커넥터 오버레이 파생 (README v2 "State Management") ────────────────
//
// v2 는 상태를 **엣지**가 말한다. 엣지 i 는 steps[i] → steps[i+1] 을 잇고, 종류는
// 두 단계 status + 체인 status 조합으로 정해진다. 이 함수가 그 규칙의 SSOT 이고,
// 프레젠테이션은 결과 배열만 받는다.

export type ChainEdgeKind =
  | 'done'
  | 'running'
  | 'awaiting'
  | 'paused'
  | 'error'
  | 'pending'
  /** 진입 팝오버가 열려 있는 동안의 미리보기(아직 체인 없음). */
  | 'ghost';

export function deriveEdgeKinds(view: ChainView): ChainEdgeKind[] {
  const out: ChainEdgeKind[] = [];
  for (let i = 0; i < view.steps.length - 1; i += 1) {
    const a = view.steps[i];
    const b = view.steps[i + 1];
    out.push(edgeKind(view, i, a, b));
  }
  return out;
}

function edgeKind(
  view: ChainView,
  i: number,
  a: ChainStepView,
  b: ChainStepView,
): ChainEdgeKind {
  // 종료된 체인은 "끝까지 간 구간"만 검정 실선으로 남기고 나머지는 전부 회색
  // 점선이다 — 색이 있는 요소 0 (S7).
  if (view.status === 'cancelled') {
    return a.status === 'done' && b.status === 'done' ? 'done' : 'pending';
  }
  // 실패는 그 단계에서 **나가는** 엣지를 끊는다(멈춤과 반대 — R2).
  if (a.status === 'error') return 'error';
  // 멈춤은 그 단계로 **들어가는** 엣지를 끊는다.
  if (
    view.status === 'paused_insufficient_credits' &&
    i + 1 === view.currentStep
  ) {
    return 'paused';
  }
  if (b.status === 'awaiting') return 'awaiting';
  if (a.status === 'done' && b.status === 'running') return 'running';
  if (a.status === 'done' && b.status === 'done') return 'done';
  // 실패 단계로 **들어가는** 엣지는 done 이다 — 그 단계에 도달하는 데는 성공했고,
  // 끊기는 것은 나가는 쪽이기 때문(S5 비교 기준).
  if (a.status === 'done' && b.status === 'error') return 'done';
  return 'pending';
}

/** 캡슐이 붙을 엣지 index. 붙을 자리가 없으면 null(진행 중 = 캡슐 없음). */
export function capsuleEdgeIndex(view: ChainView): number | null {
  const last = view.steps.length - 2;
  if (last < 0) return null;
  switch (view.status) {
    case 'awaiting_approval':
    case 'paused_insufficient_credits':
      // currentStep 으로 **들어가는** 엣지.
      return view.currentStep - 1 >= 0 ? view.currentStep - 1 : null;
    case 'error':
      // 실패 단계에서 **나가는** 엣지.
      return Math.min(view.currentStep, last);
    case 'done':
      return last;
    case 'cancelled': {
      // 마지막 done 다음 엣지.
      let lastDone = -1;
      view.steps.forEach((s, i) => {
        if (s.status === 'done') lastDone = i;
      });
      return lastDone >= 0 ? Math.min(lastDone, last) : null;
    }
    default:
      return null;
  }
}

/** running 상태 라벨이 붙을 엣지 index(없으면 null). */
export function runningEdgeIndex(kinds: ChainEdgeKind[]): number | null {
  const i = kinds.indexOf('running');
  return i === -1 ? null : i;
}

/**
 * 마지막 엣지가 산출물 노드로 들어가는가 — 마지막 두 단계를 같은 위젯이 맡으면
 * 카드가 하나라 카드→카드 엣지가 성립하지 않는다(인터뷰 분석 + 탑라인).
 */
export function lastEdgeTargetsReport(view: ChainView): boolean {
  const n = view.steps.length;
  if (n < 2) return false;
  return (
    CHAIN_STEP_WIDGET_KEY[view.steps[n - 1].feature] ===
    CHAIN_STEP_WIDGET_KEY[view.steps[n - 2].feature]
  );
}

/** 체인이 화면에 흔적을 남기는 상태인가(포트·엣지·칩 렌더 여부). */
export function isChainVisible(view: ChainView | null): view is ChainView {
  return !!view && view.steps.length > 1;
}

/* ────────────────────────────────────────────────────────────────────
   팔레트 — 위치(location) 모델 + 둘째 줄 우선순위.

   CD SSOT: `canvas-modular/full/README.md` §6(누르기와 복수 실행) · 장면 P5
   ①②③. 순수 모듈(React·페칭 0) — 타일/작업 목록/누르기 분기가 같이 쓴다.

   ── 위치란 ─────────────────────────────────────────────────────────────
   한 위젯의 **위치** = 그 위젯이 지금 일을 갖고 있는 곳. Phase 1 에서는 두
   종류뿐이다(§6 · P5 ①):
     · 레인 카드 — 체인에 들어 있으면 1개. 체인이 대기여도 위치다.
     · 풀뷰 실행 — 체인 밖에서 시작해 **아직 끝나지 않은** 실행.
   완료된 실행은 위치가 아니다(라이브러리 소관). 그래서 "누르기" 분기의
   기준이 되는 개수 = 끝나지 않은 일의 개수다.

   ── 왜 순수 함수인가 ───────────────────────────────────────────────────
   누르기 규칙(0 → 새 풀뷰 · 1 → 그 위치로 · 2+ → 작업 목록)은 **개수 하나**로
   갈린다. 그 계산이 컴포넌트 안에 흩어지면 타일 둘째 줄과 누르기 분기가 서로
   다른 개수를 보는 순간이 생긴다(= 목록이 안 펼쳐지는데 "2건" 이라고 적혀
   있는 상태). 한 곳에서 만들어 내려보낸다.
   ──────────────────────────────────────────────────────────────────── */

import type { WidgetStateInfo } from '../widget-types';
import type { ChainNodeStatus, ChainView } from '@/lib/chains/view';

/** 위치의 종류 — 레인 카드인가, 체인 밖 풀뷰 실행인가. */
export type LocationKind = 'lane' | 'fullview';

/**
 * 위치의 상태 — P5 ③ 우선순위의 정렬 키이기도 하다.
 * `pending` 은 "체인에 있지만 아직 차례가 아님"(대기).
 */
export type LocationStatus =
  | 'error'
  | 'paused'
  | 'awaiting'
  | 'running'
  | 'pending'
  | 'done';

/** P5 ③ 둘째 줄 우선순위: 실패 > 멈춤 > 승인 대기 > 진행 중 > 대기 > 완료. */
const STATUS_RANK: Record<LocationStatus, number> = {
  error: 0,
  paused: 1,
  awaiting: 2,
  running: 3,
  pending: 4,
  done: 5,
};

/** 상태 → 시그널 토큰 계열. 배지 색·점 색이 이 하나에서 나온다. */
export type SignalTone = 'ok' | 'run' | 'warn' | 'err' | 'idle';

const STATUS_TONE: Record<LocationStatus, SignalTone> = {
  error: 'err',
  paused: 'warn',
  awaiting: 'warn',
  running: 'run',
  pending: 'idle',
  done: 'ok',
};

export function toneOf(status: LocationStatus): SignalTone {
  return STATUS_TONE[status];
}

/** 깜빡임은 **진행 중에만**. 실패·멈춤·대기에 깜빡임 0 (§11 Done-when). */
export function pulsesFor(status: LocationStatus): boolean {
  return status === 'running';
}

export type WidgetLocation = {
  /** 작업 목록 행의 key. 레인은 단계 key, 풀뷰는 'fullview'. */
  id: string;
  kind: LocationKind;
  status: LocationStatus;
  /** 레인 위치의 1-based 단계 번호. 풀뷰면 null. */
  step: number | null;
  /** 레인 위치의 전체 단계 수. 풀뷰면 null. */
  totalSteps: number | null;
  /**
   * 상태 뒤에 붙는 짧은 사유/진척 (§4.2 attn "상태 한 단어 + 사유 6자 이내").
   * 없으면 null — 문구를 발명하지 않는다.
   */
  detail: string | null;
};

/** 서버 단계 어휘(뷰) → 위치 상태. `skipped` 는 끝난 것이라 done 으로 접는다. */
function laneStatusOf(node: ChainNodeStatus): LocationStatus {
  switch (node) {
    case 'running':
      return 'running';
    case 'awaiting':
      return 'awaiting';
    case 'paused':
      return 'paused';
    case 'error':
      return 'error';
    case 'done':
    case 'skipped':
      return 'done';
    case 'pending':
    default:
      return 'pending';
  }
}

/**
 * 위젯 하나의 위치 목록 — 레인 + 체인 밖 풀뷰 실행.
 *
 * `dockedStep` 은 이 위젯이 맡은 **단계 key**(레인에 없으면 null). 레인 카드
 * 상태는 **서버 체인 행의 투영**(`ChainView`)에서 읽는다 — 레인은 그 투영이고
 * 상태를 클라가 따로 들고 있으면 새로고침에 사라진다(LEARNINGS §9).
 *
 * 체인 밖 실행은 `WidgetStateInfo`(위젯 셸 ↔ 본문 채널)에서 읽는다. 현재 그
 * 채널의 어휘는 idle/running/done/error 뿐이라 **awaiting·paused 풀뷰 실행은
 * 오늘 도달 불가**다 — 모델은 받아 두되(레인이 쓴다) 없는 상태를 발명하지
 * 않는다.
 */
export function locationsOf(params: {
  view: ChainView | null;
  dockedStep: string | null;
  widgetState: WidgetStateInfo;
}): WidgetLocation[] {
  const { view, dockedStep, widgetState } = params;
  const out: WidgetLocation[] = [];

  if (dockedStep) {
    const idx = view
      ? view.steps.findIndex((s) => s.feature === dockedStep)
      : -1;
    const node = idx >= 0 ? view!.steps[idx] : null;
    out.push({
      id: dockedStep,
      kind: 'lane',
      status: node ? laneStatusOf(node.status) : 'pending',
      step: idx >= 0 ? idx + 1 : null,
      totalSteps: view ? view.steps.length : null,
      detail: node?.error ?? null,
    });
  }

  if (widgetState.kind === 'running') {
    out.push({
      id: 'fullview',
      kind: 'fullview',
      status: 'running',
      step: null,
      totalSteps: null,
      detail: widgetState.label ?? progressLabel(widgetState),
    });
  } else if (widgetState.kind === 'error') {
    out.push({
      id: 'fullview',
      kind: 'fullview',
      status: 'error',
      step: null,
      totalSteps: null,
      detail: widgetState.message ?? null,
    });
  }

  return out.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
}

function progressLabel(state: WidgetStateInfo): string | null {
  if (state.kind !== 'running') return null;
  const raw =
    typeof state.overallProgress === 'number'
      ? state.overallProgress
      : typeof state.progress === 'number'
        ? state.progress
        : null;
  if (raw === null) return null;
  return `${Math.max(0, Math.min(100, Math.round(raw)))}%`;
}

/** 우선순위 1위 위치 — 둘째 줄 문구·접힘 상태 점의 색이 여기서 나온다. */
export function leadLocation(
  locations: readonly WidgetLocation[],
): WidgetLocation | null {
  return locations[0] ?? null;
}

/**
 * 타일 시각 상태 (§4.2 상태 사전 12종).
 *
 * `idle`/`hover`/`focus`/`press`/`fit`/`source`/`lifted` 는 **포인터·키보드
 * 상호작용**이 정하고, `chain`/`run`/`attn`/`multi`/`expanded` 는 **위치**가
 * 정한다. 둘이 겹칠 때는 상호작용이 이긴다 — 손이 닿아 있는 동안의 피드백이
 * 상태 표시보다 급하기 때문이다(hover 가 chain 배지를 지우지는 않는다: 배지는
 * 둘째 줄이고 hover 는 바탕이라 층이 다르다).
 */
export type TileVisualState =
  | 'idle'
  | 'fit'
  | 'source'
  | 'lifted'
  | 'chain'
  | 'run'
  | 'attn'
  | 'multi'
  | 'expanded';

export function tileVisualState(params: {
  dragging: boolean;
  lifted: boolean;
  fit: boolean;
  expanded: boolean;
  locations: readonly WidgetLocation[];
  inLane: boolean;
}): TileVisualState {
  const { dragging, lifted, fit, expanded, locations, inLane } = params;
  if (dragging) return 'source';
  if (lifted) return 'lifted';
  if (expanded) return 'expanded';
  if (locations.length >= 2) return 'multi';
  if (inLane) return 'chain';
  const lead = locations[0];
  if (lead) return lead.status === 'running' ? 'run' : 'attn';
  if (fit) return 'fit';
  return 'idle';
}

/** 체인 소속 타일은 끌 수 없다 (§4.2 chain — "그립 없음 = 끌 수 없음"). */
export function isDraggable(inLane: boolean): boolean {
  return !inLane;
}

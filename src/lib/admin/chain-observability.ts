import { createAdminClient } from '@/lib/supabase/admin';
import { CHAIN_STEP_KEYS } from '@/lib/chains/registry';
import type { ChainStepInstance, ChainStepStatus } from '@/lib/chains/registry';
import type { ChainStatus } from '@/lib/chains/state';
import {
  getCronHeartbeats,
  type CronHeartbeat,
} from '@/lib/observability/cron-heartbeat';

// 위젯 체인 관측 집계 — 어드민 현황 리포트 (PR-E, 측정 전용).
//
// 설계 원칙(topline-metering.ts §범위 미러): **집계 뷰·SQL 집계 함수를 쓰지
// 않는다.** widget_chains raw 행을 그대로 당겨와 JS 에서 센다. 그래서 "어드민
// 카드 수치 = raw 행 수계산" 이 정의상 일치한다(단일 계산 경로). 체인 파일럿의
// 평가 데이터(완주율·skip 률)가 이 카드의 주 용도라, 수치의 출처가 한 군데로
// 묶여 있어야 판단을 그 위에 올릴 수 있다.
//
// 윈도우: 최근 N일(기본 30) 안에 **생성(created_at)** 된 체인. 완주율의 분모를
// "그 기간에 시작된 체인" 으로 두는 쪽이 파일럿 해석에 맞다 — 종결 시각 기준으로
// 자르면 기간 끝에 걸친 진행 중 체인이 분모에서 빠져 완주율이 과대평가된다.
//
// 교차 org 전수(super-admin 페이지에서만 호출 — service-role).

const DEFAULT_WINDOW_DAYS = 30;

// 체인 status 전체 축 — DB check 제약(20261007020208_widget_chains.sql)과 동일
// 순서/집합. 분포 카드가 0건 상태도 한 칸씩 보여 주려면 목록이 필요하다.
export const CHAIN_STATUSES: readonly ChainStatus[] = [
  'running',
  'awaiting_approval',
  'paused_insufficient_credits',
  'done',
  'error',
  'cancelled',
];

// 종결 상태 — 완주율의 분모. 진행 중 체인은 아직 성패가 결정되지 않았으므로
// 분모에서 빼야 한다(widgetHealth 의 errorRate 가 terminal 만 세는 것과 동일
// 컨벤션). cancelled 를 분모에 남기는 이유: 사용자가 도중에 접은 것도 "완주
// 못 한" 결과라 파일럿 평가에선 유의미한 실패 축이다.
const TERMINAL: readonly ChainStatus[] = ['done', 'error', 'cancelled'];

export type ChainStepStat = {
  /** 레지스트리 단계 key(ChainStepDef.key) — steps[].feature 에 저장된 값. */
  key: string;
  /** 이 단계를 품은 체인 인스턴스 수(가변 진입점이라 단계별로 다르다). */
  instances: number;
  skipped: number;
  done: number;
  error: number;
  /** skipped / instances. instances 0 이면 null(비율 없음). */
  skipRate: number | null;
};

export type ChainObservabilityReport = {
  windowDays: number;
  /** 윈도우 안에 생성된 체인 총수. 0 이면 카드가 empty-state 를 그린다. */
  total: number;
  byMode: { approve: number; auto: number };
  byStatus: Record<ChainStatus, number>;
  /** 완주율 — done / (done+error+cancelled). 종결 체인이 없으면 null. */
  completion: { done: number; terminal: number; rate: number } | null;
  steps: ChainStepStat[];
  /** cron 생존 신호 — "마지막 sweep 실행" + STALE 판정. */
  heartbeats: CronHeartbeat[];
  generatedAt: string;
};

// 조회 상한 — raw 행을 JS 로 세는 구조라 상한이 필요하다. 파일럿 규모(월 수십~
// 수백 체인)의 수십 배 여유. 상한을 넘기면 집계가 최신순으로 잘리므로, 그 규모가
// 되면 SQL 집계로 옮긴다(그때는 단일 계산 경로를 깨지 않게 뷰 1개로).
const QUERY_LIMIT = 20000;

// 레지스트리 선언 순서대로의 단계 key 목록 — 카드의 단계 행 순서가 파이프라인
// 순서와 같아야 "어디서 끊기는지" 가 눈에 읽힌다.
//
// 자유 조합(A')로 바뀐 뒤에도 **표시 순서는 레지스트리 선언 순서**다. 체인마다
// 실제 시퀀스가 다르므로(사용자가 조립) "모든 체인에 공통인 순서" 는 존재하지
// 않는다 — 집계 카드는 단계별 합을 보는 뷰이므로 선언 순서면 충분하고,
// 미등재 key(과거 인스턴스·오타)는 호출측이 뒤로 보낸다.
function registryStepOrder(): string[] {
  return [...CHAIN_STEP_KEYS];
}

function emptyByStatus(): Record<ChainStatus, number> {
  return {
    running: 0,
    awaiting_approval: 0,
    paused_insufficient_credits: 0,
    done: 0,
    error: 0,
    cancelled: 0,
  };
}

type ChainAggRow = {
  mode: string | null;
  status: string | null;
  steps: ChainStepInstance[] | null;
};

export async function getChainObservabilityReport(
  windowDays = DEFAULT_WINDOW_DAYS,
): Promise<ChainObservabilityReport> {
  const admin = createAdminClient();
  const since = new Date(
    Date.now() - windowDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  // 생존 신호는 집계와 독립적으로 유효하다 — 체인이 0건이어도 "cron 이 도는가"
  // 는 여전히 봐야 하는 질문이므로, 집계 쿼리가 실패해도 이쪽은 따로 읽는다.
  const heartbeats = await getCronHeartbeats(admin);

  const empty = (): ChainObservabilityReport => ({
    windowDays,
    total: 0,
    byMode: { approve: 0, auto: 0 },
    byStatus: emptyByStatus(),
    completion: null,
    steps: [],
    heartbeats,
    generatedAt: new Date().toISOString(),
  });

  const { data, error } = await admin
    .from('widget_chains')
    .select('mode, status, steps')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(QUERY_LIMIT);
  if (error) {
    // 어드민 대시보드는 degrade 우선 — 마이그 미적용/쿼리 실패 시 500 대신 빈
    // 리포트(생존 신호는 살려 둔다).
    console.warn('[admin/chain-observability] query failed', error.message);
    return empty();
  }

  const rows = (data ?? []) as ChainAggRow[];
  if (rows.length === 0) return empty();

  const byStatus = emptyByStatus();
  const byMode = { approve: 0, auto: 0 };
  // 단계 key -> 상태별 카운트. 레지스트리에 없는 key(과거 인스턴스·오타)도 빠뜨리지
  // 않고 담아 두고, 출력 순서만 레지스트리 우선으로 정렬한다.
  const stepCounts = new Map<string, { instances: number } & Record<ChainStepStatus, number>>();

  for (const row of rows) {
    const status = row.status as ChainStatus | null;
    if (status && status in byStatus) byStatus[status] += 1;
    if (row.mode === 'auto') byMode.auto += 1;
    else if (row.mode === 'approve') byMode.approve += 1;

    for (const step of row.steps ?? []) {
      if (!step || typeof step.feature !== 'string') continue;
      let bucket = stepCounts.get(step.feature);
      if (!bucket) {
        bucket = {
          instances: 0,
          pending: 0,
          awaiting_approval: 0,
          running: 0,
          done: 0,
          skipped: 0,
          error: 0,
        };
        stepCounts.set(step.feature, bucket);
      }
      bucket.instances += 1;
      if (step.status && step.status in bucket) bucket[step.status] += 1;
    }
  }

  const order = registryStepOrder();
  const steps: ChainStepStat[] = [...stepCounts.entries()]
    .sort((a, b) => {
      // 레지스트리 순서 우선, 미등재 key 는 뒤로(그 안에서는 key 사전순).
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a[0].localeCompare(b[0]);
    })
    .map(([key, c]) => ({
      key,
      instances: c.instances,
      skipped: c.skipped,
      done: c.done,
      error: c.error,
      skipRate: c.instances > 0 ? c.skipped / c.instances : null,
    }));

  const terminal = TERMINAL.reduce((sum, s) => sum + byStatus[s], 0);

  return {
    windowDays,
    total: rows.length,
    byMode,
    byStatus,
    completion:
      terminal > 0
        ? { done: byStatus.done, terminal, rate: byStatus.done / terminal }
        : null,
    steps,
    heartbeats,
    generatedAt: new Date().toISOString(),
  };
}

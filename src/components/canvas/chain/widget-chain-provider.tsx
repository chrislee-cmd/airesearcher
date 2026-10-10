'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetChainProvider — 체인 UI 의 **컨테이너** (데이터 전부).

   프레젠테이션(v3 도킹 레인)은 전부 typed props 와 콜백만 받는다 —
   페칭·구독·액션 호출은 여기 모인다. 소비자:
     · `ChainChip`         — 카드 서브바 우측 칩 (v1 에서 그대로 유지)
     · `chain-lane-host`   — 레인 본문 조립. 그 아래로 `chain-lane`(셸) ·
       `chain-slot` · `chain-segment` · `chain-capsule` · `chain-report-node`
     · `chain-toolbar-host`— 좌상단 "+ 새 체인" + 요약 pill (변환 레이어 밖)
     · `chain-lane-provider` — 레인 클라이언트 상태(도킹 구성 · 드래그 판정)
   (v1 의 ChainBar/ChainEntryBlock, v2 의 오버레이·포트·엣지 레이어·진입
   팝오버는 전부 제거됐다 — 체인은 캔버스 위 **선반**이고 사용자가 카드를
   끌어다 조립한다. v3 README 결정 1·2.)

   한 캔버스에 체인은 **하나**다. 그래서 조회도 전역 1건:
   `GET /api/chains`(project_id 생략 = org 최근 활성 1건). 프로빙 진입 체인은
   project_id 가 null 이라 프로젝트 키로는 찾을 수 없다(R8).

   realtime: `widget_chains` row 를 id 로 구독한다(A 의 마이그가 publication 에
   등록 + RLS select = org viewer). 새 체인 생성은 이 클라이언트가 유일한 출처라
   (진입 팝오버) 생성 직후 refresh 로 발견한다 — 폴링을 새로 들이지 않는다.

   크레딧: 잔액(S4 "잔액 💎N")과 충전 진입(onTopUp)은 **기존 전역 경로 재사용** —
   `usePaywall()` 의 status.balance + showPaywall(). 새 fetch 를 만들지 않는다.
   ──────────────────────────────────────────────────────────────────── */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import { usePaywall } from '@/components/paywall-provider';
import type { ChainRow } from '@/lib/chains/state';
import {
  CHAIN_STEP_WIDGET_KEY,
  toChainView,
  type ChainView,
} from '@/lib/chains/view';
import { chipStatusOf, type ChainChipProps } from './chain-chip';

export type CreateChainInput = {
  /** 조립된 단계 시퀀스(A′ 1급 입력). 레인이 만든 구성 그대로 보낸다. */
  steps: string[];
  mode?: 'approve' | 'auto';
  projectId?: string | null;
};

type WidgetChainApi = {
  /** 표시할 체인. null = 체인 없음 또는 사용자가 닫음. */
  view: ChainView | null;
  /** 액션 in-flight. */
  busy: boolean;
  /**
   * 첫 조회가 아직 안 끝났다 — 체인이 있는지 없는지 **모르는** 구간.
   * 레인 복원이 이 조회에 달려 있으므로, 그 전에 "+ 새 체인" 을 누르면
   * 복원될 레인 위에 빈 레인을 덮어쓰게 된다(툴바가 이 값으로 비활성).
   */
  hydrating: boolean;
  approve: (stepIndex: number, projectId?: string | null) => Promise<void>;
  skip: (stepIndex: number) => Promise<void>;
  cancel: () => Promise<void>;
  resume: () => Promise<void>;
  /** 종결 바 제거(로컬) — 서버 상태는 그대로. */
  dismiss: () => void;
  refresh: () => Promise<void>;
  /**
   * 체인 생성. **승인하지 않는다** — approve 모드 체인은 `awaiting_approval`
   * (= 조립 수정 가능, A″ `isAssemblyEditable`)로 남는다. v1/v2 는 생성 직후
   * 첫 단계를 승인해 running 으로 올렸지만, v3 는 조립이 끝나는 순간 체인을
   * 만들므로(수명주기 (가)) 그때 승인하면 L3 에서 구성이 즉시 잠긴다.
   * 진입 단계를 running 으로 올리는 일은 `approve` 가 따로 담당한다.
   */
  createChain: (input: CreateChainInput) => Promise<boolean>;
  /**
   * 조립 교체 — A″ `PATCH /api/chains/:id/steps`. 성공하면 최신 행을 반영하고,
   * 409(`chain_locked`)면 **갱신된 상태를 다시 읽는다**(경합 시 상대 1승 구조).
   */
  patchSteps: (steps: string[]) => Promise<boolean>;
  /** 이 위젯 카드에 붙일 칩 props. 체인 밖 카드는 null → 서브바 미렌더. */
  chipFor: (widgetKey: string) => ChainChipProps | null;
};

const WidgetChainContext = createContext<WidgetChainApi | null>(null);


export function WidgetChainProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const { status: creditsStatus, refresh: refreshCredits } = usePaywall();
  const [row, setRow] = useState<ChainRow | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hydrating, setHydrating] = useState(true);
  // 액션 응답이 realtime 보다 늦게 와 오래된 행으로 되돌리는 것을 막는다.
  const rowRef = useRef<ChainRow | null>(null);

  const applyRow = useCallback((next: ChainRow | null) => {
    rowRef.current = next;
    setRow(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/chains', { cache: 'no-store' });
      if (!res.ok) return;
      const json = (await res.json()) as { chain?: ChainRow | null };
      applyRow(json.chain ?? null);
    } catch {
      // 조용히 — 체인 바는 보조 표면이고, 실패해도 위젯 사용은 그대로다.
    } finally {
      setHydrating(false);
    }
  }, [applyRow]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 초기 조회(비동기 fetch 결과 반영). use-interview-v2-projects 와 동일 패턴.
    void refresh();
  }, [refresh]);

  // ── realtime — 보고 있는 체인 row 구독 ───────────────────────────────
  const chainId = row?.id ?? null;
  useEffect(() => {
    if (!chainId) return;
    const channel = supabase
      .channel(`widget-chain-${chainId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'widget_chains',
          filter: `id=eq.${chainId}`,
        },
        (payload) => {
          const next = payload.new as ChainRow | undefined;
          if (!next?.id) return;
          applyRow(next);
          // 단계가 넘어갈 때마다 크레딧이 나간다 — 잔액 표시를 맞춘다.
          void refreshCredits();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [chainId, supabase, applyRow, refreshCredits]);

  // ── 액션 ─────────────────────────────────────────────────────────────
  const post = useCallback(
    async (path: string, body?: unknown): Promise<void> => {
      const current = rowRef.current;
      if (!current) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/chains/${current.id}/${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        });
        const json = (await res.json().catch(() => ({}))) as {
          chain?: ChainRow | null;
        };
        // 라우트가 최신 행을 돌려준다(kick 이 status 를 바꿨을 수 있음) — realtime
        // 이벤트를 기다리지 않고 즉시 반영한다.
        if (json.chain?.id === current.id) applyRow(json.chain);
        else await refresh();
        void refreshCredits();
      } catch {
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [applyRow, refresh, refreshCredits],
  );

  const approve = useCallback(
    (stepIndex: number, projectId?: string | null) => {
      void stepIndex; // 서버는 항상 current_step 을 승인한다(CAS 가 경합 처리).
      return post('approve', projectId ? { project_id: projectId } : {});
    },
    [post],
  );
  const skip = useCallback(
    (stepIndex: number) => {
      void stepIndex;
      return post('skip');
    },
    [post],
  );
  const cancel = useCallback(() => post('cancel'), [post]);
  const resume = useCallback(() => post('resume'), [post]);

  const dismiss = useCallback(() => {
    setDismissedId(rowRef.current?.id ?? null);
  }, []);

  const createChain = useCallback(
    async (input: CreateChainInput): Promise<boolean> => {
      try {
        const res = await fetch('/api/chains', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            steps: input.steps,
            mode: input.mode ?? 'approve',
            ...(input.projectId ? { project_id: input.projectId } : {}),
          }),
        });
        if (!res.ok) return false;
        const json = (await res.json()) as { chain?: ChainRow | null };
        const created = json.chain ?? null;
        if (!created) return false;
        applyRow(created);
        setDismissedId(null);
        return true;
      } catch {
        return false;
      }
    },
    [applyRow],
  );

  const patchSteps = useCallback(
    async (steps: string[]): Promise<boolean> => {
      const current = rowRef.current;
      if (!current) return false;
      setBusy(true);
      try {
        const res = await fetch(`/api/chains/${current.id}/steps`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ steps }),
        });
        if (res.status === 409) {
          // 잠금 전이(승인·건너뛰기·종료·sweep)가 먼저 도착했다 — 상대가 이기고 사용자는
          // **갱신된 상태**를 봐야 한다. 재시도하지 않는다.
          await refresh();
          return false;
        }
        if (!res.ok) {
          // 400(검증 실패)은 프론트 `canDock` 과 같은 권위(validateSteps)를 사용하므로
          // 정상 경로에선 오지 않는다. 와도 서버가 맞으니 화면을 서버에 맞춘다.
          await refresh();
          return false;
        }
        const json = (await res.json()) as { chain?: ChainRow | null };
        if (json.chain?.id === current.id) applyRow(json.chain);
        else await refresh();
        return true;
      } catch {
        await refresh();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [applyRow, refresh],
  );

  // ── 뷰 ───────────────────────────────────────────────────────────────
  const view = useMemo<ChainView | null>(() => {
    if (!row || row.id === dismissedId) return null;
    return toChainView(row, creditsStatus?.balance ?? null);
  }, [row, dismissedId, creditsStatus?.balance]);

  const chipFor = useCallback(
    (widgetKey: string): ChainChipProps | null => {
      if (!view) return null;
      const matches = view.steps
        .map((step, index) => ({ step, index }))
        .filter((m) => CHAIN_STEP_WIDGET_KEY[m.step.feature] === widgetKey);
      if (matches.length === 0) return null;
      // 한 위젯이 두 단계를 맡을 수 있다(인사이트 분석기 = 인제스트 + 탑라인).
      // 커서 단계가 이 위젯이면 그걸, 아니면 **가장 진행된(아직 pending 아닌)**
      // 단계를 보여준다 — 칩은 "이 카드가 지금 체인의 어디인가" 를 말한다.
      const atCursor = matches.find((m) => m.index === view.currentStep);
      const advanced = [...matches]
        .reverse()
        .find((m) => m.step.status !== 'pending');
      const picked = atCursor ?? advanced ?? matches[0];
      // 한 위젯이 연속 두 단계를 맡으면 범위로 표기한다(CD S6 "체인 3–4/4").
      const first = matches[0].index + 1;
      const last = matches[matches.length - 1].index + 1;
      return {
        step: first,
        stepTo: last,
        total: view.steps.length,
        status: chipStatusOf(picked.step.status),
      };
    },
    [view],
  );

  const api = useMemo<WidgetChainApi>(
    () => ({
      view,
      busy,
      hydrating,
      approve,
      skip,
      cancel,
      resume,
      dismiss,
      refresh,
      createChain,
      patchSteps,
      chipFor,
    }),
    [
      view,
      busy,
      hydrating,
      approve,
      skip,
      cancel,
      resume,
      dismiss,
      refresh,
      createChain,
      patchSteps,
      chipFor,
    ],
  );

  return (
    <WidgetChainContext.Provider value={api}>
      {children}
    </WidgetChainContext.Provider>
  );
}

// Provider 밖(캔버스 아닌 표면)에서도 안전 — 체인 없음 + no-op 액션.
const INERT: WidgetChainApi = {
  view: null,
  busy: false,
  hydrating: false,
  approve: async () => {},
  skip: async () => {},
  cancel: async () => {},
  resume: async () => {},
  dismiss: () => {},
  refresh: async () => {},
  createChain: async () => false,
  patchSteps: async () => false,
  chipFor: () => null,
};

export function useWidgetChain(): WidgetChainApi {
  return useContext(WidgetChainContext) ?? INERT;
}

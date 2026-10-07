'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetChainProvider — 체인 UI 의 **컨테이너** (데이터 전부).

   프레젠테이션 3종(ChainBar · ChainChip · ChainEntryBlock)은 typed props 와
   콜백만 받는다 — 페칭·구독·액션 호출은 전부 여기 모인다(CD HANDOFF §2 경계).

   한 캔버스에 체인 바는 **하나**다(CD §0 Q1). 그래서 조회도 전역 1건:
   `GET /api/chains`(project_id 생략 = org 최근 활성 1건). 프로빙 진입 체인은
   project_id 가 null 이라 프로젝트 키로는 찾을 수 없다(R8).

   realtime: `widget_chains` row 를 id 로 구독한다(A 의 마이그가 publication 에
   등록 + RLS select = org viewer). 새 체인 생성은 이 클라이언트가 유일한 출처라
   (진입점 블록) 생성 직후 refresh 로 발견한다 — 폴링을 새로 들이지 않는다.

   크레딧: 잔액(B5 "잔액 💎N")과 충전 진입(onTopUp)은 **기존 전역 경로 재사용** —
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
  template?: string;
  startAt?: number;
  mode: 'approve' | 'auto';
  projectId?: string | null;
};

type WidgetChainApi = {
  /** 표시할 체인. null = 체인 없음 또는 사용자가 닫음. */
  view: ChainView | null;
  /** 액션 in-flight. */
  busy: boolean;
  approve: (stepIndex: number, projectId?: string | null) => Promise<void>;
  skip: (stepIndex: number) => Promise<void>;
  cancel: () => Promise<void>;
  resume: () => Promise<void>;
  /** 종결 바 제거(로컬) — 서버 상태는 그대로. */
  dismiss: () => void;
  refresh: () => Promise<void>;
  /**
   * 체인 생성. approve 모드는 생성 직후 첫 단계를 승인한다 — 진입 단계(프로빙)는
   * 서버가 kick 할 것이 없어(kick='manual') 승인이 곧 "사용자가 지금 이 단계를
   * 직접 수행 중" 이라는 표시이고, advanceChain 이 완료를 집어내려면
   * steps[0].status 가 running 이어야 한다(findChainAtStep 조건).
   */
  createChain: (input: CreateChainInput) => Promise<boolean>;
  /** 이 위젯 카드에 붙일 칩 props. 체인 밖 카드는 null → 서브바 미렌더. */
  chipFor: (widgetKey: string) => ChainChipProps | null;
};

const WidgetChainContext = createContext<WidgetChainApi | null>(null);

const DEFAULT_TEMPLATE = 'interview_pipeline';

export function WidgetChainProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const { status: creditsStatus, refresh: refreshCredits } = usePaywall();
  const [row, setRow] = useState<ChainRow | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
            template: input.template ?? DEFAULT_TEMPLATE,
            startAt: input.startAt ?? 0,
            mode: input.mode,
            ...(input.projectId ? { project_id: input.projectId } : {}),
          }),
        });
        if (!res.ok) return false;
        const json = (await res.json()) as { chain?: ChainRow | null };
        const created = json.chain ?? null;
        if (!created) return false;
        applyRow(created);
        setDismissedId(null);

        // approve 모드: 첫 단계(진입 위젯)를 즉시 승인해 running 으로 올린다.
        // 서버 kick 은 'manual' 이라 아무것도 착수하지 않고, 사용자가 방금 시작한
        // 세션의 완료 훅(advanceChain)이 이 running 단계를 찾아 전진시킨다.
        // auto 모드는 생성 라우트가 이미 running 으로 세팅한다.
        if (input.mode === 'approve') {
          const approveRes = await fetch(`/api/chains/${created.id}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          const approveJson = (await approveRes.json().catch(() => ({}))) as {
            chain?: ChainRow | null;
          };
          if (approveJson.chain?.id === created.id) applyRow(approveJson.chain);
        }
        return true;
      } catch {
        return false;
      }
    },
    [applyRow],
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
      return {
        step: picked.index + 1,
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
      approve,
      skip,
      cancel,
      resume,
      dismiss,
      refresh,
      createChain,
      chipFor,
    }),
    [
      view,
      busy,
      approve,
      skip,
      cancel,
      resume,
      dismiss,
      refresh,
      createChain,
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
  approve: async () => {},
  skip: async () => {},
  cancel: async () => {},
  resume: async () => {},
  dismiss: () => {},
  refresh: async () => {},
  createChain: async () => false,
  chipFor: () => null,
};

export function useWidgetChain(): WidgetChainApi {
  return useContext(WidgetChainContext) ?? INERT;
}

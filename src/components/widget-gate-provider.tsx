'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createClient } from '@/lib/supabase/client';

// 위젯별 동시사용 게이트 — client provider (#512, backend #511 위).
//
// 전역 진입 게이트(#505)를 대체한다. 앱/캔버스는 전원 즉시 입장하고, 게이트는
// 각 위젯이 **비싼 작업을 시작**하는 순간에만 슬롯을 요청한다:
//   - 통역/프로빙 = 세션 start
//   - 데스크/전사/인터뷰 = 잡 실행 start
//   - 리크루팅 = 추출 start
//
// acquire(widget):
//   - POST /api/gate/ping { widget }
//   - admitted        → 슬롯 확보 + 20s 하트비트 시작, resolve(true)
//   - admitted+bypass → 슈퍼어드민. 하트비트/release 없음(백엔드가 active 에
//                       안 넣어 cap 무관), resolve(true)
//   - waiting         → 그 위젯만 'waiting' 상태로 두고 5s poll. 앞사람이
//                       나가 admitted 로 바뀌면 하트비트 시작 + resolve(true)
//                       → 호출부가 보류했던 작업을 자동 진행.
// release(widget): 하트비트/poll 정지 + sendBeacon('/api/gate/release'{widget}).
//   작업 종료 / 세션 stop / 카드 이탈 / unload / 로그아웃 시 호출. 하트비트가
//   끊기면 백엔드 TTL sweep 이 최종 반납한다.
//
// **Fail-open 원칙**(#505 계승): 이 게이트는 보안이 아니라 초기 런칭 안전밸브다.
// ping 이 5xx/네트워크 에러면 작업을 막지 않고 낙관 admit(하트비트로 슬롯 확보
// 재시도)한다 — 게이트 장애가 위젯 사용을 막는 회귀를 방지.
//
// **Provider 부재 시 no-op**: 캔버스 밖(예: /live, /desk 단독 페이지)에서 같은
// 위젯 컴포넌트가 마운트돼도 provider 가 없으면 acquire 는 즉시 true(투명 통과),
// release 는 no-op. 게이트는 캔버스 위젯 카드 축에서만 발동한다.

const HEARTBEAT_MS = 20_000; // active 하트비트 — 백엔드 TTL 45s 의 절반 이내.
const POLL_MS = 5_000; // waiting poll — 백엔드 queue TTL 30s 기준.

export type WidgetGatePhase = 'idle' | 'waiting' | 'active';

export type WidgetGateEntry = {
  phase: WidgetGatePhase;
  // waiting 일 때만 의미 있음. 백엔드 RPC 의 1-based position(맨 앞=1).
  position: number | null;
};

const IDLE_ENTRY: WidgetGateEntry = { phase: 'idle', position: null };

type WidgetGateApi = {
  // 슬롯 요청. admitted(또는 fail-open) 시 true, 대기 중 사용자가 취소하거나
  // release/unmount 로 중단되면 false. waiting 이면 admitted 로 바뀔 때까지
  // resolve 를 보류한다(호출부가 await 로 작업을 잡아둔다).
  acquire: (widget: string) => Promise<boolean>;
  // 슬롯 반납(작업 종료/세션 stop/카드 이탈). 대기 중이면 취소로 처리.
  release: (widget: string) => void;
};

const NOOP_API: WidgetGateApi = {
  acquire: () => Promise.resolve(true),
  release: () => {},
};

// API(acquire/release)와 entries(오버레이용 상태)를 두 컨텍스트로 분리한다.
// API 는 stable identity 라 translate/probing 같은 heavy consumer 가 다른
// 위젯의 entries 변화로 리렌더되지 않는다. entries 는 shell 오버레이만 구독.
const WidgetGateApiContext = createContext<WidgetGateApi | null>(null);
const WidgetGateEntriesContext = createContext<Record<string, WidgetGateEntry>>(
  {},
);

// 위젯별 런타임 핸들 — 렌더에 관여하지 않아 ref 로만 관리.
type Runtime = {
  heartbeat: ReturnType<typeof setInterval> | null;
  poll: ReturnType<typeof setTimeout> | null;
  // waiting → admitted 전환 시 호출부 acquire() 를 깨우는 resolver.
  resolve: ((admitted: boolean) => void) | null;
  // 슈퍼어드민 우회 — 하트비트/release skip.
  bypass: boolean;
  // 현재 슬롯 보유 중(active) — unload/release 대상 판정.
  active: boolean;
};

function blob(widget: string): Blob {
  return new Blob([JSON.stringify({ widget })], { type: 'application/json' });
}

export function WidgetGateProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<Record<string, WidgetGateEntry>>({});
  const runtimeRef = useRef<Map<string, Runtime>>(new Map());

  const getRuntime = useCallback((widget: string): Runtime => {
    let rt = runtimeRef.current.get(widget);
    if (!rt) {
      rt = { heartbeat: null, poll: null, resolve: null, bypass: false, active: false };
      runtimeRef.current.set(widget, rt);
    }
    return rt;
  }, []);

  const setEntry = useCallback((widget: string, next: WidgetGateEntry) => {
    setEntries((prev) => {
      const cur = prev[widget] ?? IDLE_ENTRY;
      if (cur.phase === next.phase && cur.position === next.position) return prev;
      return { ...prev, [widget]: next };
    });
  }, []);

  const ping = useCallback(async (widget: string) => {
    const res = await fetch('/api/gate/ping', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ widget }),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`gate_ping_${res.status}`);
    return (await res.json()) as {
      status?: string;
      bypass?: boolean;
      position?: number;
    };
  }, []);

  const startHeartbeat = useCallback(
    (widget: string) => {
      const rt = getRuntime(widget);
      if (rt.heartbeat) return;
      rt.heartbeat = setInterval(() => {
        // 하트비트 실패는 무시 — 다음 tick 이 재시도, 최종적으로 TTL sweep.
        void ping(widget).catch(() => {});
      }, HEARTBEAT_MS);
    },
    [getRuntime, ping],
  );

  const clearTimers = useCallback(
    (widget: string) => {
      const rt = getRuntime(widget);
      if (rt.heartbeat) {
        clearInterval(rt.heartbeat);
        rt.heartbeat = null;
      }
      if (rt.poll) {
        clearTimeout(rt.poll);
        rt.poll = null;
      }
    },
    [getRuntime],
  );

  const acquire = useCallback(
    (widget: string): Promise<boolean> => {
      const rt = getRuntime(widget);
      // 이미 슬롯 보유 중이면(재진입) 즉시 통과.
      if (rt.active) return Promise.resolve(true);
      // 대기/획득 진행 중이면 그 흐름에 편승 — 새 promise 는 같은 resolver 로
      // 묶지 못하므로 중복 acquire 는 무시하고 true 로 낙관 통과.
      if (rt.resolve) return Promise.resolve(true);

      return new Promise<boolean>((resolve) => {
        rt.resolve = resolve;

        const settle = (admitted: boolean) => {
          const r = rt.resolve;
          rt.resolve = null;
          if (rt.poll) {
            clearTimeout(rt.poll);
            rt.poll = null;
          }
          r?.(admitted);
        };

        const tick = async () => {
          // release/cancel 로 이미 정리됐으면 중단.
          if (rt.resolve !== resolve) return;
          try {
            const data = await ping(widget);
            if (rt.resolve !== resolve) return;

            if (data.bypass) {
              rt.bypass = true;
              rt.active = true;
              setEntry(widget, { phase: 'active', position: null });
              settle(true); // 하트비트 없음 — active_uses 에 없어 cap 무관.
              return;
            }

            if (data.status === 'waiting') {
              setEntry(widget, {
                phase: 'waiting',
                position: typeof data.position === 'number' ? data.position : null,
              });
              rt.poll = setTimeout(() => void tick(), POLL_MS);
              return;
            }

            // admitted
            rt.active = true;
            setEntry(widget, { phase: 'active', position: null });
            startHeartbeat(widget);
            settle(true);
          } catch {
            // fail-open — 작업을 막지 않고 낙관 admit. 하트비트로 슬롯 확보 재시도.
            if (rt.resolve !== resolve) return;
            rt.active = true;
            setEntry(widget, { phase: 'active', position: null });
            startHeartbeat(widget);
            settle(true);
          }
        };

        void tick();
      });
    },
    [getRuntime, ping, setEntry, startHeartbeat],
  );

  const release = useCallback(
    (widget: string) => {
      const rt = getRuntime(widget);
      const wasHolding = rt.active;
      const wasWaiting = !!rt.resolve;
      clearTimers(widget);
      // 대기 중이었다면 보류된 acquire 를 취소(false)로 깨운다.
      if (rt.resolve) {
        const r = rt.resolve;
        rt.resolve = null;
        r(false);
      }
      const shouldBeacon = (wasHolding || wasWaiting) && !rt.bypass;
      rt.active = false;
      rt.bypass = false;
      setEntry(widget, IDLE_ENTRY);
      if (shouldBeacon) {
        navigator.sendBeacon?.('/api/gate/release', blob(widget));
      }
    },
    [clearTimers, getRuntime, setEntry],
  );

  // unload / 로그아웃 시 보유 중인 모든 위젯 슬롯 즉시 반납(SPA 이동으로 unload
  // 가 안 뜨는 로그아웃 경로 포함). bypass 는 active 에 없어 skip.
  useEffect(() => {
    const releaseAll = () => {
      runtimeRef.current.forEach((rt, widget) => {
        if (rt.active && !rt.bypass) {
          navigator.sendBeacon?.('/api/gate/release', blob(widget));
        }
      });
    };
    window.addEventListener('pagehide', releaseAll);
    window.addEventListener('beforeunload', releaseAll);
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') releaseAll();
    });
    return () => {
      window.removeEventListener('pagehide', releaseAll);
      window.removeEventListener('beforeunload', releaseAll);
      subscription.unsubscribe();
    };
  }, []);

  const api = useMemo<WidgetGateApi>(
    () => ({ acquire, release }),
    [acquire, release],
  );

  return (
    <WidgetGateApiContext.Provider value={api}>
      <WidgetGateEntriesContext.Provider value={entries}>
        {children}
      </WidgetGateEntriesContext.Provider>
    </WidgetGateApiContext.Provider>
  );
}

// 위젯 작업 시작/종료 지점에서 쓰는 hook. provider 부재 시 no-op(투명 통과).
// ctx 는 stable identity 라 반환 객체(acquire/release)도 stable — effect deps
// 에 넣어도 churn 이 없다.
export function useWidgetGate(widget: string) {
  const ctx = useContext(WidgetGateApiContext) ?? NOOP_API;
  return useMemo(
    () => ({
      acquire: () => ctx.acquire(widget),
      release: () => ctx.release(widget),
    }),
    [ctx, widget],
  );
}

// shell 오버레이/뱃지용 read-only 구독. provider 부재 시 항상 idle.
export function useWidgetGateEntry(widget: string): WidgetGateEntry {
  const entries = useContext(WidgetGateEntriesContext);
  return entries[widget] ?? IDLE_ENTRY;
}

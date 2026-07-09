'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ConcurrencyWaitingRoom } from '@/components/concurrency-waiting-room';

// 동시접속 정원 게이트 — 진입 게이트 provider (#505, backend #504 위).
//
// (app) 레이아웃 최상단을 감싼다. mount 시 POST /api/gate/ping:
//   - admitted        → children(앱) 렌더 + 20s 하트비트(슬롯 유지).
//   - admitted+bypass → 슈퍼어드민. 즉시 children, 하트비트/release 없음
//                       (backend 가 active_sessions 에 안 넣어 cap 무관).
//   - waiting         → 대기실만 렌더(앱 마운트 보류) + 5s poll. 응답이
//                       admitted 로 바뀌면 리로드 없이 앱으로 전환.
//
// 슬롯 반납: pagehide/beforeunload + SIGNED_OUT 시 sendBeacon('/api/gate/release').
//
// **Fail-open 원칙**: 이 게이트는 보안이 아니라 초기 런칭 안전밸브다. ping 이
// 500/네트워크 에러면(예: CONCURRENCY_CAP 미설정, RPC 부재) 앱을 막지 않고
// 그대로 통과시킨다 — 정원 여유 시 투명 통과 + 게이트 장애가 전체 로그인을
// 막는 회귀를 방지(spec §검증 "회귀 X").
//
// **Admit latch**: 한 번 admitted 되면 이후 ping 이 (에러 후 재시도 등으로)
// waiting 을 돌려줘도 대기실로 되돌리지 않는다 — 활성 사용자를 세션 도중
// 대기실로 쫓아내는 것이 슬롯 초과보다 나쁘기 때문. 백엔드는 active 행이
// 있는 한 admitted 만 반환하므로 정상 흐름에선 발생하지 않고, fail-open 으로
// 낙관 admit 한 경우의 방어책이다.

const HEARTBEAT_MS = 20_000; // active 하트비트 — TTL 45s 의 절반 이내.
const POLL_MS = 5_000; // waiting poll — 백엔드 queue TTL 30s 기준.

type Phase = 'connecting' | 'waiting' | 'admitted' | 'error';

export function ConcurrencyGateProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('connecting');
  const [position, setPosition] = useState<number | null>(null);

  // admit 래치 — 한 번 true 면 대기실로 되돌아가지 않는다.
  const admittedRef = useRef(false);
  // 슈퍼어드민 bypass — 하트비트/release skip.
  const bypassRef = useRef(false);
  // self-scheduling timer 핸들 + 언마운트 가드.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  // 진입 ping + 주기 하트비트/poll 루프. 루프는 effect 안의 로컬 함수라
  // 자기 자신을 재귀 스케줄해도 훅 값이 아니어서 안전(react 불변성 룰 통과).
  useEffect(() => {
    stoppedRef.current = false;

    async function tick() {
      let nextDelay = POLL_MS;
      try {
        const res = await fetch('/api/gate/ping', {
          method: 'POST',
          cache: 'no-store',
        });

        if (!res.ok) {
          // 401 은 세션 만료 — layout/AuthStateListener 가 /login 으로 보낸다.
          // 그 외 5xx 는 게이트 장애 → fail-open. 어느 쪽이든 앱을 막지 않는다.
          admittedRef.current = true;
          setPhase('admitted');
          nextDelay = HEARTBEAT_MS;
        } else {
          const data: {
            status?: string;
            bypass?: boolean;
            position?: number;
          } = await res.json();

          if (data.status === 'waiting' && !admittedRef.current) {
            setPhase('waiting');
            setPosition(typeof data.position === 'number' ? data.position : null);
            nextDelay = POLL_MS;
          } else {
            // admitted, bypass, 또는 (래치 후) 늦은 waiting → 모두 통과.
            if (data.bypass) {
              bypassRef.current = true;
            }
            admittedRef.current = true;
            setPhase('admitted');
            if (bypassRef.current) {
              // 슈퍼어드민 — active_sessions 에 없으니 하트비트 불필요. 정지.
              stoppedRef.current = true;
              return;
            }
            nextDelay = HEARTBEAT_MS;
          }
        }
      } catch {
        // 네트워크 에러 → fail-open(앱 통과) 하되 천천히 재시도로 슬롯 확보 시도.
        admittedRef.current = true;
        setPhase('admitted');
        nextDelay = HEARTBEAT_MS;
      }

      if (!stoppedRef.current) {
        timerRef.current = setTimeout(tick, nextDelay);
      }
    }

    void tick();

    return () => {
      stoppedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // 슬롯 반납 — 탭 닫기/이동 + 로그아웃. bypass(슈퍼어드민)는 active 에 없어 skip.
  useEffect(() => {
    const release = () => {
      if (bypassRef.current) return;
      navigator.sendBeacon?.('/api/gate/release');
    };

    // pagehide 는 bfcache 포함 unload 를 가장 안정적으로 커버. beforeunload 는
    // 일부 브라우저 백업.
    window.addEventListener('pagehide', release);
    window.addEventListener('beforeunload', release);

    // 로그아웃(이 탭/다른 탭) 시에도 슬롯 즉시 반납 — SPA 이동이라 unload 가
    // 안 뜨는 경로를 커버.
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') release();
    });

    return () => {
      window.removeEventListener('pagehide', release);
      window.removeEventListener('beforeunload', release);
      subscription.unsubscribe();
    };
  }, []);

  if (phase === 'admitted') {
    return <>{children}</>;
  }

  return (
    <ConcurrencyWaitingRoom
      phase={phase === 'connecting' ? 'connecting' : phase === 'error' ? 'error' : 'waiting'}
      position={position}
    />
  );
}

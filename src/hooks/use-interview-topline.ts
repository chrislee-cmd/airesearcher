'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useWidgetGate } from '@/components/widget-gate-provider';
import {
  isToplineGeneratingStale,
  type ToplineBlock,
  type ToplineReadResult,
  type ToplineStatus,
} from '@/lib/interview-v2/types';

// 인터뷰 탑라인 — client 데이터 소스. GET(읽기 전용, 생성 트리거 X)로 저장된
// 보고서를 열자마자 로드하고, interview_toplines row 를 realtime 으로 구독해
// status 전이(generating → done|error)와 blocks 갱신을 반영한다.
// (마이그 20260706114519 가 이 테이블을 supabase_realtime publication 에 등록.)
//
// 재생성은 명시적 — generate(force) 가 POST 로 Opus 를 kick 한다(비용 통제,
// 사용자 결정). 초기 로드는 절대 POST 를 부르지 않아 stale/미존재 시에도
// 과금이 없다.

export type ToplineState = {
  // interview_toplines.id — 공유 링크(#477) resource_id. 미생성이면 null.
  toplineId: string | null;
  status: ToplineStatus;
  blocks: ToplineBlock[];
  stale: boolean;
  indexed: boolean;
  generatedAt: string | null;
  errorMessage: string | null;
  // map-reduce 진행률(전 문서 순회) — generating 중 "N/M 문서 분석". null 이면
  // 진행률 미노출.
  mapTotal: number | null;
  mapDone: number | null;
  // stuck 'generating' — status='generating' 인데 updated_at 이 STALE 창 넘게
  // 갱신 안 됨(백그라운드 함수 사망). true 면 UI 가 재생성/추가질문 잠금을 푼다
  // (카드 #483). 살아 있는 생성 중엔 항상 false(진행마다 updated_at bump).
  generatingStale: boolean;
  // 마지막 생성에 쓰인 출력 언어(ko/en/ja/zh/es/th). null = 레거시/미생성 →
  // UI 가 기본(한국어) 선택으로 초기화. 언어 선택기의 초기값 소스.
  savedLang: string | null;
  // 마지막 재생성에 쓰인 분석 방향. null = 방향 없음/레거시/미생성 → 재생성
  // 모달을 빈 입력으로 시작. 재생성 방향 textarea 의 초기값 소스.
  savedDirection: string | null;
  // 초기 GET 로딩 중.
  loading: boolean;
  // GET/POST 자체가 실패(네트워크/서버).
  fetchError: string | null;
  // 재생성 POST in-flight.
  generating: boolean;
  // outputLang 미지정이면 서버가 기본(한국어)으로 생성 — 기존 회귀 X.
  // userDirection 미지정/빈 값이면 방향 없이 생성(옛 동작). 재생성 방향 입력에서만
  // 전달 — 최초 생성 CTA 는 방향 없이 호출한다.
  generate: (
    force: boolean,
    outputLang?: string,
    userDirection?: string,
  ) => Promise<void>;
  refetch: () => Promise<void>;
  // 인라인 편집의 낙관적 반영 — 특정 블록의 md 를 클라 상태에서 즉시 교체한다
  // (서버 PATCH 성공 시 refetch 로 확정, 실패 시 원문 md 로 되돌려 롤백).
  applyBlockMd: (blockId: string, md: string) => void;
};

export function useInterviewTopline(projectId: string | null): ToplineState {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<ToplineReadResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  // 위젯별 동시사용 게이트 (#512) — 탑라인 생성(POST)이 인터뷰 위젯의 비싼
  // 작업 kick 지점이다. generate 시 슬롯 획득, 서버 잡이 종점(done/error)에
  // 닿으면 반납. 이 hook 은 canvas fullview(게이트 provider 있음)와 detail
  // 페이지(provider 없음 → no-op) 양쪽에서 쓰여 두 경로를 한 곳에서 커버한다.
  const gate = useWidgetGate('interviews');

  // 언마운트 후 setState 방지 (탭 전환/모달 닫힘).
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const refetch = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(
        `/api/interviews/v2/topline?project_id=${encodeURIComponent(projectId)}`,
        { method: 'GET' },
      );
      const json = (await res.json().catch(() => null)) as
        | ToplineReadResult
        | { error?: string }
        | null;
      if (!aliveRef.current) return;
      if (!res.ok || !json || 'error' in json) {
        setFetchError(
          json && 'error' in json && typeof json.error === 'string'
            ? json.error
            : `HTTP ${res.status}`,
        );
        return;
      }
      setFetchError(null);
      setData(json as ToplineReadResult);
    } catch (e) {
      if (!aliveRef.current) return;
      setFetchError(e instanceof Error ? e.message : 'network_error');
    }
  }, [projectId]);

  // 프로젝트 바뀔 때마다 초기 로드.
  useEffect(() => {
    if (!projectId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no project = nothing to load; clear the gate (use-consent.ts pattern)
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      await refetch();
      if (aliveRef.current) setLoading(false);
    })();
  }, [projectId, refetch]);

  // Realtime — 이 프로젝트의 탑라인 row UPDATE/INSERT 구독. status/blocks 를
  // payload 로 즉시 반영하고, 안전하게 refetch 로 stale 재계산까지 맞춘다.
  useEffect(() => {
    if (!projectId) return;
    const ch = supabase
      .channel(`interview-topline-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'interview_toplines',
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const next = payload.new as
            | {
                status?: ToplineStatus;
                blocks?: ToplineBlock[];
                map_total?: number | null;
                map_done?: number | null;
                updated_at?: string | null;
              }
            | undefined;
          if (next?.status) {
            setData((prev) =>
              prev
                ? {
                    ...prev,
                    status: next.status as ToplineStatus,
                    blocks: Array.isArray(next.blocks)
                      ? next.blocks
                      : prev.blocks,
                    // map 진행률 bump 는 status='generating' 유지한 채 map_done
                    // 만 바뀌는 UPDATE 로 온다 — 매 문서 완료마다 반영.
                    map_total:
                      next.map_total !== undefined
                        ? next.map_total
                        : prev.map_total,
                    map_done:
                      next.map_done !== undefined
                        ? next.map_done
                        : prev.map_done,
                    // 살아 있는 생성의 liveness 신호 — 매 UPDATE 마다 최신화해
                    // stuck 오판(멈춘 것으로 오인)을 막는다.
                    updated_at:
                      next.updated_at !== undefined
                        ? next.updated_at
                        : prev.updated_at,
                  }
                : prev,
            );
          }
          // done/error 전이 시 stale·generated_at 을 정확히 맞추려 GET 재조회.
          if (next?.status === 'done' || next?.status === 'error') {
            void refetch();
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [supabase, projectId, refetch]);

  const generate = useCallback(
    async (force: boolean, outputLang?: string, userDirection?: string) => {
      if (!projectId) return;
      // 슬롯 획득 — 정원 초과면 카드 국소 대기 UI 후 admitted 시 자동 진행.
      const admitted = await gate.acquire();
      if (!admitted) return;
      setGenerating(true);
      // 낙관적으로 generating 표시 — realtime/refetch 가 곧 확정.
      setData((prev) => (prev ? { ...prev, status: 'generating' } : prev));
      try {
        const res = await fetch('/api/interviews/v2/topline', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // output_lang / user_direction 미지정(undefined)이면 JSON.stringify 가
          // 키를 생략 → 서버 기본(한국어 · 방향 없음) 동작. 기존 회귀 X.
          body: JSON.stringify({
            project_id: projectId,
            force,
            output_lang: outputLang,
            user_direction: userDirection,
          }),
        });
        const json = (await res.json().catch(() => null)) as
          | { status?: ToplineStatus; error?: string }
          | null;
        if (!aliveRef.current) return;
        if (!res.ok) {
          setFetchError(
            json && typeof json.error === 'string'
              ? json.error
              : `HTTP ${res.status}`,
          );
          // 잡이 시작 못 함 — 슬롯 즉시 반납(서버 잡 종점 신호가 안 오므로).
          gate.release();
          // 실패 시 실제 상태로 되돌린다.
          await refetch();
          return;
        }
        setFetchError(null);
        // 캐시 히트면 즉시 done + blocks 를 반환하기도 함.
        await refetch();
      } catch (e) {
        if (!aliveRef.current) return;
        setFetchError(e instanceof Error ? e.message : 'network_error');
        // 네트워크 실패 — 잡 미시작, 슬롯 반납.
        gate.release();
      } finally {
        if (aliveRef.current) setGenerating(false);
      }
    },
    [projectId, refetch, gate],
  );

  // 탑라인 생성 잡이 종점(done/error)에 닿으면 게이트 슬롯 반납 → 대기자 승격.
  // 성공 kick 후 서버 잡이 realtime 으로 status 를 굴려 여기서 반납된다.
  const prevGateStatusRef = useRef<ToplineStatus | null>(null);
  useEffect(() => {
    const prev = prevGateStatusRef.current;
    const cur = data?.status ?? null;
    prevGateStatusRef.current = cur;
    if (prev === 'generating' && (cur === 'done' || cur === 'error')) {
      gate.release();
    }
  }, [data?.status, gate]);

  // 낙관적 블록 md 교체 — 인라인 편집이 저장 성공/실패 확정 전에 즉시 화면에
  // 반영하거나(저장) 원문으로 되돌리는(롤백) 데 쓴다. 블록 타입/구조는 유지.
  const applyBlockMd = useCallback((blockId: string, md: string) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            blocks: prev.blocks.map((b) =>
              b.id === blockId ? ({ ...b, md } as ToplineBlock) : b,
            ),
          }
        : prev,
    );
  }, []);

  // stuck 'generating' 판정 — status='generating' 인데 updated_at 이 STALE 창
  // 넘게 안 바뀌면(백그라운드 함수 사망) true. 재fetch 없이도 버튼을 풀어주려
  // status='generating' 인 동안만 tick 을 돌려 시각이 흐르면 재평가한다. 살아
  // 있는 생성은 realtime UPDATE 마다 updated_at 이 bump 돼 항상 false.
  const status = data?.status ?? 'none';
  const updatedAt = data?.updated_at ?? null;
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (status !== 'generating') return;
    const id = setInterval(() => {
      if (aliveRef.current) setNowTick(Date.now());
    }, 15_000);
    return () => clearInterval(id);
  }, [status]);
  const generatingStale = useMemo(
    () => isToplineGeneratingStale({ status, updated_at: updatedAt }, nowTick),
    [status, updatedAt, nowTick],
  );

  // stuck 감지 시 1회 refetch — GET 이 서버에서 row 를 'error' 로 정리(결정 C)해
  // status 를 실제로 전이시킨다. generatingStale 은 그 전까지의 브릿지.
  const healedRef = useRef(false);
  useEffect(() => {
    if (!generatingStale) {
      healedRef.current = false;
      return;
    }
    if (healedRef.current) return;
    healedRef.current = true;
    void refetch();
  }, [generatingStale, refetch]);

  return {
    toplineId: data?.id ?? null,
    status,
    blocks: data?.blocks ?? [],
    stale: data?.stale ?? false,
    indexed: data?.indexed ?? false,
    generatedAt: data?.generated_at ?? null,
    errorMessage: data?.error_message ?? null,
    mapTotal: data?.map_total ?? null,
    mapDone: data?.map_done ?? null,
    generatingStale,
    savedLang: data?.output_lang ?? null,
    savedDirection: data?.user_direction ?? null,
    loading,
    fetchError,
    generating,
    generate,
    refetch,
    applyBlockMd,
  };
}

// 경량 read-only 진행률 + blocks 구독 — status/map_total/map_done 에 더해 위젯
// 카드가 abstract 를 그리는 데 필요한 blocks 까지 싣는다. useInterviewTopline(전체
// 상태 + edit/generate)과 달리 POST 를 절대 부르지 않아 과금이 없다. 이 hook 은
// fullview(팝업) 밖, 즉 캔버스에 항상 마운트되는 위젯 카드 본문에서 호출돼 팝업을
// 닫아도 구독이 살아있게 한다 — 백엔드는 after()+DB 로 이미 persist 되지만, 구독이
// fullview 에 묶여 팝업을 닫으면 progress 가 사라져 "멈춘 것처럼" 보이던 문제
// (card #434 가시성 fix).
//
// ⚠️ 채널명은 반드시 useInterviewTopline(interview-topline-*)과 달라야 한다
// (interview-topline-status-*). 팝업이 열리면 fullview 의 ToplineView 가
// useInterviewTopline 으로 같은 프로젝트를 구독하는데, 토픽명이 같으면 Supabase
// realtime 이 "cannot add postgres_changes callbacks after subscribe()" 로 크래시한다
// (동일 토픽 이중 구독 금지). 이 격리 채널명 덕에 카드+팝업이 동시에 살아도 안전.
export type ToplineStatusState = {
  status: ToplineStatus;
  mapTotal: number | null;
  mapDone: number | null;
  // 카드 abstract 파생용 blocks. generating 중엔 비어 있다가 done 에서 채워진다.
  blocks: ToplineBlock[];
  // 초기 GET 로딩 중 — 카드가 skeleton 을 그려 status='none' 순간 깜빡임을 막는다.
  loading: boolean;
};

// channelKey 는 realtime 토픽 접미사 — 같은 client(싱글턴) 에서 동일 토픽을
// 두 번 구독하면 "cannot add postgres_changes callbacks after subscribe()" 로
// 크래시한다(동일 토픽 이중 구독 금지). 위젯 카드 본문(기본 'status')과 fullview
// ProjectDetail(다른 key, 예: 'detail')이 같은 프로젝트를 동시에 구독할 수 있으므로
// 소비처마다 고유 key 를 넘겨 토픽을 격리한다.
export function useInterviewToplineStatus(
  projectId: string | null,
  channelKey = 'status',
): ToplineStatusState {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<ToplineStatusState>({
    status: 'none',
    mapTotal: null,
    mapDone: null,
    blocks: [],
    loading: true,
  });
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // 상태 + blocks 조회 — GET(읽기 전용, 생성 트리거 X). 카드가 생성 도중
  // 마운트되거나 팝업을 재오픈해도 현재 진행률/요약을 즉시 반영(0% 리셋 방지).
  const loadStatus = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(
        `/api/interviews/v2/topline?project_id=${encodeURIComponent(projectId)}`,
        { method: 'GET' },
      );
      const json = (await res.json().catch(() => null)) as
        | ToplineReadResult
        | { error?: string }
        | null;
      if (!aliveRef.current || !res.ok || !json || 'error' in json) return;
      const r = json as ToplineReadResult;
      setState({
        status: r.status,
        mapTotal: r.map_total,
        mapDone: r.map_done,
        blocks: Array.isArray(r.blocks) ? r.blocks : [],
        loading: false,
      });
    } catch {
      // 상시 배경 구독 — 초기 조회 실패는 무음(다음 realtime UPDATE 가 채움).
      if (aliveRef.current) setState((prev) => ({ ...prev, loading: false }));
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no project = nothing to track; reset the gate
      setState({
        status: 'none',
        mapTotal: null,
        mapDone: null,
        blocks: [],
        loading: false,
      });
      return;
    }
    setState((prev) => ({ ...prev, loading: true }));
    void loadStatus();
  }, [projectId, loadStatus]);

  // Realtime — 이 프로젝트 탑라인 row 의 status/map 진행률 + blocks 반영. 매 문서
  // 완료마다 오는 map_done bump 을 그대로 흘려보내고, done/error 전이 시엔 GET
  // 재조회로 blocks/정합을 맞춘다(payload 누락 방어 — useInterviewTopline 미러).
  useEffect(() => {
    if (!projectId) return;
    const ch = supabase
      .channel(`interview-topline-${channelKey}-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'interview_toplines',
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const next = payload.new as
            | {
                status?: ToplineStatus;
                map_total?: number | null;
                map_done?: number | null;
                blocks?: ToplineBlock[];
              }
            | undefined;
          if (!next?.status || !aliveRef.current) return;
          setState((prev) => ({
            status: next.status as ToplineStatus,
            mapTotal:
              next.map_total !== undefined ? next.map_total : prev.mapTotal,
            mapDone:
              next.map_done !== undefined ? next.map_done : prev.mapDone,
            blocks: Array.isArray(next.blocks) ? next.blocks : prev.blocks,
            loading: false,
          }));
          if (next.status === 'done' || next.status === 'error') {
            void loadStatus();
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [supabase, projectId, channelKey, loadStatus]);

  return state;
}

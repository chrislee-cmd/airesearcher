'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainInspectorProvider — 인스펙터의 **컨테이너**: 선택 + 낙관적 설정 저장.

   CD SSOT: `design-handoff/chain-inspector/README.md` §4.5 저장 · §4.7 열기·
   닫기·이동 · §5 잠금.

   ── 왜 provider 인가 ───────────────────────────────────────────────────
   같은 두 값(선택된 단계 · 낙관적으로 반영된 설정)을 **레인 카드와 인스펙터가
   함께** 읽어야 한다. CD §4.5 가 "값이 바뀌면 즉시 카드 요약에 반영한다" 를
   요구하므로, 낙관적 값이 인스펙터 안에만 있으면 카드는 400ms 동안 옛 요약을
   보여준다. 둘이 서로 다른 값을 보는 순간이 곧 "저장됐나?" 라는 의심이다.
   인스펙터는 캔버스 transform **밖 형제**이고 카드는 레인 **안**이라 공통
   부모가 보드뿐이므로, 상태를 보드 로컬이 아니라 provider 에 둔다.

   ── 저장 (§4.5) ────────────────────────────────────────────────────────
   낙관적 반영 → **디바운스 400ms** → `PATCH …/steps/:index/config`(부분 머지,
   선행 PR #1347). 저장·되돌리기 버튼은 없다. 실패하면 하단 진행도 자리에 err +
   재시도 버튼 하나를 띄우고 **마지막 값을 유지**한다 — 사용자가 쓴 값을 서버
   실패 때문에 되돌리면 그게 더 나쁜 손실이다.

   ── 드래프트는 왜 서버 값과 같아질 때까지만 사는가 ──────────────────────
   낙관적 값을 영구히 들고 있으면 realtime 으로 들어온 **다른 경로의 변경**
   (어댑터·다른 탭)이 영영 안 보인다. 그래서 PATCH 성공 응답에서 서버 config 가
   드래프트와 같아진 키만 **드래프트에서 지운다** — 남은 키는 아직 비행 중이거나
   실패한 값이다.
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
import { useWidgetChain } from './widget-chain-provider';

/** CD §4.5 — 서버 저장은 디바운스 400ms. */
const SAVE_DEBOUNCE_MS = 400;

export type ChainSaveState = 'idle' | 'saving' | 'saved' | 'error';

type DraftMap = Record<number, Record<string, unknown>>;

type ChainInspectorApi = {
  /** 편집 중인 단계 index(0-based). null = 인스펙터 닫힘. */
  selectedIndex: number | null;
  /** 카드 누르기 — 같은 카드면 닫고(§4.7), 다른 카드면 그쪽으로 옮긴다. */
  toggle: (index: number) => void;
  open: (index: number) => void;
  close: () => void;
  /** ‹ › · "다음 단계 →". 범위를 벗어나면 아무 일도 하지 않는다. */
  go: (delta: number) => void;
  /**
   * 낙관적 반영이 얹힌 단계 설정 — **카드와 인스펙터가 같은 값을 읽는 지점**.
   * 서버 값(`ChainStepView.config`) 위에 아직 저장 중/실패한 드래프트를 얹는다.
   */
  configAt: (index: number) => Record<string, unknown>;
  /** 필드 하나를 바꾼다. `null` = 그 키를 비움(RFC 7396). */
  setField: (index: number, fieldId: string, value: unknown) => void;
  saveState: ChainSaveState;
  /** 실패한 마지막 패치를 다시 보낸다(§4.5 "재시도 버튼 하나"). */
  retry: () => void;
};

const Ctx = createContext<ChainInspectorApi | null>(null);

export function ChainInspectorProvider({ children }: { children: ReactNode }) {
  const { view, patchStepConfig } = useWidgetChain();
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftMap>({});
  const [saveState, setSaveState] = useState<ChainSaveState>('idle');

  const stepCount = view?.steps.length ?? 0;
  const chainId = view?.id ?? null;

  // 선택은 **파생으로 범위를 좁힌다** — 단계가 빠지거나 체인이 사라졌을 때
  // effect 로 되돌리면 그게 곧 effect 안 동기 setState 다(레포 규칙).
  const selectedIndex =
    selected !== null && selected >= 0 && selected < stepCount ? selected : null;

  // 체인이 바뀌면(해체 후 새 체인) 선택과 드래프트를 버린다 — 다른 체인의
  // 단계 번호에 옛 드래프트가 얹히면 "설정하지 않은 값" 이 보인다.
  const prevChainRef = useRef<string | null>(chainId);
  useEffect(() => {
    if (prevChainRef.current === chainId) return;
    prevChainRef.current = chainId;
    // 체인 교체 감지 시 1회 초기화. 파생으로는 표현할 수 없다 — 드래프트는
    // 사용자 입력 누적이라 렌더 중 계산 대상이 아니다.
    setDraft({});
    setSelected(null);
  }, [chainId]);

  // ── 디바운스 버퍼 ──────────────────────────────────────────────────
  // 아직 보내지 않은 패치(단계별로 쌓인다)와 타이머. ref 인 이유: 타이머가
  // 만료될 때 **최신 버퍼**를 읽어야 하고, 버퍼 변경이 렌더를 부를 필요가 없다.
  const pendingRef = useRef<Map<number, Record<string, unknown>>>(new Map());
  const timerRef = useRef(0);
  /** 실패한 마지막 전송 — 재시도 버튼이 이걸 다시 보낸다. */
  const failedRef = useRef<{ index: number; patch: Record<string, unknown> } | null>(
    null,
  );

  const send = useCallback(
    async (index: number, patch: Record<string, unknown>) => {
      setSaveState('saving');
      const ok = await patchStepConfig(index, patch);
      if (!ok) {
        failedRef.current = { index, patch };
        setSaveState('error');
        return;
      }
      failedRef.current = null;
      setSaveState('saved');
      // 서버가 받아들인 키는 드래프트에서 내린다 — 이후로는 서버 값이 보인다.
      setDraft((prev) => {
        const step = prev[index];
        if (!step) return prev;
        const rest: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(step)) {
          if (!(k in patch)) rest[k] = v;
        }
        const next = { ...prev };
        if (Object.keys(rest).length === 0) delete next[index];
        else next[index] = rest;
        return next;
      });
    },
    [patchStepConfig],
  );

  const flush = useCallback(() => {
    timerRef.current = 0;
    const buffer = pendingRef.current;
    if (buffer.size === 0) return;
    const entries = [...buffer.entries()];
    buffer.clear();
    for (const [index, patch] of entries) void send(index, patch);
  }, [send]);

  const setField = useCallback(
    (index: number, fieldId: string, value: unknown) => {
      // ① 낙관적 반영 — 카드 요약이 즉시 바뀐다(§4.5).
      setDraft((prev) => ({
        ...prev,
        [index]: { ...(prev[index] ?? {}), [fieldId]: value },
      }));
      // ② 디바운스 버퍼에 **그 필드만** 쌓는다(부분 머지 계약 — 전체 교체로
      //    보내면 교차하는 왕복 2건이 서로를 지운다).
      const buffer = pendingRef.current;
      buffer.set(index, { ...(buffer.get(index) ?? {}), [fieldId]: value });
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  const retry = useCallback(() => {
    const failed = failedRef.current;
    if (!failed) return;
    void send(failed.index, failed.patch);
  }, [send]);

  // 언마운트 시 남은 버퍼를 흘려보낸다 — 마지막 타이핑이 유실되지 않게.
  useEffect(
    () => () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = 0;
      }
    },
    [],
  );

  const configAt = useCallback(
    (index: number): Record<string, unknown> => {
      const server = view?.steps[index]?.config ?? {};
      const local = draft[index];
      if (!local) return server;
      const merged: Record<string, unknown> = { ...server };
      for (const [k, v] of Object.entries(local)) {
        // null = 키 삭제(RFC 7396) — 낙관적 반영도 같은 시맨틱이어야 카드가
        // 서버 반영 전후로 같은 값을 보여준다.
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      return merged;
    },
    [view, draft],
  );

  const open = useCallback((index: number) => setSelected(index), []);
  const close = useCallback(() => setSelected(null), []);
  const toggle = useCallback(
    (index: number) => setSelected((curr) => (curr === index ? null : index)),
    [],
  );
  const go = useCallback(
    (delta: number) =>
      setSelected((curr) => {
        if (curr === null) return curr;
        const next = curr + delta;
        return next >= 0 && next < stepCount ? next : curr;
      }),
    [stepCount],
  );

  const api = useMemo<ChainInspectorApi>(
    () => ({
      selectedIndex,
      toggle,
      open,
      close,
      go,
      configAt,
      setField,
      saveState,
      retry,
    }),
    [selectedIndex, toggle, open, close, go, configAt, setField, saveState, retry],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

// Provider 밖(캔버스 아닌 표면)에서도 안전 — 선택 없음 + no-op.
const INERT: ChainInspectorApi = {
  selectedIndex: null,
  toggle: () => {},
  open: () => {},
  close: () => {},
  go: () => {},
  configAt: () => ({}),
  setField: () => {},
  saveState: 'idle',
  retry: () => {},
};

export function useChainInspector(): ChainInspectorApi {
  return useContext(Ctx) ?? INERT;
}

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

// 통합 프로젝트 기반 — 위젯별 프로젝트 선택 Provider.
//
// 사용자 재확정(2026-07-10): "프로젝트 연동 강제는 안 맞음. 여러 프로젝트에
// 다른 위젯을 쓸 수 있으니 개별 피커. 대신 옵션으로 '전체 적용'." 즉:
//   - 프로젝트 엔티티(목록)는 공유(interview_projects SSOT)
//   - **선택은 위젯별 독립** — 프로빙=프로젝트 A, 통역=프로젝트 B 동시 가능
//   - 강제 sync 없음. 단 1회성 applyToAll("전체 위젯에 적용") 로 한 번에 맞출 수 있음
//     (이후엔 다시 각자 독립 — 상시 동기화가 아니다).
//
// 선택 상태만 여기서 관리한다(어떤 프로젝트를 골랐는지). 프로젝트 목록 자체는
// useInterviewV2Projects, 설정값은 useProjectWidgetSettings 가 담당 — 관심사 분리.
//
// ActiveProjectProvider(active_project:v1) 와는 별개다. 그건 워크스페이스 패널의
// 단일 "활성 프로젝트" 축(전역 1개), 이건 위젯마다 독립 선택(위젯 N개). 키를
// 분리(project_selection:v1)해 서로 간섭하지 않는다.

type SelectionMap = Record<string, string | null>;

type Ctx = {
  // 위젯별 선택된 projectId (없으면 null).
  selection: SelectionMap;
  getSelection: (widget: string) => string | null;
  setSelection: (widget: string, projectId: string | null) => void;
  // 1회성 "전체 적용" — 이미 등장한 모든 위젯 선택을 이 프로젝트로 맞춘다.
  // 이후 각 위젯은 다시 독립적으로 바꿀 수 있다(상시 sync 아님).
  applyToAll: (projectId: string | null) => void;
};

const STORAGE_KEY = 'project_selection:v1';
const ProjectSelectionCtx = createContext<Ctx | null>(null);

function readStored(): SelectionMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    // 값은 string | null 만 허용 — 오염된 항목은 버린다(방어적).
    const out: SelectionMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v === null || typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function ProjectSelectionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selection, setSelectionState] = useState<SelectionMap>({});

  // SSR/CSR hydration 정합을 위해 초기엔 빈 맵으로 렌더하고, mount 후
  // localStorage 에서 채운다(ActiveProjectProvider 와 동일 패턴).
  useEffect(() => {
    const stored = readStored();
    if (Object.keys(stored).length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from storage on mount
      setSelectionState(stored);
    }
  }, []);

  // localStorage 저장은 functional-updater 안에서 계산된 next 를 그대로 쓴다 —
  // ref 를 render 중 건드리지 않으면서(react-hooks/refs) 최신 상태 기준으로
  // merge/persist 한다. (idempotent write 라 StrictMode 이중 호출도 무해.)
  const setSelection = useCallback(
    (widget: string, projectId: string | null) => {
      setSelectionState((prev) => {
        const next = { ...prev, [widget]: projectId };
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore — 선택은 편의 기능, 저장 실패해도 세션 내 동작은 유지.
        }
        return next;
      });
    },
    [],
  );

  const getSelection = useCallback(
    (widget: string) => selection[widget] ?? null,
    [selection],
  );

  const applyToAll = useCallback((projectId: string | null) => {
    // 1회성: 지금까지 한 번이라도 선택된 위젯 키 전부를 이 프로젝트로 맞춘다.
    // 아직 등장 안 한 위젯은 자기가 처음 setSelection 할 때 독립적으로 정해진다.
    setSelectionState((prev) => {
      const next: SelectionMap = {};
      for (const key of Object.keys(prev)) next[key] = projectId;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const value = useMemo<Ctx>(
    () => ({ selection, getSelection, setSelection, applyToAll }),
    [selection, getSelection, setSelection, applyToAll],
  );

  return (
    <ProjectSelectionCtx.Provider value={value}>
      {children}
    </ProjectSelectionCtx.Provider>
  );
}

// Provider 밖에서 호출돼도 죽지 않게 no-op fallback 을 돌려준다(디자인 시스템
// 데모/스토리 등 격리 렌더 대비). 실제 앱 트리에서는 layout 이 Provider 를 감싼다.
export function useProjectSelection(): Ctx {
  const ctx = useContext(ProjectSelectionCtx);
  if (!ctx) {
    return {
      selection: {},
      getSelection: () => null,
      setSelection: () => {},
      applyToAll: () => {},
    };
  }
  return ctx;
}

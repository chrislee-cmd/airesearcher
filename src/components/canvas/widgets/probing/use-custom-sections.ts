'use client';

/* ────────────────────────────────────────────────────────────────────
   useCustomSections — 프로빙 페르소나의 사용자 정의 custom 섹션 관리.

   PR (probing-custom-section-ui): 우패널 KRQ 필드를 대체하는 "위젯" 방식.
   사용자가 title + 조사목적(description) 으로 custom 섹션을 정의하면 좌패널
   페르소나 grid 에 기본 8 섹션과 동일하게 노출되고 인터뷰 중 실시간으로
   채워진다.

   영속화: localStorage (세션 단위 — 탭 close 후 재방문 시 복원). DB 가 아닌
   이유는 이 섹션 정의가 사용자의 조사 셋업이지 인터뷰 결과가 아니고, 기기별
   조사 설계 차이를 허용하기 위함 (spec: "session 단위 localStorage").

   key = crypto.randomUUID() — 기본 8 key 와 절대 충돌하지 않으며 catchall
   object 응답에서 additive key 로 식별 가능.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProbingCustomSection } from '../probing-types';

const STORAGE_KEY = 'probing:custom-sections:v1';
// backend Body 스키마 상한과 정합 (reflection route: max 16 / key 64 / title
// 120 / description 1000).
const MAX_SECTIONS = 16;
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 1000;

function isValidSection(v: unknown): v is ProbingCustomSection {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.key === 'string' &&
    o.key.length > 0 &&
    typeof o.title === 'string' &&
    o.title.length > 0 &&
    (o.description === undefined || typeof o.description === 'string')
  );
}

function loadFromStorage(): ProbingCustomSection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidSection).slice(0, MAX_SECTIONS);
  } catch {
    return [];
  }
}

export type UseCustomSections = {
  sections: ProbingCustomSection[];
  hydrated: boolean;
  // 생성된 섹션의 key 를 반환 (backfill 대상 지정용). 빈 title / 상한 초과로
  // 생성 안 되면 null.
  add: (title: string, description?: string) => string | null;
  remove: (key: string) => void;
};

export function useCustomSections(): UseCustomSections {
  // sections + hydrated 를 단일 state 로 — mount hydrate 를 setState 1회로
  // 처리 (react-hooks/set-state-in-effect 최소화). hydrated 이전엔 저장 skip
  // 해 초기 빈 배열이 localStorage 를 덮지 않도록.
  const [state, setState] = useState<{
    sections: ProbingCustomSection[];
    hydrated: boolean;
  }>({ sections: [], hydrated: false });

  // mount 시 1회 — localStorage hydrate. SSR 안전 (client hook, 'use client').
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from storage on mount
    setState({ sections: loadFromStorage(), hydrated: true });
  }, []);

  // 변경 시 저장 (hydrate 이후에만).
  const hydratedRef = useRef(state.hydrated);
  useEffect(() => {
    hydratedRef.current = state.hydrated;
  }, [state.hydrated]);

  // add 가 상한 도달 여부를 동기적으로 판정해 정확한 반환값(key | null)을
  // 주도록 현재 섹션 수를 ref 로 추적. add 는 사용자 클릭당 1회라 렌더 지연
  // 으로 인한 stale 위험은 사실상 없다 (functional setState 가드가 실제 상한
  // 을 최종 보장).
  const countRef = useRef(state.sections.length);
  useEffect(() => {
    countRef.current = state.sections.length;
  }, [state.sections.length]);
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.sections));
    } catch {
      // best-effort — quota 초과 등은 조용히 무시.
    }
  }, [state.sections]);

  const add = useCallback(
    (title: string, description?: string): string | null => {
      const t = title.trim().slice(0, TITLE_MAX);
      if (!t) return null;
      const d = description?.trim().slice(0, DESCRIPTION_MAX) || undefined;
      if (countRef.current >= MAX_SECTIONS) return null;
      // key 를 setState 밖에서 미리 생성해 caller 에 반환한다. backfill 대상
      // 지정에 이 key 가 즉시 필요하다.
      const key =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `cs_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      setState((prev) => {
        if (prev.sections.length >= MAX_SECTIONS) return prev;
        return {
          ...prev,
          sections: [...prev.sections, { key, title: t, description: d }],
        };
      });
      return key;
    },
    [],
  );

  const remove = useCallback((key: string) => {
    setState((prev) => ({
      ...prev,
      sections: prev.sections.filter((s) => s.key !== key),
    }));
  }, []);

  return { sections: state.sections, hydrated: state.hydrated, add, remove };
}

export { MAX_SECTIONS as CUSTOM_SECTION_MAX };

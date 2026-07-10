'use client';

/* ────────────────────────────────────────────────────────────────────
   useProbingPersonaConfig — 프로빙 페르소나 섹션 구성의 프로젝트별 소스 스위치.

   PR (#542 probing-project-scoped-persona): 페르소나 구성(custom 섹션 정의 +
   기본 8 개별 숨김)을 **선택된 프로젝트별로** 분리한다. 사용자 결정 —
   "프로빙에 프로젝트 설정 드롭다운 → 프로젝트별로 페르소나 섹션 구성이 달라지게".

   두 소스를 하나의 인터페이스로 합친다:
     - 프로젝트 미선택(projectId=null) → 기존 localStorage (useCustomSections +
       useHiddenDefaults) 그대로. 하위호환 + 기기별 셋업 유지, 데이터 손실 0.
     - 프로젝트 선택 → 그 프로젝트의 project_widget_settings('probing')
       settings = { customSections, hiddenKeys } 를 DB read/write
       (useProjectWidgetSettings). 프로젝트 전환 시 그 config 로 재로드.

   반환 인터페이스는 옛 두 훅의 합집합과 동일한 shape 이라 소비부
   (probing-card / control-board / reflection-pane / persona-section-
   configurator) 의 렌더·요청·적재 로직은 무변경 — config 소스만 프로젝트별로
   스위칭한다.

   ※ localStorage → DB 자동 seed 는 하지 않는다(보수적). 프로젝트를 처음 고르면
   그 프로젝트 config 는 빈 상태에서 시작하고, 프로젝트 미선택으로 돌아오면 기존
   localStorage config 가 그대로 복원된다(양쪽 독립, 손실 0).
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useMemo, useState } from 'react';
import type { ProbingCustomSection } from '../probing-types';
import { useCustomSections, CUSTOM_SECTION_MAX } from './use-custom-sections';
import { useHiddenDefaults } from './use-hidden-defaults';
import { useProjectWidgetSettings } from '@/hooks/use-project-widget-settings';

const WIDGET = 'probing';
// use-custom-sections / reflection route 스키마 상한과 정합.
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

// DB settings jsonb 는 자유 스키마라 방어적으로 파싱한다 — 오염/부분 데이터가
// 렌더를 깨지 않도록 (use-custom-sections.loadFromStorage 와 동일 방침).
function parseSections(raw: unknown): ProbingCustomSection[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isValidSection)
    .map((s) => ({
      key: s.key,
      title: s.title.slice(0, TITLE_MAX),
      description: s.description?.slice(0, DESCRIPTION_MAX) || undefined,
    }))
    .slice(0, CUSTOM_SECTION_MAX);
}

function parseHidden(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((k): k is string => typeof k === 'string');
}

function genKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `cs_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export type UseProbingPersonaConfig = {
  customSections: ProbingCustomSection[];
  customSectionsHydrated: boolean;
  hiddenDefaultKeys: Set<string>;
  hiddenDefaultsHydrated: boolean;
  addCustomSection: (title: string, description?: string) => string | null;
  removeCustomSection: (key: string) => void;
  hideDefault: (key: string) => void;
  restoreDefault: (key: string) => void;
  restoreAll: () => void;
};

export function useProbingPersonaConfig(
  projectId: string | null,
): UseProbingPersonaConfig {
  // 두 로컬 훅은 항상 호출한다(hook 규칙) — projectId=null 일 때만 실제 소스로,
  // 아닐 땐 대기 상태로 존재.
  const local = useCustomSections();
  const localHidden = useHiddenDefaults();
  const { settings, save, loading } = useProjectWidgetSettings(
    projectId,
    WIDGET,
  );
  const projectMode = !!projectId;

  // DB settings → 정규화. settings 정체성이 바뀔 때만 재계산(load/save/전환).
  const dbCustom = useMemo(
    () => parseSections(settings.customSections),
    [settings],
  );
  const dbHidden = useMemo(
    () => new Set(parseHidden(settings.hiddenKeys)),
    [settings],
  );

  // 프로젝트 모드의 낙관적 working copy. DB settings 정체성이 바뀌면(프로젝트
  // 전환·reload·save 후 서버 echo) draft 를 서버 값으로 재동기 — effect 안
  // setState 를 피하려 render 중 비교 동기화(control-board goalDraft 와 동일 패턴).
  const [draftCustom, setDraftCustom] = useState<ProbingCustomSection[]>(dbCustom);
  const [draftHidden, setDraftHidden] = useState<Set<string>>(dbHidden);
  const [syncedSettings, setSyncedSettings] = useState(settings);
  if (settings !== syncedSettings) {
    setSyncedSettings(settings);
    setDraftCustom(dbCustom);
    setDraftHidden(dbHidden);
  }

  // 프로젝트 모드 저장 — DB 에 { customSections, hiddenKeys } 전체를 PUT.
  const persist = useCallback(
    (nextCustom: ProbingCustomSection[], nextHidden: Set<string>) => {
      void save({ customSections: nextCustom, hiddenKeys: [...nextHidden] });
    },
    [save],
  );

  const addCustomSection = useCallback(
    (title: string, description?: string): string | null => {
      if (!projectMode) return local.add(title, description);
      const t = title.trim().slice(0, TITLE_MAX);
      if (!t) return null;
      const d = description?.trim().slice(0, DESCRIPTION_MAX) || undefined;
      if (draftCustom.length >= CUSTOM_SECTION_MAX) return null;
      const key = genKey();
      const next = [...draftCustom, { key, title: t, description: d }];
      setDraftCustom(next);
      persist(next, draftHidden);
      return key;
    },
    [projectMode, local, draftCustom, draftHidden, persist],
  );

  const removeCustomSection = useCallback(
    (key: string) => {
      if (!projectMode) return local.remove(key);
      const next = draftCustom.filter((s) => s.key !== key);
      setDraftCustom(next);
      persist(next, draftHidden);
    },
    [projectMode, local, draftCustom, draftHidden, persist],
  );

  const hideDefault = useCallback(
    (key: string) => {
      if (!projectMode) return localHidden.hide(key);
      if (draftHidden.has(key)) return;
      const next = new Set(draftHidden);
      next.add(key);
      setDraftHidden(next);
      persist(draftCustom, next);
    },
    [projectMode, localHidden, draftCustom, draftHidden, persist],
  );

  const restoreDefault = useCallback(
    (key: string) => {
      if (!projectMode) return localHidden.restore(key);
      if (!draftHidden.has(key)) return;
      const next = new Set(draftHidden);
      next.delete(key);
      setDraftHidden(next);
      persist(draftCustom, next);
    },
    [projectMode, localHidden, draftCustom, draftHidden, persist],
  );

  const restoreAll = useCallback(() => {
    if (!projectMode) return localHidden.restoreAll();
    if (draftHidden.size === 0) return;
    const next = new Set<string>();
    setDraftHidden(next);
    persist(draftCustom, next);
  }, [projectMode, localHidden, draftCustom, persist, draftHidden.size]);

  // 프로젝트 모드 hydrated = 첫 로드 완료(!loading). 로컬 모드는 두 훅의 hydrate.
  return {
    customSections: projectMode ? draftCustom : local.sections,
    customSectionsHydrated: projectMode ? !loading : local.hydrated,
    hiddenDefaultKeys: projectMode ? draftHidden : localHidden.hiddenKeys,
    hiddenDefaultsHydrated: projectMode ? !loading : localHidden.hydrated,
    addCustomSection,
    removeCustomSection,
    hideDefault,
    restoreDefault,
    restoreAll,
  };
}

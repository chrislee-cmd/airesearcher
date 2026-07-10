'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// 통합 프로젝트 기반 — 위젯별 프로젝트 설정 훅.
//
// GET/PUT /api/projects/[projectId]/settings/[widget] 위의 얇은 클라이언트.
// use-interview-v2-projects 와 같은 컨벤션(SWR 미도입 — 이 repo 에 의존성 없음,
// 보수적으로 새 패키지 안 늘림 · plain fetch + 로컬 캐시 + 명시적 refetch)을 따른다.
//
// project 미선택(null)이면 no-op: fetch 안 하고 빈 설정을 돌려주며 save 는 무시.
// 위젯은 프로젝트가 없을 때도 렌더돼야 하므로(피커에서 고르기 전) 훅이 방어한다.

export type WidgetSettings = Record<string, unknown>;

export function useProjectWidgetSettings(
  projectId: string | null,
  widget: string,
) {
  const [settings, setSettings] = useState<WidgetSettings>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // race 방지 — projectId/widget 이 바뀌는 사이 늦게 도착한 이전 응답이
  // 새 선택의 설정을 덮어쓰지 않게 요청 세대를 센다.
  const reqSeq = useRef(0);

  const load = useCallback(async () => {
    if (!projectId) {
      setSettings({});
      setSavedAt(null);
      setError(null);
      setLoading(false);
      return;
    }
    const seq = ++reqSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/settings/${widget}`,
      );
      if (!res.ok) throw new Error(`load_failed_${res.status}`);
      const j = (await res.json()) as {
        settings?: WidgetSettings;
        updated_at?: string | null;
      };
      if (seq !== reqSeq.current) return; // stale — 새 선택이 이미 시작됨
      setSettings(j.settings ?? {});
      setSavedAt(j.updated_at ?? null);
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setError(e instanceof Error ? e : new Error('load_failed'));
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [projectId, widget]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reflect async fetch result
    void load();
  }, [load]);

  // 설정 저장 — PUT 후 서버가 돌려준 정규화된 값으로 로컬을 맞춘다. project
  // 미선택이면 조용히 no-op(false 반환)해 caller 가 "저장할 프로젝트 없음" 을 안다.
  const save = useCallback(
    async (next: WidgetSettings): Promise<boolean> => {
      if (!projectId) return false;
      setError(null);
      try {
        const res = await fetch(
          `/api/projects/${projectId}/settings/${widget}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings: next }),
          },
        );
        if (!res.ok) throw new Error(`save_failed_${res.status}`);
        const j = (await res.json()) as {
          settings?: WidgetSettings;
          updated_at?: string | null;
        };
        setSettings(j.settings ?? next);
        setSavedAt(j.updated_at ?? null);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e : new Error('save_failed'));
        return false;
      }
    },
    [projectId, widget],
  );

  return { settings, save, loading, error, savedAt, reload: load };
}

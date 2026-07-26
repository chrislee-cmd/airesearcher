'use client';

/* ────────────────────────────────────────────────────────────────────
   JourneyScheduleTab — recruiting 저니 셸 탭③ 일정(Schedule).

   데이터 컨테이너: form-anchor 로 `/api/scheduling/journey/schedule` 를
   페치(P0 프로비저닝 소비 — 오픈 시 form→project lazy resolve)해 캘린더+
   채팅+로스터 표면(JourneySchedulingSurface)에 공급한다. mutation(슬롯
   저장/삭제·그룹 rename) 뒤엔 refetch 로 재조회(라이브의 router.refresh()
   대체 — 저니 풀뷰는 클라 페치라 서버 refresh 가 안 먹음).

   상태: 로딩 · 에러(재시도) · empty(아직 일정 없음, N5 스타일) · populated.
   탭③ 는 내부 스크롤 소유(1600×940 프레임 안, D2) — 표면 컴포넌트가 소유.

   재사용(로직/데이터/프레젠테이션): scheduling 캘린더/채팅/로스터/슬롯에디터
   전부 라이브 recsched 컴포넌트 그대로(보존 계약 회귀 0).
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/ui/empty-state';
import { BrandLoader } from '@/components/ui/brand-loader';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/toast-provider';
import type { SchedSlot } from '@/lib/scheduling/slots';
import {
  JourneySchedulingSurface,
  type JourneyScheduleCandidate,
  type JourneyScheduleGroup,
  type JourneyScheduleProject,
} from './journey-scheduling-surface';

// The /api/scheduling/journey/schedule bundle. Candidates arrive with source-
// based contact masking already server-enforced; `fields`/`batch_id` may be null
// on a narrow (preview-DB) read → normalized on ingest.
type ScheduleBundle = {
  project: JourneyScheduleProject;
  groups: JourneyScheduleGroup[];
  candidates: {
    id: string;
    batch_id: string | null;
    email: string | null;
    name: string | null;
    phone: string | null;
    fields: Record<string, string> | null;
    status: string;
    source?: string | null;
  }[];
  slots: SchedSlot[];
};

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; data: LoadedData };

type LoadedData = {
  project: JourneyScheduleProject;
  groups: JourneyScheduleGroup[];
  candidates: JourneyScheduleCandidate[];
  slots: SchedSlot[];
};

export function JourneyScheduleTab({
  formId,
  projectId = null,
}: {
  formId: string | null;
  // Pill (interview_projects) id — form-free schedule anchor (card 583). Lets the
  // 일정 tab render even before a form is published; when both are present the
  // server converges them on one sched project.
  projectId?: string | null;
}) {
  const t = useTranslations('Recruiting.journey');
  const toast = useToast();
  const [state, setState] = useState<LoadState>({ phase: 'loading' });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      // Guarded by the caller (effect / refetch) — never invoked without an anchor.
      if (!formId && !projectId) return;
      try {
        const params = new URLSearchParams();
        if (formId) params.set('form_id', formId);
        if (projectId) params.set('project_id', projectId);
        const res = await fetch(
          `/api/scheduling/journey/schedule?${params.toString()}`,
          { cache: 'no-store', signal },
        );
        if (!res.ok) {
          setState({ phase: 'error' });
          return;
        }
        const bundle = (await res.json()) as ScheduleBundle;
        setState({
          phase: 'ready',
          data: {
            project: bundle.project,
            groups: bundle.groups ?? [],
            candidates: (bundle.candidates ?? []).map((c) => ({
              ...c,
              batch_id: c.batch_id ?? '',
              fields: c.fields ?? {},
            })),
            slots: bundle.slots ?? [],
          },
        });
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        setState({ phase: 'error' });
      }
    },
    [formId, projectId],
  );

  // Mount starts at 'loading' (initial state); the parent keys this component on
  // formId so a form switch remounts it fresh rather than resetting state in an
  // effect (react-hooks/set-state-in-effect). A post-mutation refetch stays
  // silent — it never re-enters loading, so the surface doesn't unmount mid-edit.
  useEffect(() => {
    if (!formId && !projectId) return;
    const ctrl = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load()'s setState calls all fire AFTER `await fetch` (async data load), not a synchronous cascade; the rule can't see through the await in a useCallback fetcher.
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load, formId, projectId]);

  // Client-side re-fetch after a mutation (slot save/delete, group rename) —
  // the journey fullview fetches client-side, so router.refresh() wouldn't
  // re-pull. Silent (no loading flash) so the surface doesn't unmount mid-edit.
  const refetch = useCallback(() => {
    void load();
  }, [load]);

  // No anchor (neither form nor pill) — nothing to anchor a project on. Show the
  // 아직 일정 없음 empty (N5) rather than spinning forever.
  if (!formId && !projectId) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-10">
        <EmptyState
          tone="subtle"
          icon={<span className="text-3xl">🗓️</span>}
          title={t('scheduleEmptyTitle')}
          description={t('scheduleEmptyDesc')}
        />
      </div>
    );
  }

  if (state.phase === 'loading') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-10">
        <BrandLoader label={t('scheduleLoading')} />
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-10">
        <EmptyState
          tone="subtle"
          icon={<span className="text-3xl">⚠️</span>}
          title={t('scheduleErrorTitle')}
          description={t('scheduleErrorDesc')}
          action={
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              {t('scheduleRetry')}
            </Button>
          }
        />
      </div>
    );
  }

  const { project, groups, candidates, slots } = state.data;
  // Nothing bridged/uploaded/scheduled yet → the 아직 일정 없음 empty (N5). Once
  // there's any group/candidate/slot the full calendar+chat+roster surface shows
  // (the calendar is useful even before anyone's confirmed).
  const isEmpty =
    groups.length === 0 && candidates.length === 0 && slots.length === 0;
  if (isEmpty) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-10">
        <EmptyState
          tone="subtle"
          icon={<span className="text-3xl">🗓️</span>}
          title={t('scheduleEmptyTitle')}
          description={t('scheduleEmptyDesc')}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <JourneySchedulingSurface
        project={project}
        groups={groups}
        candidates={candidates}
        slots={slots}
        formId={formId}
        onRefetch={refetch}
        notifyErr={(msg) => toast.push(msg, { tone: 'warn' })}
        notifyOk={(msg) => toast.push(msg, { tone: 'info' })}
      />
    </div>
  );
}

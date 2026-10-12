'use client';

import { useTranslations } from 'next-intl';
import type { DeliverableFeature, DeliverableStatus } from '@/lib/artifacts/types';
import {
  FEATURE_ORDER,
  FEATURE_TONE_BG,
  STATUS_ORDER,
} from './constants';
import { Pressable } from './pressable';

// 240px fixed filter rail (GEOMETRY §A). Feature + Status are facet-backed
// (server counts, all values shown per faceted-search semantics). Project has
// no server facet (GET /api/artifacts returns by_feature / by_status only), so
// it groups by project name without counts — a conservative reading of
// "레일은 프로젝트 그룹핑만" (DECISIONS). Only the selected row draws a border;
// unselected rows are borderless so 12 rows don't compete with the list.
//
// Soft Identity 리브랜드 1단계 — 변환표(풀뷰 사이드바와 같은 규칙): `--surface-2`
// · border-r 1 `--hair` · 선택 행 = 흰 bg + 1px `--line`(그림자 없음). 폭 240 ·
// 행 패딩은 불변.

// 상태 점 — Soft 시그널 dot. 만료/철회 구분과 같은 규칙으로 draft 는 "속 빈 점"
// (흰 면 + 1px --faint 테두리), 나머지는 채운 점(핵심규칙 4).
const STATUS_DOT: Record<DeliverableStatus, string> = {
  ready: 'bg-soft-ok-dot',
  processing: 'bg-soft-run-dot',
  draft: 'bg-soft-surface border border-soft-faint',
  error: 'bg-soft-err-dot',
};

function GroupLabel({ children }: { children: string }) {
  return (
    <div className="mb-2 font-soft-mono text-xs font-bold uppercase tracking-[0.12em] text-soft-faint">
      {children}
    </div>
  );
}

function rowCls(on: boolean): string {
  return `flex cursor-pointer items-center gap-[9px] rounded-nav border px-2.5 py-[7px] transition-colors ${
    on ? 'border-soft-line bg-soft-surface' : 'border-transparent hover:bg-soft-surface'
  }`;
}

function Check({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-picker-check border text-xs text-soft-surface ${
        on ? 'border-ink bg-ink' : 'border-soft-line bg-soft-surface'
      }`}
    >
      {on ? '✓' : ''}
    </span>
  );
}

function Count({ children }: { children: string }) {
  return <span className="font-soft-mono text-sm text-soft-faint">{children}</span>;
}

export function FilterRail({
  featureFacets,
  statusFacets,
  projects,
  selectedFeature,
  selectedStatus,
  selectedProject,
  onFeature,
  onStatus,
  onProject,
}: {
  featureFacets: Record<string, number>;
  statusFacets: Record<string, number>;
  projects: { id: string; name: string }[];
  selectedFeature: DeliverableFeature | null;
  selectedStatus: DeliverableStatus | null;
  selectedProject: string | null;
  onFeature: (f: DeliverableFeature | null) => void;
  onStatus: (s: DeliverableStatus | null) => void;
  onProject: (id: string | null) => void;
}) {
  const t = useTranslations('Library');

  return (
    <div className="flex w-[240px] shrink-0 flex-col gap-[18px] overflow-y-auto border-r border-soft-hair bg-soft-surface-2 px-3.5 py-4">
      <div>
        <GroupLabel>{t('rail.feature')}</GroupLabel>
        <div className="flex flex-col gap-0.5">
          {FEATURE_ORDER.map((f) => {
            const on = selectedFeature === f;
            return (
              <Pressable
                key={f}
                onPress={() => onFeature(on ? null : f)}
                className={rowCls(on)}
                ariaLabel={t(`feature.${f}`)}
              >
                <Check on={on} />
                <span
                  className={`h-[9px] w-[9px] shrink-0 rounded-full ${FEATURE_TONE_BG[f]}`}
                />
                <span className={`flex-1 text-md ${on ? 'font-bold text-ink' : 'font-medium text-soft-mute'}`}>
                  {t(`feature.${f}`)}
                </span>
                <Count>{String(featureFacets[f] ?? 0)}</Count>
              </Pressable>
            );
          })}
        </div>
      </div>

      <div>
        <GroupLabel>{t('rail.status')}</GroupLabel>
        <div className="flex flex-col gap-0.5">
          {STATUS_ORDER.map((s) => {
            const on = selectedStatus === s;
            return (
              <Pressable
                key={s}
                onPress={() => onStatus(on ? null : s)}
                className={rowCls(on)}
                ariaLabel={t(`status.${s}`)}
              >
                <Check on={on} />
                <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[s]}`} />
                <span className={`flex-1 text-md ${on ? 'font-bold text-ink' : 'font-medium text-soft-mute'}`}>
                  {t(`status.${s}`)}
                </span>
                <Count>{String(statusFacets[s] ?? 0)}</Count>
              </Pressable>
            );
          })}
        </div>
      </div>

      <div>
        <GroupLabel>{t('rail.project')}</GroupLabel>
        <div className="flex flex-col gap-0.5">
          <Pressable
            onPress={() => onProject(null)}
            className={`flex cursor-pointer items-center gap-2 rounded-nav px-2.5 py-[7px] ${
              selectedProject === null ? 'bg-lav' : ''
            }`}
            ariaLabel={t('rail.allProjects')}
          >
            <span className="text-md">🗂</span>
            <span
              className={`flex-1 truncate text-md ${
                selectedProject === null ? 'font-bold text-ink' : 'font-medium text-soft-mute'
              }`}
            >
              {t('rail.allProjects')}
            </span>
          </Pressable>
          {projects.map((p) => {
            const on = selectedProject === p.id;
            return (
              <Pressable
                key={p.id}
                onPress={() => onProject(on ? null : p.id)}
                className={`flex cursor-pointer items-center gap-2 rounded-nav px-2.5 py-[7px] ${
                  on ? 'bg-lav' : ''
                }`}
                ariaLabel={p.name}
              >
                <span className="text-md">📁</span>
                <span
                  className={`flex-1 truncate text-md ${
                    on ? 'font-bold text-ink' : 'font-medium text-soft-mute'
                  }`}
                >
                  {p.name}
                </span>
              </Pressable>
            );
          })}
        </div>
      </div>

      <div className="mt-auto rounded-control border border-soft-line bg-soft-surface px-3 py-2.5">
        <p className="text-sm leading-relaxed text-soft-mute">{t('rail.note')}</p>
      </div>
    </div>
  );
}

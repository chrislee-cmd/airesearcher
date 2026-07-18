'use client';

/* ────────────────────────────────────────────────────────────────────
   ReflectionPane — probing 위젯 좌패널 (PR: probing-persona-panels).

   초기 PR (probing-two-pane-reflection) 의 3 섹션 markdown bullet 표시
   를 **페르소나 한판 8 패널 그리드** 로 재편. 각 패널 = PersonaPanel
   primitive. transcript 가 빈약한 섹션은 confidence='insufficient' 의
   placeholder 톤으로 의도된 빈 칸임을 시각화.

   생성 / 갱신 트리거 / 데이터는 부모 (probing-card.tsx) 가 소유. 이
   컴포넌트는 순수 표시 + "지금 갱신" 액션만 노출.
   ──────────────────────────────────────────────────────────────────── */

import type { Ref } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { SectionLabel } from '@/components/canvas/shell/widget-outputs';
import type {
  ProbingPersona,
  ProbingPersonaSection,
} from '@/lib/probing-prompts';
import type { ProbingCustomSection } from '../probing-types';
import { PersonaPanel } from './persona-panel';
import {
  DEFAULT_PERSONA_PANELS,
  CUSTOM_PANEL_ICON,
} from './persona-section-meta';

// 위젯 전반 (probing-card.tsx 등) 에서 동일 타입을 import 하므로 그대로 export.
export type ProbingReflectionData = Partial<ProbingPersona>;

export type ReflectionStatus = 'idle' | 'streaming' | 'ready' | 'error';

// 그리드 순서 SSOT = persona-section-meta (컨트롤 패널 구성기와 공유).
// PR (probing-persona-section-configurator #470): 섹션 구성 (숨김/추가/삭제)
// 은 컨트롤 패널 구성기로 이전 — 이 패널은 활성 섹션을 순수 표시만 한다.
const PANELS = DEFAULT_PERSONA_PANELS;

const memphisPlaceholderStyle = {
  border: '2px solid var(--canvas-card-border)',
  borderRadius: 'var(--sidebar-nav-radius)',
  boxShadow: 'var(--memphis-shadow-xs)',
} as const;

type ProbingT = ReturnType<typeof useTranslations>;

function formatRelative(
  epochMs: number | null,
  nowMs: number,
  t: ProbingT,
): string {
  if (epochMs === null || !Number.isFinite(epochMs)) return '';
  const diff = Math.max(0, nowMs - epochMs);
  if (diff < 30_000) return t('persona.updatedJustNow');
  if (diff < 60 * 60_000)
    return t('persona.updatedMinutesAgo', { n: Math.floor(diff / 60_000) });
  if (diff < 24 * 60 * 60_000)
    return t('persona.updatedHoursAgo', { n: Math.floor(diff / 3_600_000) });
  return t('persona.updatedDaysAgo', { n: Math.floor(diff / 86_400_000) });
}

function sectionOrNull(
  data: ProbingReflectionData | null,
  key: string,
): ProbingPersonaSection | null {
  if (!data) return null;
  const v = (data as Record<string, ProbingPersonaSection | undefined>)[key];
  if (!v || typeof v !== 'object') return null;
  return v as ProbingPersonaSection;
}

export function ReflectionPane({
  data,
  status,
  lastUpdatedAt,
  nowMs,
  error,
  canRefresh,
  onRefresh,
  isLive,
  hasTranscript,
  customSections,
  hiddenKeys,
  gridRef,
  recentKeys,
}: {
  data: ProbingReflectionData | null;
  status: ReflectionStatus;
  lastUpdatedAt: number | null;
  nowMs: number;
  error: string | null;
  canRefresh: boolean;
  onRefresh: () => void;
  isLive: boolean;
  hasTranscript: boolean;
  // custom 섹션 (PR: probing-custom-section-ui) — 기본 9 패널 뒤에 append.
  // PR (probing-persona-section-configurator #470): 추가/삭제 컨트롤은 컨트롤
  // 패널 구성기로 이전 — 여기선 활성 custom 섹션을 표시만 한다.
  customSections: ProbingCustomSection[];
  // 활성 섹션 필터 — hiddenKeys 에 든 기본 key 는 grid 에서 제외 (컨트롤 패널
  // 구성기에서 off 처리). 표시 전용 필터, 토글 UI 는 여기 없다.
  hiddenKeys: Set<string>;
  // PDF 내보내기 (PR: probing-pdf-export-persona-only) — 페르소나 grid DOM 을
  // 캡쳐 대상으로 노출. 부모(probing-card.tsx)가 이 ref 로 grid 만 PDF 화한다.
  gridRef?: Ref<HTMLDivElement>;
  // 방금 주입/추가된 위젯 key — 마운트 시 ephemeral 하이라이트 (없으면 미표시).
  recentKeys?: Set<string>;
}) {
  const t = useTranslations('Probing');
  const stamp = formatRelative(lastUpdatedAt, nowMs, t);
  const headerLabel =
    status === 'streaming'
      ? t('persona.updating')
      : stamp || (status === 'error' ? t('persona.updateFailed') : t('persona.waiting'));

  // data 가 있으면 그리드 표시. partial 스트림 동안에는 일부 섹션이 아직 빈
  // 객체일 수 있는데 sectionOrNull 가 그 경우 insufficient placeholder 로 떨군다.
  const hasAnyPanelData = data !== null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line-soft px-4 py-2.5">
        <div className="flex items-center gap-2">
          <SectionLabel>{t('persona.heading')}</SectionLabel>
          <span className="text-xs text-mute-soft">· {headerLabel}</span>
        </div>
        <Button
          variant="secondary"
          size="xs"
          onClick={onRefresh}
          disabled={!canRefresh}
          loading={status === 'streaming'}
          loadingLabel={t('persona.updating')}
          className="uppercase tracking-[0.18em]"
        >
          {t('persona.refreshNow')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {hasAnyPanelData ? (
          <div ref={gridRef} className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {/* 활성 기본 섹션 (hiddenKeys 제외) + custom 섹션 순수 표시.
                섹션 구성 (추가/삭제/숨김) 은 컨트롤 패널 구성기가 소유
                (PR #470) — 여기 × / 추가 카드는 제거됐다. */}
            {PANELS.filter((p) => !hiddenKeys.has(p.key)).map((p) => (
              <PersonaPanel
                key={p.key}
                icon={p.icon}
                title={t(`personaSection.${p.key}`)}
                section={sectionOrNull(data, p.key)}
              />
            ))}
            {customSections.map((c) => (
              <PersonaPanel
                key={c.key}
                icon={CUSTOM_PANEL_ICON}
                title={c.title}
                section={sectionOrNull(data, c.key)}
                highlight={recentKeys?.has(c.key)}
              />
            ))}
          </div>
        ) : status === 'streaming' ? (
          <div
            className="bg-paper px-4 py-6 text-center text-md text-ink-2"
            style={memphisPlaceholderStyle}
          >
            {t('persona.generating')}
          </div>
        ) : !isLive ? (
          <div
            className="bg-paper px-4 py-6 text-center text-md text-ink-2"
            style={memphisPlaceholderStyle}
          >
            {t('persona.emptyNotLive')}
          </div>
        ) : !hasTranscript ? (
          <div
            className="bg-paper px-4 py-6 text-center text-md text-ink-2"
            style={memphisPlaceholderStyle}
          >
            {t('persona.emptyNoTranscript')}
          </div>
        ) : (
          <div
            className="bg-paper px-4 py-6 text-center text-md text-ink-2"
            style={memphisPlaceholderStyle}
          >
            {t('persona.emptyLive')}
          </div>
        )}

        {error && (
          <div
            className="mt-3 bg-paper px-3 py-2 text-sm text-warning"
            style={{
              border: '2px solid var(--color-warning)',
              borderRadius: 'var(--sidebar-nav-radius)',
              // DS-2: 2px-warning offset 은 memphis 토큰 없음(md-warning=3px). 시각 불변 위해 인라인 유지.
              boxShadow: '2px 2px 0 var(--color-warning)',
            }}
          >
            {t('persona.generateFailed', { error })}
          </div>
        )}
      </div>
    </div>
  );
}

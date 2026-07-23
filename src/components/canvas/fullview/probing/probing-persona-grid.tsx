'use client';

/* ────────────────────────────────────────────────────────────────────
   ProbingPersonaGrid — 풀뷰 V2 Probing body 좌측 영역 (CD state 01 좌 flex:5).
   design-handoff/FULLVIEW-SHELL.md §F4 Probing · Widget Fullview Comps.dc.html.

   fresh 신규 빌드 (레거시 reflection-pane / persona-panel 은 supersede — 편집·
   재사용 금지). 데이터(ProbingReflectionData)·섹션 메타(DEFAULT_PERSONA_PANELS)·
   i18n(personaSection.*) 만 재사용한다.

   §F4 계약:
   - filled 카드: border-2 ink · rounded-[--fv-radius-card] · paper ·
     shadow-memphis-sm-faint.
   - empty 카드: border 1.6 dashed line-empty · paper-soft.
   - fill dots = signals count (≤3 정규화): 3=success · 2=amber · 1/0=line-empty.
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import type { Ref } from 'react';
import type {
  ProbingPersona,
  ProbingPersonaSection,
} from '@/lib/probing-prompts';
import type { ProbingCustomSection } from '../../widgets/probing-types';
import {
  DEFAULT_PERSONA_PANELS,
  CUSTOM_PANEL_ICON,
} from '../../widgets/probing/persona-section-meta';

// probing-card 가 내려주는 페르소나 데이터 — 섹션 key → section (partial 스트림).
export type ProbingReflectionData = Partial<ProbingPersona>;

function sectionOf(
  data: ProbingReflectionData | null,
  key: string,
): ProbingPersonaSection | null {
  if (!data) return null;
  const v = (data as Record<string, ProbingPersonaSection | undefined>)[key];
  return v && typeof v === 'object' ? v : null;
}

// 채워진 신호(bullet 있는 것) 수 — fill dots 매핑 소스.
function signalCountOf(section: ProbingPersonaSection | null): number {
  if (!section) return 0;
  return (section.signals ?? []).filter(
    (s) => (s?.bullet?.trim().length ?? 0) > 0,
  ).length;
}

// "채워짐" 판정 — persona-panel 의 isInsufficient 와 정합 (confidence
// insufficient 이고 내용 없으면 empty). conflicts 있으면 채워진 것으로 본다.
function isFilled(section: ProbingPersonaSection | null): boolean {
  if (!section) return false;
  const summary = section.summary?.trim() ?? '';
  const signals = signalCountOf(section);
  const conflicts = (section.conflicts ?? []).filter(
    (c) =>
      (c?.prior?.trim().length ?? 0) > 0 || (c?.current?.trim().length ?? 0) > 0,
  ).length;
  if (conflicts > 0) return true;
  if (section.confidence === 'insufficient') return false;
  return summary.length > 0 || signals > 0;
}

// fill dots 문자열 + 색 — signals count(≤3). 3=success·2=amber·1/0=line-empty.
function fillDots(count: number): { glyph: string; colorClass: string } {
  const filled = Math.min(3, Math.max(0, count));
  const glyph = '●'.repeat(filled) + '○'.repeat(3 - filled);
  const colorClass =
    filled >= 3 ? 'text-success' : filled === 2 ? 'text-amber' : 'text-line-empty';
  return { glyph, colorClass };
}

function PersonaCard({
  icon,
  title,
  section,
  questionCount,
  onClick,
}: {
  icon: string;
  title: string;
  section: ProbingPersonaSection | null;
  // PR (probing-question-history-per-widget): 이 위젯에 누적된 질문 수. >0 이면
  // 카드가 클릭 가능해지고(팝업으로 누적 질문 노출) 💬 뱃지를 표시.
  questionCount: number;
  onClick: () => void;
}) {
  const t = useTranslations('Widgets');
  const tp = useTranslations('Probing');
  const filled = isFilled(section);
  const count = signalCountOf(section);
  const { glyph, colorClass } = fillDots(count);
  const summary = section?.summary?.trim() ?? '';
  const signals = (section?.signals ?? []).filter(
    (s) => (s?.bullet?.trim().length ?? 0) > 0,
  );
  const clickable = questionCount > 0;

  const surfaceClass = `flex min-h-[112px] flex-col rounded-[var(--fv-radius-card)] p-[13px] text-left ${
    filled
      ? 'border-2 border-ink bg-paper shadow-memphis-sm-faint'
      : 'border-[1.6px] border-dashed border-line-empty bg-paper-soft'
  } ${clickable ? 'cursor-pointer transition-transform duration-150 hover:-translate-y-[1px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amore' : ''}`;

  const inner = (
    <>
      <div className="mb-2 flex items-center gap-[7px]">
        <span aria-hidden className="text-xl leading-none">
          {icon}
        </span>
        <span className="flex-1 truncate text-xs font-bold uppercase tracking-[0.15em] text-mute-soft">
          {title}
        </span>
        {questionCount > 0 && (
          <span className="flex shrink-0 items-center gap-[3px] rounded-full border border-amore bg-amore-bg px-[7px] py-[1px] font-mono-label text-xs leading-none text-amore">
            <span aria-hidden>💬</span>
            {questionCount}
          </span>
        )}
        <span
          className={`font-mono-label text-sm leading-none tracking-[1px] ${colorClass}`}
          aria-hidden
        >
          {glyph}
        </span>
      </div>
      {filled ? (
        <div className="text-md leading-relaxed text-ink-2">
          {summary.length > 0 ? (
            <p>{summary}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-mute">
              {signals.slice(0, 3).map((s, i) => (
                <li key={i}>· {s.bullet}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-md italic leading-relaxed text-mute-soft">
          {t('probingInsufficientHint')}
        </p>
      )}
    </>
  );

  if (!clickable) {
    return <div className={surfaceClass}>{inner}</div>;
  }
  // 클릭 가능한 위젯 카드 — 누적 질문 팝업 트리거. 대형 카드 표면 전체가 탭
  // 타깃이라 IconButton primitive 로는 표현 불가(레이아웃/보더/그림자를 카드가
  // 소유). data-canvas-action 으로 globals [data-canvas-body] cascade opt-out.
  return (
    // eslint-disable-next-line react/forbid-elements -- full-card click target opening the per-widget questions popup; primitive Button forces capsule shape/centered text incompatible with this content card. Tokens preserved.
    <button
      type="button"
      onClick={onClick}
      data-canvas-action
      aria-label={tp('fv.widgetQuestions', { n: questionCount })}
      className={surfaceClass}
    >
      {inner}
    </button>
  );
}

export function ProbingPersonaGrid({
  data,
  customSections,
  hiddenKeys,
  isLive,
  hasTranscript,
  gridRef,
  questionCounts,
  onSectionClick,
}: {
  data: ProbingReflectionData | null;
  customSections: ProbingCustomSection[];
  hiddenKeys: Set<string>;
  isLive: boolean;
  hasTranscript: boolean;
  // PDF 캡쳐 대상 grid DOM (probing-card 가 전달) — 페르소나 그리드만 캡쳐.
  gridRef?: Ref<HTMLDivElement>;
  // PR (probing-question-history-per-widget): section key → 누적 질문 수.
  questionCounts: Map<string, number>;
  onSectionClick: (key: string) => void;
}) {
  const t = useTranslations('Probing');
  const hasAnyPanel = data !== null;

  return (
    <div className="flex min-h-0 flex-[5] flex-col overflow-y-auto border-r-2 border-ink p-[18px]">
      <div className="mb-3 font-mono-label text-xs font-bold uppercase tracking-[1px] text-mute-soft">
        {t('fv.personaBuilding')}
      </div>
      {hasAnyPanel ? (
        <div ref={gridRef} className="grid grid-cols-2 gap-3">
          {DEFAULT_PERSONA_PANELS.filter((p) => !hiddenKeys.has(p.key)).map(
            (p) => (
              <PersonaCard
                key={p.key}
                icon={p.icon}
                title={t(`personaSection.${p.key}`)}
                section={sectionOf(data, p.key)}
                questionCount={questionCounts.get(p.key) ?? 0}
                onClick={() => onSectionClick(p.key)}
              />
            ),
          )}
          {customSections.map((c) => (
            <PersonaCard
              key={c.key}
              icon={CUSTOM_PANEL_ICON}
              title={c.title}
              section={sectionOf(data, c.key)}
              questionCount={questionCounts.get(c.key) ?? 0}
              onClick={() => onSectionClick(c.key)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-[var(--fv-radius-card)] border-2 border-dashed border-line-empty bg-paper-soft px-4 py-8 text-center text-md text-mute">
          {!isLive
            ? t('persona.emptyNotLive')
            : !hasTranscript
              ? t('persona.emptyNoTranscript')
              : t('persona.emptyLive')}
        </div>
      )}
    </div>
  );
}

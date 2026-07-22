'use client';

/* ────────────────────────────────────────────────────────────────────
   DeskSetupAccordion — 데스크 리서치 위젯 idle/setup 을 유스케이스 4-스텝
   아코디언으로 (Canvas 1c V3). probing/setup-accordion 미러 — 공유 셸
   (WidgetAccordion·Field) 재사용, 프레임/색/타이포 결정 0.

   STEP1 프로젝트(ProjectPicker/useProjectSelection) · STEP2 주제·키워드
   (ChipField, removable chips) · STEP3 리서치 목적 2-카드(ModeCardGroup —
   트렌드 / 시장조사) · STEP4 수집 범위(지역 + 기간 + 견적 info line, market 시
   국가범위 kr/global).

   CTA(Search →)/푸터는 부모(desk-card-body)가 WidgetPrimaryCta 로 렌더 — 이
   컴포넌트는 아코디언 스텝만. 잡 생성·mode·scope·estimate·prior-jobs 로직은
   부모/기존 lib/api 그대로 (배선만).
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations, useLocale } from 'next-intl';
import {
  WidgetAccordion,
  useWidgetAccordion,
  type AccordionStepConfig,
} from '@/components/canvas/shell/widget-accordion';
import { Field } from '@/components/canvas/shell/field';
import { ProjectPicker } from '@/components/project-picker';
import { ChipField } from '@/components/ui/chip-field';
import { ModeCardGroup } from '@/components/ui/mode-button';
import { DuotoneIcon, type DuotoneIconName } from '@/components/ui/icons/duotone-icon';
import { SelectMenu } from '@/components/ui/select-menu';
import { DateRangePopover } from '@/components/ui/date-range-popover';
import { CONTROL_TRIGGER_CLASS } from '@/components/ui/control-trigger';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';
import { useProjectSelection } from '@/components/project-selection-provider';
import {
  TREND_SOURCE_IDS,
  type DeskMode,
  type DeskCountryScope,
} from '@/lib/desk-orchestrator/types';
import { DESK_REGIONS, type DeskRegion } from '@/lib/desk-sources';

// 수집 기간 quick-pick preset 정의 — 부모(desk-card-body)의 옛 controlsForm 과
// 동일. 'custom' 은 캘린더 직접 선택이라 quick-pick 에서 제외, 'all' 은 범위 해제.
const RANGE_PRESETS: { id: string; days: number | null }[] = [
  { id: 'all', days: null },
  { id: 'week', days: 7 },
  { id: 'month', days: 30 },
  { id: 'quarter', days: 90 },
  { id: 'year', days: 365 },
  { id: 'three_years', days: 1095 },
];

// 데스크 세부 옵션 trigger(지역 SelectMenu · 기간 DateRangePopover) 공유 규격.
const DESK_OPTION_TRIGGER_CLASS = CONTROL_TRIGGER_CLASS;

// 리서치 목적 2 mode 카드 — trend / market 모두 라이브(서버 자동 소스 선정).
// 아이콘 = CD Icon System 스트로크 세트(이모지 제거, 나머지 5위젯 method 카드와 통일).
const MODE_OPTIONS: { key: DeskMode; iconName: DuotoneIconName }[] = [
  { key: 'trend', iconName: 'trend' },
  { key: 'market', iconName: 'market' },
];

export function DeskSetupAccordion({
  projectId,
  onProjectChange,
  keywords,
  onKeywordsChange,
  mode,
  onModeChange,
  countryScope,
  onCountryScopeChange,
  regions,
  onRegionsChange,
  dateFrom,
  dateTo,
  onDateRangeChange,
}: {
  projectId: string | null;
  onProjectChange: (projectId: string | null) => void;
  keywords: string[];
  onKeywordsChange: (next: string[]) => void;
  mode: DeskMode;
  onModeChange: (next: DeskMode) => void;
  countryScope: DeskCountryScope;
  onCountryScopeChange: (next: DeskCountryScope) => void;
  regions: Set<DeskRegion>;
  onRegionsChange: (next: Set<DeskRegion>) => void;
  dateFrom: string;
  dateTo: string;
  onDateRangeChange: (next: { from: string; to: string }) => void;
}) {
  const t = useTranslations('Desk');
  const locale = useLocale();
  const { projects } = useInterviewV2Projects();
  const { selection } = useProjectSelection();
  const accordion = useWidgetAccordion();

  const rangePresets = RANGE_PRESETS.map((p) => ({
    label: t(`range_${p.id}` as never),
    days: p.days,
  }));

  // ── 입력 시점 범위 견적 (spec §F) — "약 N회 검색" 으로 heavy 실행 전 범위를
  // 줄이도록 유도. 단일 키워드는 서버가 +4 유사어로 확장하므로 5로 취급. 곱
  // (kw × sources × regions)은 상한 근사. 부모의 옛 controlsForm 계산과 동일.
  const hasKeywords = keywords.length > 0;
  const effectiveKw = keywords.length <= 1 ? 5 : keywords.length;
  const estimateSourceCount = Math.max(TREND_SOURCE_IDS.length, 1);
  const estimatedSearches = hasKeywords
    ? effectiveKw * estimateSourceCount * Math.max(regions.size, 1)
    : 0;
  const estimateHeavy = estimatedSearches >= 60;

  // done 요약 값.
  const projectName =
    projects.find((p) => p.id === projectId)?.name ?? t('setup.step1Selected');
  const selValues = Object.values(selection);
  const appliedToAll =
    projectId != null &&
    selValues.length > 0 &&
    selValues.every((v) => v === projectId);
  const projectSummary = appliedToAll
    ? `${projectName} · ${t('setup.step1BulkTag')}`
    : projectName;
  const modeTitle = t(`modeTitle.${mode}` as never);
  const scopeSummary =
    Array.from(regions)
      .map((r) => t(`region.${r}` as never))
      .join(', ') || t('setup.step4Short');

  const modeSelector = (
    <ModeCardGroup
      ariaLabel={t('modeLabel')}
      options={MODE_OPTIONS.map((opt) => ({
        key: opt.key,
        icon: <DuotoneIcon name={opt.iconName} size={24} />,
        label: t(`modeTitle.${opt.key}` as never),
        description: t(`modeDesc.${opt.key}` as never),
      }))}
      value={mode}
      onChange={(key) => onModeChange(key as DeskMode)}
    />
  );

  const scopeBody = (
    <div className="flex flex-col gap-4">
      {/* 세부 옵션 — 지역 / 기간. */}
      <Field label={t('boardOptionsLabel')}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectMenu
            multi
            options={DESK_REGIONS.map((r) => ({
              value: r,
              label: t(`region.${r}` as never),
            }))}
            value={Array.from(regions)}
            onChange={(next) => {
              if (next.length === 0) return; // 최소 1개 보장
              onRegionsChange(new Set(next as DeskRegion[]));
            }}
            placeholder={t('regionLabel')}
            buttonClassName={DESK_OPTION_TRIGGER_CLASS}
          />
          <DateRangePopover
            value={{ from: dateFrom, to: dateTo }}
            onChange={(next) => onDateRangeChange(next)}
            presets={rangePresets}
            placeholder={t('range_all')}
            locale={locale}
            buttonClassName={DESK_OPTION_TRIGGER_CLASS}
          />
        </div>
      </Field>

      {/* 국가 범위 — market 선택 시에만 노출(trend 은 서버가 안 씀). */}
      {mode === 'market' && (
        <Field label={t('countryScopeLabel')}>
          <ModeCardGroup
            ariaLabel={t('countryScopeLabel')}
            columns={2}
            options={[
              {
                key: 'kr',
                icon: '🇰🇷',
                label: t('countryScopeTitle.kr'),
                description: t('countryScopeDesc.kr'),
              },
              {
                key: 'global',
                icon: '🌐',
                label: t('countryScopeTitle.global'),
                description: t('countryScopeDesc.global'),
              },
            ]}
            value={countryScope}
            onChange={(key) => onCountryScopeChange(key as DeskCountryScope)}
          />
        </Field>
      )}

      {/* 수집 소스 — trend 는 서버 자동 선정 안내만. */}
      {mode === 'trend' && (
        <p className="text-xs leading-[1.6] text-mute-soft">
          {t('modeTrendSourcesHint')}
        </p>
      )}

      {/* 범위 견적 — heavy 면 warning 톤 + 줄이기 유도. market 은 견적 비노출. */}
      {hasKeywords && mode !== 'market' && (
        <p
          className={`text-xs leading-[1.6] ${
            estimateHeavy ? 'text-amore' : 'text-mute-soft'
          }`}
        >
          {t('estimateLabel', {
            kw: effectiveKw,
            src: estimateSourceCount,
            region: Math.max(regions.size, 1),
            count: estimatedSearches,
          })}
          {' · '}
          {estimateHeavy ? t('estimateHeavy') : t('estimateOk')}
        </p>
      )}
    </div>
  );

  const steps: AccordionStepConfig[] = [
    {
      key: 'project',
      eyebrow: t('setup.stepEyebrow', { n: 1, label: t('setup.step1Short') }),
      title: t('setup.step1Title'),
      summary: projectSummary,
      summaryIcon: <DuotoneIcon name="project" size={15} />,
      body: (
        <Field label={t('setup.fieldProject')}>
          <ProjectPicker
            widget="desk"
            value={projectId}
            onChange={onProjectChange}
            fullWidth
          />
        </Field>
      ),
    },
    {
      key: 'topics',
      eyebrow: t('setup.stepEyebrow', { n: 2, label: t('setup.step2Short') }),
      title: t('setup.step2Title'),
      summary: t('setup.step2Summary', { count: keywords.length }),
      summaryIcon: <DuotoneIcon name="keywords" size={15} />,
      body: (
        <Field label={t('boardTopicLabel')}>
          <ChipField
            variant="bordered"
            values={keywords}
            onChange={onKeywordsChange}
            maxItems={10}
            commitOnComma
            placeholderEmpty={t('keywordPlaceholder')}
            placeholderAdd={t('keywordAddMore')}
          />
        </Field>
      ),
    },
    {
      key: 'purpose',
      eyebrow: t('setup.stepEyebrow', { n: 3, label: t('setup.step3Short') }),
      title: t('setup.step3Title'),
      summary: modeTitle,
      // 목적 아이콘 = 선택 mode(trend/market). CD `IV('trend'|'market', …)`.
      summaryIcon: <DuotoneIcon name={mode} size={15} />,
      body: <Field label={t('modeLabel')}>{modeSelector}</Field>,
    },
    {
      key: 'scope',
      eyebrow: t('setup.stepEyebrow', { n: 4, label: t('setup.step4Short') }),
      title: t('setup.step4Title'),
      summary: scopeSummary,
      summaryIcon: <DuotoneIcon name="search" size={15} />,
      body: scopeBody,
    },
  ];

  // 완료 판정 — 프로젝트/키워드는 실제 입력, 목적/범위는 기본값 상주라 항상
  // 완료(transcript method 관례와 동일 — 기본값이 있으면 complete).
  const isComplete = (index: number): boolean =>
    index === 0
      ? projectId != null
      : index === 1
        ? keywords.length > 0
        : true;

  return (
    <WidgetAccordion
      steps={steps}
      isExpanded={accordion.isExpanded}
      isComplete={isComplete}
      onOpenStep={accordion.open}
      onCollapseStep={accordion.collapse}
      changeLabel={t('setup.change')}
      optionalLabel={t('setup.optional')}
    />
  );
}

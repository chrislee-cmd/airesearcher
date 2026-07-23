'use client';

/* ────────────────────────────────────────────────────────────────────
   RecruitingDistribution — 풀뷰 V2 Recruiting 좌측 하단 패널 (CD state 08).
   design-handoff/FULLVIEW-SHELL.md §F4 · Widget Fullview Comps.dc.html.

   fresh 신규 빌드 — 레거시 recruiting/distribution-panel.tsx 는 supersede
   (편집·재사용 금지). 로직(buildDistributionTable · crossfilter 헬퍼 ·
   QuestionFilterMenu)만 재사용해 성별×연령대 crosstab 을 CD 대로 다시 그린다.

   crosstab = 원본 responses 고정(2026-07-05 결정) — 필터는 셀 하이라이트에만
   반영(수치 불변). active cell = text-amore-deep · bg-amore/12 · radius 6.
   Σ grand = amore-deep. 0 셀 = line-empty "·". mono 표.
   ──────────────────────────────────────────────────────────────────── */

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { BrandLoader } from '@/components/ui/brand-loader';
import type { FormColumn, FormResponseRow } from '@/lib/google-forms';
import {
  buildDistributionTable,
  EMPTY_FILTER,
  hasActiveFilter,
  isCellActive,
  toggleAnswer,
  toggleCell,
  type DistributionTable,
  type FilterableQuestion,
  type RecruitingFilter,
} from '@/lib/recruiting/distribution';
import { QuestionFilterMenu } from '../../widgets/recruiting/question-filter-menu';

export function RecruitingDistribution({
  columns,
  rows,
  loading = false,
  formsLoading = false,
  hasForm = false,
  filterableQuestions = [],
  filter = EMPTY_FILTER,
  onFilterChange,
}: {
  columns: FormColumn[];
  rows: FormResponseRow[];
  loading?: boolean;
  formsLoading?: boolean;
  hasForm?: boolean;
  filterableQuestions?: FilterableQuestion[];
  filter?: RecruitingFilter;
  onFilterChange?: (filter: RecruitingFilter) => void;
}) {
  const t = useTranslations('Recruiting.fv');
  const nowYear = new Date().getFullYear();
  const table = useMemo(
    () => buildDistributionTable(columns, rows, { nowYear }),
    [columns, rows, nowYear],
  );
  const filtered = hasActiveFilter(filter);

  const handleCellClick = (gender: string, ageBucket: string) => {
    onFilterChange?.(toggleCell(filter, { gender, ageBucket }));
  };

  return (
    <section className="rounded-[var(--fv-radius-panel)] border-2 border-ink bg-paper shadow-memphis-sm-faint">
      <header className="flex items-center gap-2 border-b-[1.5px] border-ink/12 px-[14px] py-[11px]">
        <span aria-hidden className="text-md">
          📊
        </span>
        <span className="text-md font-bold text-ink">{t('distTitle')}</span>
        {table && table.grandTotal > 0 && (
          <span className="font-mono-label text-sm tabular-nums text-mute-soft">
            {t('distTotal', { count: table.grandTotal })}
          </span>
        )}
        {filterableQuestions.length > 0 && (
          <div className="ml-auto">
            <QuestionFilterMenu
              questions={filterableQuestions}
              filter={filter}
              onFilterChange={(f) => onFilterChange?.(f)}
            />
          </div>
        )}
      </header>

      {filtered && (
        <FilterChips
          filter={filter}
          filterableQuestions={filterableQuestions}
          onFilterChange={onFilterChange}
        />
      )}

      <div className="flex min-h-[120px] items-center justify-center px-[14px] py-3">
        <PanelBody
          loading={loading}
          formsLoading={formsLoading}
          hasForm={hasForm}
          table={table}
          filter={filter}
          onCellClick={handleCellClick}
        />
      </div>
    </section>
  );
}

function FilterChips({
  filter,
  filterableQuestions,
  onFilterChange,
}: {
  filter: RecruitingFilter;
  filterableQuestions: FilterableQuestion[];
  onFilterChange?: (filter: RecruitingFilter) => void;
}) {
  const t = useTranslations('Recruiting.fv');
  const qTitle = (field: string) =>
    filterableQuestions.find((q) => q.field === field)?.title ?? field;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b-[1.5px] border-ink/12 px-[14px] py-2">
      {filter.cells.map((c) => (
        <Badge
          key={`c-${c.gender}-${c.ageBucket}`}
          variant="subtle"
          className="max-w-[180px] text-xs-soft"
          onDismiss={() => onFilterChange?.(toggleCell(filter, c))}
          dismissLabel={t('filterRemove')}
        >
          {`${c.gender} × ${c.ageBucket}`}
        </Badge>
      ))}
      {filter.questions.flatMap((q) =>
        q.answers.map((ans) => (
          <Badge
            key={`q-${q.field}-${ans}`}
            variant="subtle"
            className="max-w-[180px] text-xs-soft"
            onDismiss={() => onFilterChange?.(toggleAnswer(filter, q.field, ans))}
            dismissLabel={t('filterRemove')}
          >
            {`${qTitle(q.field)}: ${ans}`}
          </Badge>
        )),
      )}
      <Button
        variant="link"
        size="xs"
        className="ml-auto px-0"
        onClick={() => onFilterChange?.(EMPTY_FILTER)}
      >
        {t('filterClearAll')}
      </Button>
    </div>
  );
}

function PanelBody({
  loading,
  formsLoading,
  hasForm,
  table,
  filter,
  onCellClick,
}: {
  loading: boolean;
  formsLoading: boolean;
  hasForm: boolean;
  table: DistributionTable | null;
  filter: RecruitingFilter;
  onCellClick: (gender: string, ageBucket: string) => void;
}) {
  const t = useTranslations('Recruiting.fv');
  if (formsLoading && !hasForm) return <BrandLoader size={32} />;
  if (!hasForm) {
    return (
      <EmptyState
        tone="subtle"
        title={t('distNoFormTitle')}
        description={t('distNoFormDesc')}
      />
    );
  }
  if (loading && (!table || table.grandTotal === 0)) return <BrandLoader size={32} />;
  if (table === null) {
    return (
      <EmptyState
        tone="subtle"
        title={t('distNoAxisTitle')}
        description={t('distNoAxisDesc')}
      />
    );
  }
  if (table.grandTotal === 0) {
    return (
      <EmptyState
        tone="subtle"
        title={t('distNoResponsesTitle')}
        description={t('distNoResponsesDesc')}
      />
    );
  }
  return <DistributionGrid table={table} filter={filter} onCellClick={onCellClick} />;
}

function DistributionGrid({
  table,
  filter,
  onCellClick,
}: {
  table: DistributionTable;
  filter: RecruitingFilter;
  onCellClick: (gender: string, ageBucket: string) => void;
}) {
  const t = useTranslations('Recruiting.fv');
  const { xLabels, yLabels, cells, xTotal, yTotal, grandTotal } = table;
  return (
    <div className="w-full">
      <table className="w-full border-collapse font-mono-label text-md tabular-nums">
        <thead>
          <tr>
            <th className="border-b border-line px-1 py-1.5 text-left text-xs uppercase tracking-[0.1em] text-faint">
              {t('distAxisHeader')}
            </th>
            {yLabels.map((y) => (
              <th
                key={y}
                className="border-b border-line px-2 py-1.5 text-right text-xs-soft text-mute-soft"
              >
                {y}
              </th>
            ))}
            <th className="border-b border-line px-1 py-1.5 text-right text-xs-soft font-extrabold text-ink">
              Σ
            </th>
          </tr>
        </thead>
        <tbody>
          {xLabels.map((x, i) => (
            <tr key={x} className="border-b border-ink/[0.07] last:border-b-0">
              <td className="whitespace-nowrap px-1 py-1.5 text-left font-sans text-md font-semibold text-ink-2">
                {x}
              </td>
              {yLabels.map((y, j) => {
                const count = cells[i][j];
                const active = isCellActive(filter, x, y);
                return (
                  <td key={y} className="p-0 text-right">
                    {/* 셀 = crossfilter 트리거(다중선택). table-cell 크기
                        인터랙티브 primitive 가 없고 Button 의 memphis chrome 은
                        밀집 통계 셀에 부적합 — §3.8 sanctioned per-line disable. */}
                    {/* eslint-disable-next-line react/forbid-elements -- 표 셀 크기 인터랙티브 primitive 부재; Button chrome 은 통계 셀에 부적합 */}
                    <button
                      type="button"
                      onClick={() => onCellClick(x, y)}
                      aria-pressed={active}
                      aria-label={t('distCellAria', { gender: x, age: y, count })}
                      className={`block w-full px-2 py-1.5 text-right tabular-nums transition-colors hover:bg-paper-soft ${
                        active
                          ? // design-allow-hardcoded -- CD state 08 active dist cell radius 6px (§F6(B) off-scale, DS radius scale 4/14 에 없음 — CD 절대값 유지)
                            'rounded-[6px] bg-amore/12 font-extrabold text-amore-deep'
                          : count
                            ? 'text-ink-2'
                            : 'text-line-empty'
                      }`}
                    >
                      {count || '·'}
                    </button>
                  </td>
                );
              })}
              <td className="px-1 py-1.5 text-right font-extrabold text-ink">
                {xTotal[i]}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-[1.5px] border-ink/15">
            <td className="px-1 py-1.5 text-left font-sans text-md font-extrabold text-ink">
              Σ
            </td>
            {yTotal.map((t, j) => (
              <td
                key={yLabels[j]}
                className="px-2 py-1.5 text-right font-extrabold text-ink"
              >
                {t}
              </td>
            ))}
            <td className="px-1 py-1.5 text-right font-extrabold text-amore-deep">
              {grandTotal}
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-[9px] text-xs leading-[1.45] text-faint">
        {t('distFixedNote')}
      </p>
    </div>
  );
}

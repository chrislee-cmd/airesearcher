'use client';

import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { MochiLoader } from '@/components/ui/mochi-loader';
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
import { QuestionFilterMenu } from './question-filter-menu';

// 리크루팅 fullview 상단 우 위젯 — 응답 분포 교차 테이블 (성별 × 연령대).
//
// crosstab = **원본 responses 고정** (2026-07-05): 호스트(recruiting-card)가
// spreadsheet 이 로드한 전체 응답(columns + 원본 rows, 필터 무관)을 내려주고,
// 이 패널은 그 원본으로 buildDistributionTable 을 계산한다. 필터(셀/질문)를
// 걸어도 분포 수치는 **변하지 않는다** — 필터는 아래 spreadsheet 에만 적용되고,
// 이 패널에서는 선택 셀 하이라이트(ring)와 chip 표시로만 반영된다.
//
// 이전엔 이 패널이 필터 적용 후 rows 로 crosstab 을 재계산해 분포 수치가 필터에
// 반응했으나(pr-recruiting-distribution-multiselect-and-filter-sync), 사용자
// 결정(2026-07-05)으로 분포는 항상 원본 100% 를 보여주도록 되돌렸다. multi-select
// 셀/질문 필터 자체는 그대로 유지된다(spreadsheet 필터 + 셀 하이라이트).
//
// 안전성: 성별/연령 값은 PII 마스킹 대상이 아니고(마스킹은 이름/전화만),
// responses 엔드포인트가 consent 필터를 적용하므로 원본 rows 집계 결과는 옛 서버
// 집계와 정확히 일치한다.
//
// 필터 상태는 fullview host 가 SSOT 로 쥐고 controlled prop 으로 내려온다 —
// 하단 응답 spreadsheet 와 sibling 이라 공통 부모가 필터를 쥐는 게 자연스럽다.

export function RecruitingDistributionPanel({
  columns,
  rows,
  loading = false,
  formsLoading = false,
  hasForm = false,
  filterableQuestions = [],
  filter = EMPTY_FILTER,
  onFilterChange,
}: {
  // spreadsheet 이 로드한 응답 컬럼/행 (consent 통과 · 성별·연령 원본값 보존).
  columns: FormColumn[];
  rows: FormResponseRow[];
  // 선택 폼의 응답을 아직 로딩 중인지 (첫 페인트 로더 vs empty 구분).
  loading?: boolean;
  // spreadsheet 이 폼 목록을 아직 로딩 중인지 (초기 flash 방지).
  formsLoading?: boolean;
  // 발행/선택된 폼이 있는지. false = "발행 설문 없음" empty.
  hasForm?: boolean;
  // 객관식 질문 목록(+답변 옵션) — 질문 필터 팝오버 + chip 라벨에 쓴다.
  filterableQuestions?: FilterableQuestion[];
  // 현재 활성 multi-select 필터(host 보유). 셀 하이라이트 · crosstab 재계산 ·
  // chip 리스트에 쓴다.
  filter?: RecruitingFilter;
  // 필터 변경/해제를 host 로 올린다.
  onFilterChange?: (filter: RecruitingFilter) => void;
}) {
  const nowYear = new Date().getFullYear();

  // 원본 rows → crosstab (필터 무관, 고정). 필터는 셀 하이라이트에만 쓰이고
  // 수치에는 영향을 주지 않는다 (deps = 원본 rows 만).
  const table = useMemo(
    () => buildDistributionTable(columns, rows, { nowYear }),
    [columns, rows, nowYear],
  );

  const filtered = hasActiveFilter(filter);

  const handleCellClick = (gender: string, ageBucket: string) => {
    onFilterChange?.(toggleCell(filter, { gender, ageBucket }));
  };

  return (
    <section className="flex min-h-[200px] flex-col rounded-sm border-[2px] border-ink bg-paper shadow-[2px_2px_0_black]">
      <header className="flex shrink-0 items-center gap-2 border-b-[1.5px] border-ink/15 px-4 py-2.5">
        <h3 className="text-md font-semibold text-ink">📊 분포 통계</h3>
        {table && table.grandTotal > 0 && (
          <span className="text-xs-soft tabular-nums text-mute-soft">
            총 {table.grandTotal}
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

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-4 py-3">
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

// 활성 필터 시각화 — 선택된 셀 + 질문 답변을 제거 가능한 chip 으로. 각 chip 의
// "×" 는 해당 항목만 토글 해제, 우측 "전체 초기화" 는 필터 전체를 비운다.
function FilterChips({
  filter,
  filterableQuestions,
  onFilterChange,
}: {
  filter: RecruitingFilter;
  filterableQuestions: FilterableQuestion[];
  onFilterChange?: (filter: RecruitingFilter) => void;
}) {
  const qTitle = (field: string) =>
    filterableQuestions.find((q) => q.field === field)?.title ?? field;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b-[1.5px] border-ink/15 px-4 py-2">
      {filter.cells.map((c) => (
        <Chip
          key={`c-${c.gender}-${c.ageBucket}`}
          label={`${c.gender} × ${c.ageBucket}`}
          onRemove={() => onFilterChange?.(toggleCell(filter, c))}
        />
      ))}
      {filter.questions.flatMap((q) =>
        q.answers.map((ans) => (
          <Chip
            key={`q-${q.field}-${ans}`}
            label={`${qTitle(q.field)}: ${ans}`}
            onRemove={() => onFilterChange?.(toggleAnswer(filter, q.field, ans))}
          />
        )),
      )}
      <Button
        variant="link"
        size="xs"
        className="ml-auto px-0"
        onClick={() => onFilterChange?.(EMPTY_FILTER)}
      >
        전체 초기화
      </Button>
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    // eslint-disable-next-line react/forbid-elements -- 제거 가능한 필터 chip; Button chrome 은 밀집 태그에 부적합
    <button
      type="button"
      onClick={onRemove}
      className="inline-flex max-w-[180px] items-center gap-1 rounded-full border border-ink/25 bg-paper-soft px-2 py-0.5 text-xs-soft text-ink-2 transition-colors hover:border-ink hover:text-ink"
    >
      <span className="truncate">{label}</span>
      <span aria-hidden className="text-mute-soft">
        ×
      </span>
      <span className="sr-only">필터 제거</span>
    </button>
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
  // 폼 목록 자체가 아직 로딩 중 → 로더 (폼 유무 판단 불가).
  if (formsLoading && !hasForm) {
    return <MochiLoader size={32} />;
  }
  // 폼 목록 로딩 끝났는데 발행 폼이 없음.
  if (!hasForm) {
    return (
      <EmptyState
        tone="subtle"
        title="발행된 설문이 없습니다"
        description="설문을 발행하면 성별 · 연령 분포가 여기에 표시됩니다."
      />
    );
  }
  // 폼은 있으나 아직 응답 로딩 중 → 로더.
  if (loading && (!table || table.grandTotal === 0)) {
    return <MochiLoader size={32} />;
  }
  // 성별/연령 문항이 없어 교차 분포를 만들 수 없음.
  if (table === null) {
    return (
      <EmptyState
        tone="subtle"
        title="분포를 만들 문항이 없습니다"
        description="설문에 성별 · 연령(출생년도) 문항이 있어야 교차 분포를 계산할 수 있어요."
      />
    );
  }
  if (table.grandTotal === 0) {
    // crosstab 은 원본 rows 로 고정이라 grandTotal 0 = 실제 응답이 없는 경우뿐
    // (필터로는 수치가 비지 않는다).
    return (
      <EmptyState
        tone="subtle"
        title="아직 집계할 응답이 없습니다"
        description="응답이 들어오면 성별 × 연령대 분포가 여기에 표시됩니다."
      />
    );
  }
  return (
    <DistributionGrid table={table} filter={filter} onCellClick={onCellClick} />
  );
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
  const { xLabels, yLabels, cells, xTotal, yTotal, grandTotal } = table;
  return (
    <table className="w-full border-collapse text-md tabular-nums">
      <thead>
        <tr>
          <th className="border-b border-line-soft px-2 py-1.5 text-left text-xs-soft uppercase tracking-[0.04em] text-mute-soft">
            성별 \ 연령
          </th>
          {yLabels.map((y) => (
            <th
              key={y}
              className="border-b border-line-soft px-2 py-1.5 text-right text-xs-soft text-mute-soft"
            >
              {y}
            </th>
          ))}
          <th className="border-b border-line-soft px-2 py-1.5 text-right text-xs-soft font-semibold text-ink">
            계
          </th>
        </tr>
      </thead>
      <tbody>
        {xLabels.map((x, i) => (
          <tr key={x} className="border-b border-line-soft last:border-b-0">
            <th className="whitespace-nowrap px-2 py-1.5 text-left text-sm font-medium text-ink-2">
              {x}
            </th>
            {yLabels.map((y, j) => {
              const count = cells[i][j];
              const active = isCellActive(filter, x, y);
              return (
                <td key={y} className="p-0 text-right">
                  {/* 셀 = crossfilter 트리거(다중선택). table-cell 크기 인터랙티브
                      primitive 가 없고 Button 의 Memphis chrome 은 밀집 통계
                      셀에 부적합해 native button 을 §3.8 sanctioned per-line
                      disable 로 사용한다. */}
                  {/* eslint-disable-next-line react/forbid-elements -- 표 셀 크기 인터랙티브 primitive 부재; Button chrome 은 통계 셀에 부적합 */}
                  <button
                    type="button"
                    onClick={() => onCellClick(x, y)}
                    aria-pressed={active}
                    aria-label={`${x} × ${y} ${count}명 필터`}
                    className={`block w-full px-2 py-1.5 text-right tabular-nums transition-colors hover:bg-paper-soft ${
                      active
                        ? 'bg-amore/10 font-semibold text-amore ring-2 ring-inset ring-amore'
                        : 'text-ink'
                    }`}
                  >
                    {count || <span className="text-mute-soft">·</span>}
                  </button>
                </td>
              );
            })}
            <td className="px-2 py-1.5 text-right font-semibold text-ink">
              {xTotal[i]}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-[1.5px] border-ink/15">
          <th className="px-2 py-1.5 text-left text-sm font-semibold text-ink">
            계
          </th>
          {yTotal.map((t, j) => (
            <td
              key={yLabels[j]}
              className="px-2 py-1.5 text-right font-semibold text-ink"
            >
              {t}
            </td>
          ))}
          <td className="px-2 py-1.5 text-right font-semibold text-amore">
            {grandTotal}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

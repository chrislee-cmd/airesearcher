'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { MochiLoader } from '@/components/ui/mochi-loader';
import { Select } from '@/components/ui/select';
import { useRecruitingDistribution } from '@/hooks/use-recruiting-distribution';
import type {
  DistributionTable,
  FilterableQuestion,
  RecruitingFilter,
} from '@/lib/recruiting/distribution';

// 리크루팅 fullview 상단 우 위젯 — 응답 분포 교차 테이블 (기본 성별 × 연령대).
//
// 데이터는 spreadsheet 과 동일한 Google-Forms 경로를 재사용하되 집계만 받는다:
//   GET /api/recruiting/google/forms/[id]/distribution → pivot count table.
//
// 폼 선택: 이 위젯은 fullview 하단 응답 spreadsheet 의 selector 와 **동일한
// 선택 폼**을 host 카드에서 formId prop 으로 받는다. 예전엔 이 위젯이 자체적으로
// forms/list 를 다시 조회해 "최신 발행 폼" 만 default 로 잡았는데, 사용자가
// spreadsheet 드롭다운에서 응답이 쌓인 옛 폼을 골라도 분포는 최신(빈) 폼을
// 계속 봐서 240 응답 있는데도 "아직 집계할 응답이 없습니다" 로 뜨는 wire 사고가
// 났다 (2026-07-04 P0). 이제 세 위젯(조건·분포·응답)이 하나의 선택 폼을 공유한다.
//
// Crossfilter (2026-07-04): 이 패널이 두 가지 필터를 방출한다 —
//   ① 분포 crosstab 의 셀 클릭 → { type:'cell', gender, ageBucket }
//   ② "질문 필터" dropdown 에서 객관식 질문·답변 선택 → { type:'question', ... }
// 두 필터는 상호 배타(단일 activeFilter union). 필터 상태는 fullview host
// (recruiting-card)가 보유하고 이 패널엔 controlled prop 으로 내려온다 — 하단
// 응답 spreadsheet 와 sibling 이라 공통 부모가 SSOT 를 쥐는 게 자연스럽다
// (spec 의 "필터 상태 = distribution panel" 을 controlled 로 보수적 해석).

export function RecruitingDistributionPanel({
  formId,
  formsLoading = false,
  onRegisterRefresh,
  filterableQuestions = [],
  activeFilter = null,
  onFilterChange,
}: {
  // fullview host(recruiting-card)가 spreadsheet 의 선택 폼을 그대로 내려준다.
  //   string → 그 폼의 분포 집계
  //   null   → 발행 폼이 없거나(로딩 끝) 아직 선택 전
  formId: string | null;
  // spreadsheet 이 폼 목록을 아직 로딩 중인지. formId 가 null 이어도 로딩 중이면
  // "발행 설문 없음" empty 가 아니라 로더를 띄우기 위한 구분값.
  formsLoading?: boolean;
  // Hands this panel's refresh (SWR-style `mutate`) up to the fullview host so
  // the shared 상단 "새로고침" 버튼이 테이블과 함께 분포도 refetch 한다.
  onRegisterRefresh?: (fn: () => void) => void;
  // 객관식 질문 목록(+답변 옵션) — spreadsheet 이 로드한 응답 컬럼에서 파생해
  // host 를 통해 내려준다. 비어 있으면 질문 필터 dropdown 을 숨긴다.
  filterableQuestions?: FilterableQuestion[];
  // 현재 활성 필터(host 보유). 셀 하이라이트 + dropdown 선택값 복원에 쓴다.
  activeFilter?: RecruitingFilter | null;
  // 필터 변경/해제를 host 로 올린다. null = 전체 복원.
  onFilterChange?: (filter: RecruitingFilter | null) => void;
}) {
  const { table, error, isLoading, mutate } = useRecruitingDistribution(formId);

  useEffect(() => {
    onRegisterRefresh?.(() => {
      void mutate();
    });
  }, [onRegisterRefresh, mutate]);

  // 셀 클릭 → 해당 셀이 이미 활성이면 토글 해제, 아니면 셀 필터로 교체.
  const handleCellClick = (gender: string, ageBucket: string) => {
    const isActive =
      activeFilter?.type === 'cell' &&
      activeFilter.gender === gender &&
      activeFilter.ageBucket === ageBucket;
    onFilterChange?.(isActive ? null : { type: 'cell', gender, ageBucket });
  };

  return (
    <section className="flex h-full min-h-0 flex-col rounded-sm border-[2px] border-ink bg-paper shadow-[2px_2px_0_black]">
      <header className="flex shrink-0 items-center gap-2 border-b-[1.5px] border-ink/15 px-4 py-2.5">
        <h3 className="text-md font-semibold text-ink">📊 분포 통계</h3>
        {table && table.grandTotal > 0 && (
          <span className="text-xs-soft tabular-nums text-mute-soft">
            총 {table.grandTotal}
          </span>
        )}
        {activeFilter && (
          <Button
            variant="link"
            size="xs"
            className="ml-auto px-0"
            onClick={() => onFilterChange?.(null)}
          >
            필터 초기화
          </Button>
        )}
      </header>

      {filterableQuestions.length > 0 && (
        <QuestionFilterRow
          questions={filterableQuestions}
          activeFilter={activeFilter}
          onFilterChange={onFilterChange}
        />
      )}

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-4 py-3">
        <PanelBody
          formId={formId}
          formsLoading={formsLoading}
          table={table}
          error={error}
          isLoading={isLoading}
          activeFilter={activeFilter}
          onCellClick={handleCellClick}
        />
      </div>
    </section>
  );
}

// 질문 필터 — 헤더 아래 한 줄: 객관식 질문 Select + (질문 선택 시) 답변 Select.
// 질문만 고르고 답변은 아직 안 고른 중간 상태는 local state 로 들고 있다가
// (필터는 아직 방출 안 함), 답변을 고르면 그때 질문 필터를 방출한다.
function QuestionFilterRow({
  questions,
  activeFilter,
  onFilterChange,
}: {
  questions: FilterableQuestion[];
  activeFilter: RecruitingFilter | null;
  onFilterChange?: (filter: RecruitingFilter | null) => void;
}) {
  // 현재 답변 dropdown 을 펼칠 질문. 활성 질문 필터가 있으면 그 field 로 동기화.
  const [selectedField, setSelectedField] = useState<string>('');
  const activeQuestion =
    activeFilter?.type === 'question' ? activeFilter : null;
  const activeField = activeQuestion?.field ?? '';
  // 활성 질문 필터가 있으면 그 field 를, 없으면 local 선택을 답변 dropdown 기준으로.
  const effectiveField = activeField || selectedField;
  const selectedQuestion = questions.find((q) => q.field === effectiveField);
  // 답변 Select 의 현재값 — 활성 질문 필터의 field 가 지금 펼친 질문과 같을 때만.
  const answerValue =
    activeQuestion && activeQuestion.field === effectiveField
      ? activeQuestion.answer
      : '';

  const handleQuestionChange = (field: string) => {
    setSelectedField(field);
    // 질문을 비우거나 바꾸면, 걸려 있던 질문 필터는 답변을 다시 고를 때까지 해제.
    if (activeFilter?.type === 'question') onFilterChange?.(null);
  };

  const handleAnswerChange = (answer: string) => {
    if (!effectiveField) return;
    onFilterChange?.(
      answer ? { type: 'question', field: effectiveField, answer } : null,
    );
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b-[1.5px] border-ink/15 px-4 py-2">
      <Select
        size="sm"
        fullWidth={false}
        aria-label="질문 필터 선택"
        className="min-w-[150px]"
        value={effectiveField}
        onChange={(e) => handleQuestionChange(e.target.value)}
        options={[
          { value: '', label: '질문 필터 선택…' },
          ...questions.map((q) => ({ value: q.field, label: q.title })),
        ]}
      />
      {selectedQuestion && (
        <Select
          size="sm"
          fullWidth={false}
          aria-label="답변 선택"
          className="min-w-[130px]"
          value={answerValue}
          onChange={(e) => handleAnswerChange(e.target.value)}
          options={[
            { value: '', label: '답변 선택…' },
            ...selectedQuestion.answers.map((a) => ({ value: a, label: a })),
          ]}
        />
      )}
    </div>
  );
}

function PanelBody({
  formId,
  formsLoading,
  table,
  error,
  isLoading,
  activeFilter,
  onCellClick,
}: {
  formId: string | null;
  formsLoading: boolean;
  table: DistributionTable | null | undefined;
  error: Error | null;
  isLoading: boolean;
  activeFilter: RecruitingFilter | null;
  onCellClick: (gender: string, ageBucket: string) => void;
}) {
  if (error) {
    return (
      <EmptyState
        tone="subtle"
        title="분포를 불러오지 못했어요"
        description="잠시 후 다시 시도해 주세요."
      />
    );
  }
  if (formId === null) {
    // spreadsheet 이 아직 폼 목록을 로딩 중이면 로더, 로딩이 끝났는데도 폼이
    // 없으면(선택 폼 없음) empty. 이렇게 나눠야 초기 진입 시 "발행 설문 없음" 이
    // 잠깐 깜빡였다가 표로 바뀌는 잘못된 flash 를 막는다.
    return formsLoading ? (
      <MochiLoader size={32} />
    ) : (
      <EmptyState
        tone="subtle"
        title="발행된 설문이 없습니다"
        description="설문을 발행하면 성별 · 연령 분포가 여기에 표시됩니다."
      />
    );
  }
  if (isLoading && table === undefined) {
    return <MochiLoader size={32} />;
  }
  if (table === null) {
    return (
      <EmptyState
        tone="subtle"
        title="분포를 만들 문항이 없습니다"
        description="설문에 성별 · 연령(출생년도) 문항이 있어야 교차 분포를 계산할 수 있어요."
      />
    );
  }
  if (!table || table.grandTotal === 0) {
    return (
      <EmptyState
        tone="subtle"
        title="아직 집계할 응답이 없습니다"
        description="응답이 들어오면 성별 × 연령대 분포가 여기에 표시됩니다."
      />
    );
  }
  return (
    <DistributionGrid
      table={table}
      activeFilter={activeFilter}
      onCellClick={onCellClick}
    />
  );
}

function DistributionGrid({
  table,
  activeFilter,
  onCellClick,
}: {
  table: DistributionTable;
  activeFilter: RecruitingFilter | null;
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
              const isActive =
                activeFilter?.type === 'cell' &&
                activeFilter.gender === x &&
                activeFilter.ageBucket === y;
              return (
                <td key={y} className="p-0 text-right">
                  {/* 셀 = crossfilter 트리거. table-cell 크기 인터랙티브
                      primitive 가 없고 Button 의 Memphis chrome 은 밀집 통계
                      셀에 부적합해 native button 을 §3.8 sanctioned per-line
                      disable 로 사용한다. */}
                  {/* eslint-disable-next-line react/forbid-elements -- 표 셀 크기 인터랙티브 primitive 부재; Button chrome 은 통계 셀에 부적합 */}
                  <button
                    type="button"
                    onClick={() => onCellClick(x, y)}
                    aria-pressed={isActive}
                    aria-label={`${x} × ${y} ${count}명 필터`}
                    className={`block w-full px-2 py-1.5 text-right tabular-nums transition-colors hover:bg-paper-soft ${
                      isActive
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

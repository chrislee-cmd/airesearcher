'use client';

import { useEffect } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { MochiLoader } from '@/components/ui/mochi-loader';
import { useRecruitingDistribution } from '@/hooks/use-recruiting-distribution';
import type { DistributionTable } from '@/lib/recruiting/distribution';

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
// 셀 클릭 crossfilter 는 다음 spec 이 wire — 여기선 hover highlight 까지만.

export function RecruitingDistributionPanel({
  formId,
  formsLoading = false,
  onRegisterRefresh,
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
}) {
  const { table, error, isLoading, mutate } = useRecruitingDistribution(formId);

  useEffect(() => {
    onRegisterRefresh?.(() => {
      void mutate();
    });
  }, [onRegisterRefresh, mutate]);

  return (
    <section className="flex h-full min-h-0 flex-col rounded-sm border-[2px] border-ink bg-paper shadow-[2px_2px_0_black]">
      <header className="flex shrink-0 items-center gap-2 border-b-[1.5px] border-ink/15 px-4 py-2.5">
        <h3 className="text-md font-semibold text-ink">📊 분포 통계</h3>
        {table && table.grandTotal > 0 && (
          <span className="text-xs-soft tabular-nums text-mute-soft">
            총 {table.grandTotal}
          </span>
        )}
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-4 py-3">
        <PanelBody
          formId={formId}
          formsLoading={formsLoading}
          table={table}
          error={error}
          isLoading={isLoading}
        />
      </div>
    </section>
  );
}

function PanelBody({
  formId,
  formsLoading,
  table,
  error,
  isLoading,
}: {
  formId: string | null;
  formsLoading: boolean;
  table: DistributionTable | null | undefined;
  error: Error | null;
  isLoading: boolean;
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
  return <DistributionGrid table={table} />;
}

function DistributionGrid({ table }: { table: DistributionTable }) {
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
            {yLabels.map((y, j) => (
              <td
                key={y}
                className="px-2 py-1.5 text-right text-ink transition-colors hover:bg-paper-soft"
              >
                {cells[i][j] || <span className="text-mute-soft">·</span>}
              </td>
            ))}
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

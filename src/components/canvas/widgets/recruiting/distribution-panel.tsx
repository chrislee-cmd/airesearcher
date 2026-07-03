'use client';

import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { MochiLoader } from '@/components/ui/mochi-loader';
import { useRecruitingDistribution } from '@/hooks/use-recruiting-distribution';
import type { DistributionTable } from '@/lib/recruiting/distribution';

// 리크루팅 fullview 상단 우 위젯 — 응답 분포 교차 테이블 (기본 성별 × 연령대).
//
// 데이터는 spreadsheet 과 동일한 Google-Forms 경로를 재사용하되 집계만 받는다:
//   GET /api/recruiting/google/forms/[id]/distribution → pivot count table.
// 폼 선택은 이 위젯이 자체적으로 최근 발행 폼을 default 로 잡는다 (spreadsheet
// 이 자체 selector 를 갖는 것과 동일한 최소 결합). 셀 클릭 crossfilter 는 다음
// spec 이 wire — 여기선 hover highlight 까지만.

type FormSummary = { formId: string; createdAt: string };

function useLatestFormId(): string | null {
  const [formId, setFormId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/recruiting/google/forms/list');
        if (!res.ok) return;
        const j = (await res.json().catch(() => ({}))) as {
          forms?: FormSummary[];
        };
        const latest = j.forms?.[0]?.formId ?? null;
        if (!cancelled) setFormId(latest);
      } catch {
        // silent — panel falls back to the "발행된 설문 없음" empty state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return formId;
}

export function RecruitingDistributionPanel({
  onRegisterRefresh,
}: {
  // Hands this panel's refresh (SWR-style `mutate`) up to the fullview host so
  // the shared 상단 "새로고침" 버튼이 테이블과 함께 분포도 refetch 한다.
  onRegisterRefresh?: (fn: () => void) => void;
} = {}) {
  const formId = useLatestFormId();
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
  table,
  error,
  isLoading,
}: {
  formId: string | null;
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
  if (formId === null || (isLoading && table === undefined)) {
    return formId === null && !isLoading ? (
      <EmptyState
        tone="subtle"
        title="발행된 설문이 없습니다"
        description="설문을 발행하면 성별 · 연령 분포가 여기에 표시됩니다."
      />
    ) : (
      <MochiLoader size={32} />
    );
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

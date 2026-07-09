'use client';

import { useTranslations } from 'next-intl';
import type { DeskRevenueSeries } from '@/components/desk-job-provider';

type TDesk = ReturnType<typeof useTranslations<'Desk'>>;

// "주요 기업 매출" grouped bar — #461. route 가 구조화 DART 값에서 만든
// job.analytics.revenueSeries 를 렌더만 한다(포맷·YoY 계산은 서버가 끝냄 —
// 표와 수치가 항상 일치). 회사별로 3개년(과거→최신) 가로 bar 를 묶어 추이를
// 보이고, 각 기간에 코드가 계산한 YoY(▲/▼)를 병기한다. 결측 기간은 bar 없이
// "데이터 확보 실패"로 정직 표기. 값 전건 결측 회사는 애초에 series 에서 빠진다.
//
// 색: 최신 연도 = amore(강조), 직전 = amore-soft, 그 이전 = 옅은 라인색 —
// 시간이 흐를수록 진해져 최신값이 눈에 들어온다. 인접 analytics 패널의 팔레트와
// 같은 계열(디자인 정합).
const BAR_LATEST = '#1F5795'; // amore
const BAR_PREV = '#3d72ad'; // amore-soft
const BAR_OLDER = '#c8d2e4'; // 옅은 amore 톤

function barColor(idx: number, count: number): string {
  if (idx === count - 1) return BAR_LATEST;
  if (idx === count - 2) return BAR_PREV;
  return BAR_OLDER;
}

export function RevenueChart({
  series,
  tDesk,
}: {
  series: DeskRevenueSeries[];
  tDesk: TDesk;
}) {
  if (!series.length) return null;

  // 전 회사·전 기간 통틀어 최대 매출 — bar 폭을 회사 간 비교 가능하게 정규화한다.
  const max = Math.max(
    ...series.flatMap((s) => s.periods.map((p) => p.amount ?? 0)),
    1,
  );

  return (
    <div className="rounded-xs border border-line bg-paper p-4">
      <p className="mb-3 text-xs-soft leading-[1.6] text-mute">
        {tDesk('revenueChartCaption')}
      </p>
      <div className="space-y-4">
        {series.map((s) => (
          <div key={s.company}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-md font-semibold text-ink-2">
                {s.company}
              </span>
              <a
                href={s.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-xs text-amore underline decoration-amore/40 underline-offset-2 hover:decoration-amore"
              >
                {tDesk('viewSource')}
              </a>
            </div>
            <ul className="space-y-1.5">
              {s.periods.map((p, i) => {
                const w = p.amount !== null ? (p.amount / max) * 100 : 0;
                const latest = i === s.periods.length - 1;
                return (
                  <li key={p.year} className="leading-tight">
                    <div className="flex items-baseline justify-between gap-2 text-xs-soft">
                      <span className="text-mute">{p.year}</span>
                      <span className="flex items-baseline gap-1.5 tabular-nums">
                        <span
                          className={
                            latest
                              ? 'font-semibold text-amore'
                              : 'text-ink-2'
                          }
                        >
                          {p.display ?? tDesk('revenueChartMissing')}
                        </span>
                        {p.yoyPct !== null && (
                          <span className="text-mute-soft">
                            {p.yoyPct >= 0 ? '▲' : '▼'}
                            {Math.abs(p.yoyPct).toFixed(1)}%
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="mt-1 h-2 w-full rounded-full bg-paper-soft">
                      {p.amount !== null && (
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${w}%`,
                            backgroundColor: barColor(i, s.periods.length),
                          }}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

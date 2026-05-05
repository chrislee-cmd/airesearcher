'use client';

import { useMemo } from 'react';
import {
  computeDeskStats,
  type CountSlice,
  type DeskStats,
  type TimelineBucket,
} from '@/lib/desk-stats';
import type { DeskArticle } from '@/lib/desk-sources';

const PCT = (n: number) => `${Math.round(n * 100)}%`;

function HBar({
  rows,
  emptyLabel,
}: {
  rows: CountSlice[];
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return <p className="text-[12px] text-mute-soft">{emptyLabel}</p>;
  }
  const max = rows[0]?.count ?? 1;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => {
        const w = max === 0 ? 0 : (r.count / max) * 100;
        return (
          <li key={r.key} className="text-[12px] leading-tight">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-ink-2">{r.label}</span>
              <span className="tabular-nums text-mute">
                {r.count} <span className="text-mute-soft">· {PCT(r.share)}</span>
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full bg-paper-soft [border-radius:9999px]">
              <div
                className="h-full bg-amore [border-radius:9999px]"
                style={{ width: `${w}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Timeline({ buckets }: { buckets: TimelineBucket[] }) {
  if (buckets.length === 0) return null;
  const max = Math.max(...buckets.map((b) => b.count), 1);
  // SVG sparkline + columns. Width is fixed-ish (responsive via viewBox).
  const w = 560;
  const h = 80;
  const pad = { l: 8, r: 8, t: 8, b: 18 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const colW = innerW / Math.max(buckets.length, 1);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[80px] w-full">
      {buckets.map((b, i) => {
        const x = pad.l + i * colW + colW * 0.15;
        const cw = colW * 0.7;
        const ch = (b.count / max) * innerH;
        const y = pad.t + (innerH - ch);
        return (
          <g key={b.key}>
            <rect
              x={x}
              y={y}
              width={cw}
              height={ch}
              fill="currentColor"
              className="text-amore"
              rx="1"
            />
            <text
              x={x + cw / 2}
              y={pad.t + innerH + 12}
              textAnchor="middle"
              fontSize="9"
              className="fill-mute-soft"
            >
              {b.label.slice(2)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function CrossTab({ stats }: { stats: DeskStats }) {
  if (stats.byKeyword.length < 2) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-line-soft text-[10.5px] uppercase tracking-[.18em] text-mute-soft">
            <th className="py-1.5 pr-3 text-left font-semibold">키워드</th>
            <th className="px-2 py-1.5 text-right font-semibold">네이버</th>
            <th className="px-2 py-1.5 text-right font-semibold">카카오·다음</th>
            <th className="px-2 py-1.5 text-right font-semibold">유튜브</th>
            <th className="px-2 py-1.5 text-right font-semibold">글로벌</th>
            <th className="pl-2 py-1.5 text-right font-semibold">합계</th>
          </tr>
        </thead>
        <tbody>
          {stats.keywordByGroup.map((row) => (
            <tr key={row.keyword} className="border-b border-line-soft">
              <td className="py-1.5 pr-3 font-medium text-ink-2">{row.keyword}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-mute">
                {row.counts.naver || '·'}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-mute">
                {row.counts.kakao || '·'}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-mute">
                {row.counts.youtube || '·'}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-mute">
                {row.counts.global || '·'}
              </td>
              <td className="pl-2 py-1.5 text-right tabular-nums font-semibold text-ink-2">
                {row.total}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DeskStatsPanel({ articles }: { articles: DeskArticle[] }) {
  const stats = useMemo(() => computeDeskStats(articles), [articles]);
  if (stats.total === 0) return null;
  const datedShare = stats.total === 0 ? 0 : stats.withDate / stats.total;

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between border-b border-line pb-3">
        <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
          📊 정량 분석
        </h2>
        <span className="text-[10.5px] uppercase tracking-[.22em] text-mute-soft">
          quantitative
        </span>
      </div>

      {/* KPI strip */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="총 수집" value={stats.total} suffix="건" />
        <Kpi
          label="채널 수"
          value={stats.bySource.length}
          suffix="개"
          hint={`${stats.byGroup.length}개 그룹`}
        />
        <Kpi label="키워드" value={stats.byKeyword.length} suffix="개" />
        <Kpi
          label="날짜 식별"
          value={`${Math.round(datedShare * 100)}`}
          suffix="%"
          hint={`${stats.withDate}/${stats.total}건`}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="채널 그룹 비중">
          <HBar rows={stats.byGroup} emptyLabel="채널 그룹 데이터 없음" />
        </Card>
        <Card title="출처별 비중 (상위 8)">
          <HBar
            rows={stats.bySource.slice(0, 8)}
            emptyLabel="출처 데이터 없음"
          />
        </Card>
        {stats.byKeyword.length > 1 && (
          <Card title="키워드별 비중">
            <HBar rows={stats.byKeyword} emptyLabel="" />
          </Card>
        )}
        {stats.timeline.length > 0 && (
          <Card title="월별 발행량">
            <Timeline buckets={stats.timeline} />
          </Card>
        )}
        {stats.byKeyword.length > 1 && (
          <div className="lg:col-span-2">
            <Card title="키워드 × 채널 그룹">
              <CrossTab stats={stats} />
            </Card>
          </div>
        )}
      </div>
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-line bg-paper p-4 [border-radius:4px]">
      <div className="mb-3 text-[10.5px] font-semibold uppercase tracking-[.22em] text-mute-soft">
        {title}
      </div>
      {children}
    </div>
  );
}

function Kpi({
  label,
  value,
  suffix,
  hint,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div className="border border-line bg-paper p-3 [border-radius:4px]">
      <div className="text-[10.5px] uppercase tracking-[.22em] text-mute-soft">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-[24px] font-bold tracking-[-0.01em] text-ink">
          {value}
        </span>
        {suffix && (
          <span className="text-[12px] text-mute">{suffix}</span>
        )}
      </div>
      {hint && <div className="mt-0.5 text-[10.5px] text-mute-soft">{hint}</div>}
    </div>
  );
}

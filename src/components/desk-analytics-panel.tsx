'use client';

import type { DeskAnalytics, DeskChart } from './desk-job-provider';

const PALETTE = [
  '#1F5795', // amore
  '#3d72ad', // amore-soft
  '#001C58', // pacific
  '#6c7aff', // pm-accent
  '#fb923c', // am-accent / warning
  '#5a5a5a', // mute
  '#9b9b9b', // mute-soft
  '#e6e9f1', // pacific-bg
];

function pct(n: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

// 강조 막대 색 = amore 액센트(팔레트 0번). 대비 차트에서 한국 위치를 부각한다.
const HIGHLIGHT_COLOR = '#1F5795';

function valueLabel(
  c: DeskChart,
  d: DeskChart['data'][number],
  total: number,
): string {
  // 코드가 미리 포맷한 라벨(USD 원값 등)이 있으면 그대로 — unit 자동 라벨보다 우선.
  if (d.display) return d.display;
  if (c.unit === 'percent') return `${Math.round(d.value)}%`;
  return `${d.value} (${pct(d.value, total)})`;
}

function ChartBar({ chart }: { chart: DeskChart }) {
  const max = Math.max(...chart.data.map((d) => d.value), 1);
  const total = chart.data.reduce((s, d) => s + d.value, 0);
  return (
    <ul className="space-y-2">
      {chart.data.map((d, i) => {
        const w = max === 0 ? 0 : (d.value / max) * 100;
        const highlighted = !!chart.highlight && d.label === chart.highlight;
        return (
          <li key={`${d.label}-${i}`} className="text-md leading-tight">
            <div className="flex items-baseline justify-between gap-3">
              <span className={highlighted ? 'font-semibold text-amore' : 'text-ink-2'}>
                {d.label}
              </span>
              <span
                className={`tabular-nums ${highlighted ? 'font-semibold text-amore' : 'text-mute'}`}
              >
                {valueLabel(chart, d, total)}
              </span>
            </div>
            <div className="mt-1 h-2 w-full bg-paper-soft rounded-full">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${w}%`,
                  backgroundColor: highlighted
                    ? HIGHLIGHT_COLOR
                    : PALETTE[i % PALETTE.length],
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// Donut chart — concentric ring with N slices. Uses cumulative angles so
// percentages outside 0..100 still render proportionally (we normalize).
function ChartPie({ chart }: { chart: DeskChart }) {
  const total = chart.data.reduce((s, d) => s + d.value, 0) || 1;
  const size = 160;
  const cx = size / 2;
  const cy = size / 2;
  const r = 64;
  const innerR = 38; // donut hole

  const START_ANGLE = -Math.PI / 2; // 12 o'clock
  // Precompute cumulative end-angles (reduce keeps things immutable: each entry
  // is the end angle for slice i, derived from acc[i-1]).
  const endAngles = chart.data.reduce<number[]>((acc, d) => {
    const prev = acc[acc.length - 1] ?? START_ANGLE;
    acc.push(prev + (d.value / total) * Math.PI * 2);
    return acc;
  }, []);
  const slices = chart.data.map((d, i) => {
    const sliceStart = i === 0 ? START_ANGLE : endAngles[i - 1];
    const sliceEnd = endAngles[i];
    return {
      path: describeDonutSlice(cx, cy, r, innerR, sliceStart, sliceEnd),
      color: PALETTE[i % PALETTE.length],
      label: d.label,
      value: d.value,
      valueText: valueLabel(chart, d, total),
      share: d.value / total,
    };
  });

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-[160px] w-[160px] shrink-0">
        {slices.map((s, i) => (
          <path key={i} d={s.path} fill={s.color} />
        ))}
        <text
          x={cx}
          y={cy - 2}
          textAnchor="middle"
          fontSize="11"
          className="fill-mute-soft"
        >
          {chart.unit === 'percent' ? '%' : 'total'}
        </text>
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          fontSize="14"
          fontWeight="700"
          className="fill-ink-2"
        >
          {chart.unit === 'percent' ? '100%' : Math.round(total)}
        </text>
      </svg>
      <ul className="flex-1 space-y-1.5 text-md">
        {slices.map((s, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3">
            <span className="flex items-center gap-2 text-ink-2">
              <span
                className="inline-block h-2.5 w-2.5 [border-radius:2px]"
                style={{ backgroundColor: s.color }}
              />
              {s.label}
            </span>
            <span className="tabular-nums text-mute">
              {s.valueText}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function describeDonutSlice(
  cx: number,
  cy: number,
  r: number,
  innerR: number,
  start: number,
  end: number,
): string {
  // Avoid degenerate slices that close into a line.
  const sweep = end - start;
  if (sweep <= 0) return '';
  const largeArc = sweep > Math.PI ? 1 : 0;
  const x1 = cx + r * Math.cos(start);
  const y1 = cy + r * Math.sin(start);
  const x2 = cx + r * Math.cos(end);
  const y2 = cy + r * Math.sin(end);
  const xi1 = cx + innerR * Math.cos(end);
  const yi1 = cy + innerR * Math.sin(end);
  const xi2 = cx + innerR * Math.cos(start);
  const yi2 = cy + innerR * Math.sin(start);
  return [
    `M ${x1} ${y1}`,
    `A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${xi1} ${yi1}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${xi2} ${yi2}`,
    'Z',
  ].join(' ');
}

export function DeskAnalyticsPanel({ analytics }: { analytics: DeskAnalytics }) {
  if (!analytics?.charts?.length) return null;
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between border-b border-line pb-3">
        <h2 className="text-xl font-semibold tracking-[-0.005em] text-ink-2">
          📊 정량 분석
        </h2>
        <span className="text-xs-soft uppercase tracking-[.22em] text-mute-soft">
          quantitative
        </span>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {analytics.charts.map((c, i) => (
          <article
            key={i}
            className="border border-line bg-paper p-5 rounded-sm"
          >
            <header className="mb-3">
              <div className="text-xs-soft font-semibold uppercase tracking-[.22em] text-amore">
                {c.type === 'pie' ? 'pie · 비율' : 'bar · 분포'}
              </div>
              <h3 className="mt-1 text-lg font-semibold text-ink-2">
                {c.title}
              </h3>
              <p className="mt-1 text-md leading-[1.65] text-mute">
                {c.insight}
              </p>
            </header>
            {c.type === 'pie' ? <ChartPie chart={c} /> : <ChartBar chart={c} />}
          </article>
        ))}
      </div>
    </section>
  );
}

'use client';

/* ────────────────────────────────────────────────────────────────────
   ReportChart — 읽기 모드 차트 블록 (§1.3 chart/pie · §C4 · S3 그림1·2).

   fresh 자체 렌더(recharts 미사용). BUILD-SPEC 이 마크업 수준으로 정의돼 있어
   자체 렌더가 .dc.html 과 픽셀 정합이 쉽고 임의값 0 을 지키기 좋다:
   - bar: **가로 막대 기본**(한글 카테고리 라벨이 세로축에서 잘림). 라벨 열
     120 · 값 열 34 우정렬. `h-60` 고정 폐기 → 행 수만큼 자란다.
   - pie: **도넛**(viewBox 42 · r 15.915 = 둘레 100 · stroke-width 9 · rotate
     -90deg). 범례 우측 세로, 값은 `M / N` 실수 표기.

   색: `chart-cat-1…6` 만(임의 hex 금지). 카테고리 순서대로 배정하고 7개째부터
   `mute-soft`("기타" 성격). AUTHORITY: 외형은 .dc.html 이 SSOT — 카테고리 막대는
   .dc.html 대로 항목별 다른 chart-cat 색(§0.5 프로즈 "단일계열=cat-1"보다 .dc.html
   외형 우선, 규칙 2c).
   ──────────────────────────────────────────────────────────────────── */

import type { ToplineChartDatum } from '@/lib/interview-v2/types';

// chart-cat 유틸리티 클래스(정적 — Tailwind 컴파일 감지). 배경/스트로크 각 6종.
const CAT_BG = [
  'bg-chart-cat-1',
  'bg-chart-cat-2',
  'bg-chart-cat-3',
  'bg-chart-cat-4',
  'bg-chart-cat-5',
  'bg-chart-cat-6',
] as const;
const CAT_STROKE = [
  'stroke-chart-cat-1',
  'stroke-chart-cat-2',
  'stroke-chart-cat-3',
  'stroke-chart-cat-4',
  'stroke-chart-cat-5',
  'stroke-chart-cat-6',
] as const;

const catBg = (i: number) => (i < 6 ? CAT_BG[i] : 'bg-mute-soft');
const catStroke = (i: number) => (i < 6 ? CAT_STROKE[i] : 'stroke-mute-soft');

// 차트 프레임 — 헤드(eyebrow + 제목) + 플롯 + (옵션) 푸터 각주. border 2 ink ·
// radius-md-ish(12) · shadow-memphis-md-faint.
function ChartFrame({
  eyebrow,
  title,
  children,
  footnote,
}: {
  eyebrow: string;
  title?: string;
  children: React.ReactNode;
  footnote?: string;
}) {
  return (
    <div className="overflow-hidden rounded-panel border-2 border-ink bg-paper shadow-memphis-md-faint">
      <div className="border-b-[1.5px] border-line bg-paper-soft px-[18px] py-3">
        <div className="mb-1 font-mono-label text-xs uppercase tracking-[0.14em] text-mute-soft">
          {eyebrow}
        </div>
        {title && (
          <div className="text-md font-extrabold text-ink">{title}</div>
        )}
      </div>
      {children}
      {footnote && (
        <div className="border-t-[1.5px] border-line bg-surface-canvas px-[18px] py-2.5 font-mono-label text-xs text-faint">
          {footnote}
        </div>
      )}
    </div>
  );
}

function BarChart({ data }: { data: ToplineChartDatum[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex flex-col gap-3 p-[18px]">
      {data.map((d, i) => (
        <div key={`${d.label}:${i}`} className="flex items-center gap-3">
          <div className="w-[120px] shrink-0 text-right text-md text-ink">
            {d.label}
          </div>
          <div className="h-[22px] flex-1 overflow-hidden rounded-xs border border-line bg-paper-soft">
            <div
              className={`h-full ${catBg(i)}`}
              style={{ width: `${Math.round((d.value / max) * 100)}%` }}
            />
          </div>
          <div className="w-[34px] shrink-0 text-right font-mono-label text-sm font-extrabold tabular-nums text-ink">
            {d.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// 둘레 100 기준 도넛 세그먼트 — 누적 offset 계산(순수 함수, 렌더 밖 변형 방지).
function donutSegments(
  data: ToplineChartDatum[],
  total: number,
): { pct: number; offset: number; i: number }[] {
  const segs: { pct: number; offset: number; i: number }[] = [];
  let acc = 0;
  for (let i = 0; i < data.length; i += 1) {
    const pct = (data[i].value / total) * 100;
    segs.push({ pct, offset: -acc, i });
    acc += pct;
  }
  return segs;
}

function PieChart({
  data,
  note,
}: {
  data: ToplineChartDatum[];
  note?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const segs = donutSegments(data, total);
  return (
    <div className="flex items-center gap-7 px-[18px] py-5">
      <svg
        width="150"
        height="150"
        viewBox="0 0 42 42"
        className="shrink-0 -rotate-90"
        aria-hidden="true"
      >
        {segs.map((s) => (
          <circle
            key={s.i}
            cx="21"
            cy="21"
            r="15.915"
            fill="none"
            className={catStroke(s.i)}
            strokeWidth="9"
            strokeDasharray={`${s.pct} ${100 - s.pct}`}
            strokeDashoffset={s.offset}
          />
        ))}
      </svg>
      <div className="flex min-w-0 flex-1 flex-col gap-[11px]">
        {data.map((d, i) => (
          <div key={`${d.label}:${i}`} className="flex items-center gap-2.5">
            <span
              className={`h-3 w-3 shrink-0 rounded-2xs border-[1.4px] border-ink ${catBg(i)}`}
            />
            <span className="flex-1 text-md text-ink">{d.label}</span>
            <span className="font-mono-label text-sm font-extrabold tabular-nums text-ink">
              {d.value} / {total}
            </span>
          </div>
        ))}
        {note && (
          <div className="border-t border-line pt-2.5 text-sm leading-[1.6] text-mute">
            {note}
          </div>
        )}
      </div>
    </div>
  );
}

export function ReportChart({
  kind,
  eyebrow,
  title,
  data,
  description,
}: {
  kind: 'bar' | 'line' | 'pie';
  eyebrow: string;
  title?: string;
  data?: ToplineChartDatum[];
  description?: string;
}) {
  const rows = data ?? [];
  if (rows.length === 0) return null;
  return (
    <ChartFrame
      eyebrow={eyebrow}
      title={title}
      footnote={kind === 'pie' ? undefined : description}
    >
      {kind === 'pie' ? (
        <PieChart data={rows} note={description} />
      ) : (
        <BarChart data={rows} />
      )}
    </ChartFrame>
  );
}

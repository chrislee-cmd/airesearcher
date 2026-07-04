'use client';

import { useTranslations } from 'next-intl';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  SearchArtifact,
  TableArtifact,
  QuoteListArtifact,
  ChartArtifact,
} from '@/lib/interview-v2/types';

// Interview V2 search — structured artifacts (Phase 1 table + quote list,
// Phase 2 bar/pie chart).
//
// The search answer streams answer_md + inline citations as before; when the
// model detects a "who-said-what / compare / exact-quote" signal it emits a
// table/quote_list, and on a "share / ratio / distribution" signal it emits a
// `chart`. We render each artifact below the markdown answer. Values are
// grounded in the retrieved evidence and server re-verified in the route's
// onFinish (respondent_ids/chunk_id existence + quote fuzzy match + chart count
// recompute); this component is presentation-only.

// amore + ink + mute (design tokens) + 2 accents; cycles for 6+ series.
const CHART_COLORS = [
  'var(--color-amore)',
  'var(--color-ink)',
  'var(--color-mute)',
  '#f97316',
  '#a855f7',
];

export function AnswerArtifactRenderer({
  artifacts,
}: {
  artifacts: SearchArtifact[];
}) {
  if (!artifacts || artifacts.length === 0) return null;
  return (
    <div className="mt-4 space-y-4">
      {artifacts.map((a, i) => {
        if (a.type === 'table') return <ArtifactTable key={i} {...a} />;
        if (a.type === 'quote_list') return <ArtifactQuoteList key={i} {...a} />;
        if (a.type === 'chart') return <ArtifactChart key={i} {...a} />;
        return null;
      })}
    </div>
  );
}

function ArtifactTable({ title, headers, rows }: TableArtifact) {
  const t = useTranslations('InterviewsV2');
  return (
    <div className="rounded-sm border border-line-soft bg-paper-soft p-3">
      {title && (
        <h4 className="mb-2 text-sm font-semibold text-ink-2">📊 {title}</h4>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line-soft">
              {headers.map((h, i) => (
                <th
                  key={i}
                  className="px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-[0.18em] text-mute-soft"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-b border-line-soft last:border-b-0">
                {row.map((cell, c) => (
                  <td key={c} className="px-2 py-1.5 align-top text-ink-2">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs-soft text-mute-soft">
        {t('artifactTableFooter', { count: rows.length })}
      </p>
    </div>
  );
}

function ArtifactChart({
  title,
  chart_type,
  series,
  description,
}: ChartArtifact) {
  const t = useTranslations('InterviewsV2');
  const data = series.map((s) => ({
    name: s.label,
    value: s.count,
  }));
  const total = series.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="rounded-sm border border-line-soft bg-paper-soft p-3">
      {title && (
        <h4 className="mb-2 text-sm font-semibold text-ink-2">
          {chart_type === 'bar' ? '📊' : '🥧'} {title}
        </h4>
      )}
      {description && (
        <p className="mb-2 text-xs-soft text-mute">{description}</p>
      )}
      <div className="h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {chart_type === 'bar' ? (
            <BarChart data={data}>
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(value, _name, entry) => [
                  t('artifactChartTooltip', { count: Number(value) }),
                  entry?.payload?.name ?? '',
                ]}
              />
              <Bar dataKey="value">
                {data.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          ) : (
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                label={(entry) => `${entry.name} (${entry.value})`}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, name) => [
                  t('artifactChartTooltip', { count: Number(value) }),
                  name ?? '',
                ]}
              />
            </PieChart>
          )}
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs-soft text-mute-soft">
        {t('artifactChartFooter', { count: total })}
      </p>
    </div>
  );
}

function ArtifactQuoteList({ title, quotes }: QuoteListArtifact) {
  return (
    <div className="rounded-sm border border-line-soft bg-paper-soft p-3">
      {title && (
        <h4 className="mb-2 text-sm font-semibold text-ink-2">💬 {title}</h4>
      )}
      <ul className="space-y-2">
        {quotes.map((q, i) => (
          <li key={i} className="border-l-2 border-amore pl-3">
            <p className="text-sm italic leading-[1.7] text-ink-2">
              “{q.quote}”
            </p>
            <p className="mt-1 text-xs-soft text-mute">
              — {q.respondent}
              {q.chunk_id && (
                <span className="ml-1 font-mono text-mute-soft">
                  [{q.chunk_id.slice(0, 6)}]
                </span>
              )}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

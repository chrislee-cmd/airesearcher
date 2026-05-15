'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import * as XLSX from 'xlsx';
import { DownloadMenu } from './ui/download-menu';
import {
  buildCrossTab,
  summarizeColumns,
  toCsv,
  type ColumnSummary,
  type CrossTab,
  type Row,
} from '@/lib/quant/crosstab';
import { EmptyState } from '@/components/ui/empty-state';
import { FileDropZone } from './ui/file-drop-zone';

const ACCEPT = '.csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type Mode = 'count' | 'colpct' | 'rowpct';

function fmtPct(n: number, denom: number): string {
  if (!denom) return '—';
  const v = (n / denom) * 100;
  return `${v.toFixed(1)}%`;
}

function fmtCell(value: number, denom: number, mode: Mode): string {
  if (mode === 'count') return value.toLocaleString();
  return fmtPct(value, denom);
}

// Heuristic — anything with too many distinct values would produce a
// table too wide/long to be useful as a banner/question. We still let
// the user pick it, just demote the visual prominence.
function looksUsable(c: ColumnSummary): boolean {
  return c.uniqueCount >= 2 && c.uniqueCount <= 30;
}

export function QuantAnalyzer() {
  const t = useTranslations('Quant');

  const [filename, setFilename] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  const [rowCol, setRowCol] = useState<string | null>(null);
  const [colCol, setColCol] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('colpct');

  const summaries = useMemo<ColumnSummary[]>(
    () => (rows ? summarizeColumns(rows) : []),
    [rows],
  );

  const crossTab = useMemo<CrossTab | null>(() => {
    if (!rows || !rowCol || !colCol || rowCol === colCol) return null;
    return buildCrossTab(rows, rowCol, colCol);
  }, [rows, rowCol, colCol]);

  async function ingest(file: File) {
    setParsing(true);
    setError(null);
    setRows(null);
    setFilename(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error('empty_workbook');
      const parsed = XLSX.utils.sheet_to_json<Row>(sheet, { defval: null });
      if (parsed.length === 0) throw new Error('empty_sheet');
      setRows(parsed);
      setFilename(file.name);
      // Auto-pick reasonable defaults: first usable column for both
      // axes, second usable column as banner if available.
      const cols = summarizeColumns(parsed).filter(looksUsable);
      if (cols.length > 0) setRowCol(cols[0].name);
      if (cols.length > 1) setColCol(cols[1].name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'parse_failed');
    } finally {
      setParsing(false);
    }
  }

  function onSelectFiles(files: File[]) {
    if (files.length === 0) return;
    void ingest(files[0]);
  }

  function clearAll() {
    setRows(null);
    setFilename(null);
    setRowCol(null);
    setColCol(null);
    setError(null);
  }

  function crosstabFilename(): string {
    const stamp = new Date().toISOString().slice(0, 10);
    return `crosstab_${stamp}.csv`;
  }

  return (
    <div className="space-y-6">
      {/* ─── Stage 1 — File upload ─── */}
      {!rows && (
        <FileDropZone
          data-coach="quant:upload"
          accept={ACCEPT}
          onFiles={onSelectFiles}
          label={t('dropHere')}
          helperText={t('supported')}
          className="py-14"
        >
          {parsing && (
            <div className="mt-3 text-[11.5px] uppercase tracking-[0.18em] text-amore">
              {t('parsing')}
            </div>
          )}
          {error && (
            <div className="mt-3 text-[11.5px] text-warning">
              {t('parseError')}: <span className="font-mono">{error}</span>
            </div>
          )}
        </FileDropZone>
      )}

      {/* ─── Stage 2 — Cross-tab UI ─── */}
      {rows && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
                {t('loaded')}
              </div>
              <div className="mt-1 truncate text-[13.5px] font-semibold text-ink-2">
                {filename}
              </div>
              <div className="mt-1 text-[11.5px] tabular-nums text-mute-soft">
                {t('respondents', { count: rows.length })} ·{' '}
                {t('columns', { count: summaries.length })}
              </div>
            </div>
            <button
              type="button"
              onClick={clearAll}
              className="border border-line px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-mute hover:text-ink-2 [border-radius:14px]"
            >
              {t('reset')}
            </button>
          </div>

          {/* Pickers */}
          <div data-coach="quant:pickers" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ColumnPicker
              label={t('questionLabel')}
              hint={t('questionHint')}
              summaries={summaries}
              value={rowCol}
              onChange={setRowCol}
              disabledKey={colCol}
            />
            <ColumnPicker
              label={t('bannerLabel')}
              hint={t('bannerHint')}
              summaries={summaries}
              value={colCol}
              onChange={setColCol}
              disabledKey={rowCol}
            />
          </div>

          {/* Display-mode toggle + export */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div data-coach="quant:modes" className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.18em]">
              {(['count', 'colpct', 'rowpct'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`border px-3 py-1.5 transition-colors duration-[120ms] [border-radius:14px] ${
                    mode === m
                      ? 'border-ink bg-ink text-paper'
                      : 'border-line text-mute hover:text-ink-2'
                  }`}
                >
                  {t(`mode_${m}`)}
                </button>
              ))}
            </div>
            <DownloadMenu
              tone="ghost"
              align="end"
              disabled={!crossTab}
              label={t('exportCsv')}
              items={[
                {
                  format: 'csv',
                  kind: 'blob',
                  filename: crosstabFilename(),
                  build: () =>
                    new Blob([toCsv(crossTab!)], {
                      type: 'text/csv;charset=utf-8',
                    }),
                },
              ]}
            />
          </div>

          {/* Result table */}
          {crossTab ? (
            <CrosstabTable t={crossTab} mode={mode} />
          ) : rowCol === colCol && rowCol ? (
            <div className="border border-warning-line bg-warning-bg p-4 text-[12.5px] text-ink-2 [border-radius:14px]">
              {t('samePickError')}
            </div>
          ) : (
            <EmptyState tone="subtle" title={t('pickPrompt')} />
          )}
        </>
      )}
    </div>
  );
}

function ColumnPicker({
  label,
  hint,
  summaries,
  value,
  onChange,
  disabledKey,
}: {
  label: string;
  hint: string;
  summaries: ColumnSummary[];
  value: string | null;
  onChange: (v: string) => void;
  disabledKey: string | null;
}) {
  const summary = summaries.find((s) => s.name === value);
  return (
    <div className="border border-line bg-paper p-4 [border-radius:14px]">
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-amore">
        {label}
      </div>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full border border-line bg-paper px-2 py-1.5 text-[12.5px] text-ink-2 focus:border-amore focus:outline-none [border-radius:14px]"
      >
        <option value="">—</option>
        {summaries.map((s) => (
          <option key={s.name} value={s.name} disabled={s.name === disabledKey}>
            {s.name} ({s.uniqueCount})
          </option>
        ))}
      </select>
      <p className="mt-2 text-[11px] text-mute-soft">{hint}</p>
      {summary && summary.sample.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {summary.sample.map((v) => (
            <span
              key={v}
              className="border border-line-soft px-1.5 py-0.5 text-[10.5px] text-mute [border-radius:2px]"
            >
              {v}
            </span>
          ))}
          {summary.uniqueCount > summary.sample.length && (
            <span className="text-[10.5px] text-mute-soft">
              +{summary.uniqueCount - summary.sample.length}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function CrosstabTable({ t: ct, mode }: { t: CrossTab; mode: Mode }) {
  // Heatmap range lives across all cells of the chosen mode so the
  // intensity is comparable.
  const cellValues = ct.counts.flatMap((row, i) =>
    row.map((c, j) =>
      mode === 'count'
        ? c
        : mode === 'colpct'
        ? ct.colTotals[j] === 0
          ? 0
          : c / ct.colTotals[j]
        : ct.rowTotals[i] === 0
        ? 0
        : c / ct.rowTotals[i],
    ),
  );
  const maxV = Math.max(0, ...cellValues);

  function intensity(v: number): number {
    if (maxV === 0) return 0;
    return Math.min(1, v / maxV);
  }

  return (
    <div className="overflow-x-auto border border-line bg-paper [border-radius:14px]">
      <table className="w-full border-collapse text-[12px] tabular-nums">
        <thead>
          <tr className="bg-paper-soft text-ink-2">
            <th className="border-b border-line px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-[0.18em] text-mute-soft">
              {ct.rowName} <span className="text-mute">×</span> {ct.colName}
            </th>
            {ct.colValues.map((cv) => (
              <th
                key={cv}
                className="border-b border-line px-3 py-2 text-right font-semibold"
              >
                {cv}
              </th>
            ))}
            <th className="border-b border-line bg-paper-soft px-3 py-2 text-right text-mute-soft">
              Σ
            </th>
          </tr>
        </thead>
        <tbody>
          {ct.rowValues.map((rv, i) => (
            <tr key={rv} className="border-b border-line-soft last:border-0">
              <th className="px-3 py-1.5 text-left text-[12px] font-medium text-ink-2">
                {rv}
              </th>
              {ct.counts[i].map((c, j) => {
                const denomCol = ct.colTotals[j];
                const denomRow = ct.rowTotals[i];
                const ratio =
                  mode === 'count'
                    ? c
                    : mode === 'colpct'
                    ? denomCol === 0
                      ? 0
                      : c / denomCol
                    : denomRow === 0
                    ? 0
                    : c / denomRow;
                const denom =
                  mode === 'colpct' ? denomCol : mode === 'rowpct' ? denomRow : 1;
                const heat = intensity(ratio);
                return (
                  <td
                    key={j}
                    className="px-3 py-1.5 text-right text-ink-2"
                    style={{
                      backgroundColor:
                        heat > 0
                          ? `rgba(31, 87, 149, ${(heat * 0.18).toFixed(3)})`
                          : undefined,
                    }}
                    title={`${c.toLocaleString()} / ${(mode === 'colpct'
                      ? denomCol
                      : mode === 'rowpct'
                      ? denomRow
                      : ct.total
                    ).toLocaleString()}`}
                  >
                    {fmtCell(c, denom, mode)}
                  </td>
                );
              })}
              <td className="bg-paper-soft px-3 py-1.5 text-right text-mute-soft">
                {ct.rowTotals[i].toLocaleString()}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-line bg-paper-soft text-mute">
            <th className="px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-[0.18em]">
              Σ
            </th>
            {ct.colTotals.map((c, j) => (
              <td key={j} className="px-3 py-2 text-right">
                {c.toLocaleString()}
              </td>
            ))}
            <td className="px-3 py-2 text-right font-semibold text-ink-2">
              {ct.total.toLocaleString()}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

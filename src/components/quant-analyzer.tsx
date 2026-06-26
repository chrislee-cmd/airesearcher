'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from './ui/button';
import { DownloadMenu } from './ui/download-menu';
import { ShareMenu } from './ui/share-menu';
import {
  buildCrossTab,
  summarizeColumns,
  toCsv,
  type ColumnSummary,
  type CrossTab,
  type Row,
} from '@/lib/quant/crosstab';

function crossTabToRows(t: CrossTab): string[][] {
  const header = ['', ...t.colValues, '합계'];
  const body = t.rowValues.map((rv, i) => [
    rv,
    ...t.counts[i].map((n) => String(n)),
    String(t.rowTotals[i]),
  ]);
  const footer = ['합계', ...t.colTotals.map((n) => String(n)), String(t.total)];
  return [header, ...body, footer];
}
import { EmptyState } from '@/components/ui/empty-state';
import { FileDropZone } from './ui/file-drop-zone';

const ACCEPT = '.csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type Mode = 'count' | 'colpct' | 'rowpct';

// Unwrap an exceljs cell value into a primitive so cross-tab logic (which
// expects strings/numbers/null) treats rich-text and formula cells the
// same as plain ones.
function unwrapCellValue(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray((o as { richText?: unknown }).richText)) {
      return ((o as { richText: { text?: string }[] }).richText)
        .map((r) => r.text ?? '')
        .join('');
    }
    if ('text' in o) return unwrapCellValue((o as { text: unknown }).text);
    if ('result' in o) return unwrapCellValue((o as { result: unknown }).result);
    if ('hyperlink' in o) return String((o as { hyperlink: unknown }).hyperlink);
    if ('error' in o) return String((o as { error: unknown }).error);
  }
  return String(v);
}

// Reproduces the shape of `XLSX.utils.sheet_to_json({ defval: null })` for
// an exceljs worksheet: first non-empty row is treated as headers, every
// subsequent row becomes a `{ header: value | null }` object.
function sheetToJson(sheet: import('exceljs').Worksheet): Row[] {
  let headerRowNumber: number | null = null;
  const headers: string[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (headerRowNumber != null) return;
    headerRowNumber = rowNumber;
    const max = row.cellCount;
    for (let c = 1; c <= max; c++) {
      const raw = unwrapCellValue(row.getCell(c).value);
      headers.push(raw == null ? '' : String(raw));
    }
  });
  if (headerRowNumber == null) return [];

  const out: Row[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRowNumber!) return;
    const obj: Row = {};
    let hasAny = false;
    for (let i = 0; i < headers.length; i++) {
      const v = unwrapCellValue(row.getCell(i + 1).value);
      obj[headers[i] ?? `_col${i}`] = v == null ? null : v;
      if (v != null && v !== '') hasAny = true;
    }
    if (hasAny) out.push(obj);
  });
  return out;
}

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
      const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
      let parsed: Row[];
      if (isCsv) {
        const text = await file.text();
        const { parseCsvString } = await import('@/lib/csv-parse');
        parsed = parseCsvString(text).rows as Row[];
      } else {
        const buf = await file.arrayBuffer();
        // exceljs is heavy (~1MB) — load only when the user actually uploads
        // a spreadsheet so it doesn't ship in the main page bundle.
        const ExcelJS = (await import('exceljs')).default;
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);
        const sheet = wb.worksheets[0];
        if (!sheet) throw new Error('empty_workbook');
        parsed = sheetToJson(sheet);
      }
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
          accept={ACCEPT}
          onFiles={onSelectFiles}
          label={t('dropHere')}
          helperText={t('supported')}
          className="py-14"
        >
          {parsing && (
            <div className="mt-3 text-sm uppercase tracking-[0.18em] text-amore">
              {t('parsing')}
            </div>
          )}
          {error && (
            <div className="mt-3 text-sm text-warning">
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
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
                {t('loaded')}
              </div>
              <div className="mt-1 truncate text-lg font-semibold text-ink-2">
                {filename}
              </div>
              <div className="mt-1 text-sm tabular-nums text-mute-soft">
                {t('respondents', { count: rows.length })} ·{' '}
                {t('columns', { count: summaries.length })}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAll}
              className="!px-3 !text-sm uppercase tracking-[0.18em]"
            >
              {t('reset')}
            </Button>
          </div>

          {/* Pickers */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            <div className="flex items-center gap-1 text-xs-soft font-semibold uppercase tracking-[0.18em]">
              {(['count', 'colpct', 'rowpct'] as const).map((m) => (
                <Button
                  key={m}
                  variant={mode === m ? 'primary' : 'ghost'}
                  size="xs"
                  onClick={() => setMode(m)}
                  className="!px-3 !py-1.5 uppercase tracking-[0.18em]"
                >
                  {t(`mode_${m}`)}
                </Button>
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
            <ShareMenu
              align="end"
              disabled={!crossTab}
              items={[
                {
                  destination: 'google-sheets',
                  title: '정량 분석',
                  getRows: () => crossTabToRows(crossTab!),
                },
              ]}
            />
          </div>

          {/* Result table */}
          {crossTab ? (
            <CrosstabTable t={crossTab} mode={mode} />
          ) : rowCol === colCol && rowCol ? (
            <div className="border border-warning-line bg-warning-bg p-4 text-md text-ink-2 rounded-sm">
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
    <div className="border border-line bg-paper p-4 rounded-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-amore">
        {label}
      </div>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full border border-line bg-paper px-2 py-1.5 text-md text-ink-2 focus:border-amore focus:outline-none rounded-sm"
      >
        <option value="">—</option>
        {summaries.map((s) => (
          <option key={s.name} value={s.name} disabled={s.name === disabledKey}>
            {s.name} ({s.uniqueCount})
          </option>
        ))}
      </select>
      <p className="mt-2 text-sm text-mute-soft">{hint}</p>
      {summary && summary.sample.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {summary.sample.map((v) => (
            <span
              key={v}
              className="border border-line-soft px-1.5 py-0.5 text-xs-soft text-mute [border-radius:2px]"
            >
              {v}
            </span>
          ))}
          {summary.uniqueCount > summary.sample.length && (
            <span className="text-xs-soft text-mute-soft">
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
    <div className="overflow-x-auto border border-line bg-paper rounded-sm">
      <table className="w-full border-collapse text-md tabular-nums">
        <thead>
          <tr className="bg-paper-soft text-ink-2">
            <th className="border-b border-line px-3 py-2 text-left text-xs-soft font-semibold uppercase tracking-[0.18em] text-mute-soft">
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
              <th className="px-3 py-1.5 text-left text-md font-medium text-ink-2">
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
            <th className="px-3 py-2 text-left text-xs-soft font-semibold uppercase tracking-[0.18em]">
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

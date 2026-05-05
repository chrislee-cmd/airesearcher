// Pure helpers for cross-tab analysis. No DOM / framework deps so this
// can be unit-tested or moved server-side later.

export type Row = Record<string, unknown>;

export type ColumnSummary = {
  name: string;
  uniqueCount: number;
  nullCount: number;
  numericRatio: number;
  // Sample values for the column-picker preview.
  sample: string[];
};

export type CrossTab = {
  rowName: string;
  colName: string;
  rowValues: string[];
  colValues: string[];
  // counts[i][j] = number of rows where rowCol = rowValues[i] AND
  // colCol = colValues[j].
  counts: number[][];
  rowTotals: number[];
  colTotals: number[];
  total: number;
};

export function summarizeColumns(rows: Row[]): ColumnSummary[] {
  if (rows.length === 0) return [];
  // Use the first row's keys; assume CSV-like uniform schema. If a later
  // row introduces a new column it'll just be missing from the summary
  // (but still selectable if surfaced elsewhere).
  const keys = Object.keys(rows[0]);
  return keys.map((name) => {
    const values: string[] = [];
    let nullCount = 0;
    let numeric = 0;
    const seen = new Set<string>();
    for (const r of rows) {
      const v = r[name];
      if (v === null || v === undefined || v === '') {
        nullCount += 1;
        continue;
      }
      const s = String(v);
      seen.add(s);
      if (values.length < 5 && !values.includes(s)) values.push(s);
      const n = Number(v);
      if (!Number.isNaN(n) && Number.isFinite(n)) numeric += 1;
    }
    const denom = rows.length - nullCount || 1;
    return {
      name,
      uniqueCount: seen.size,
      nullCount,
      numericRatio: numeric / denom,
      sample: values,
    };
  });
}

function normalize(v: unknown): string {
  if (v === null || v === undefined) return '(빈 값)';
  const s = String(v).trim();
  return s === '' ? '(빈 값)' : s;
}

// Sort categorical values numerically when possible (so likert scales
// 1..5 land in order), otherwise alphabetically.
function sortValues(values: string[]): string[] {
  const allNumeric = values.every((v) => v !== '(빈 값)' && !Number.isNaN(Number(v)));
  if (allNumeric) {
    return [...values].sort((a, b) => Number(a) - Number(b));
  }
  // Push the placeholder for nulls to the end.
  const others = values.filter((v) => v !== '(빈 값)').sort((a, b) => a.localeCompare(b, 'ko'));
  return values.includes('(빈 값)') ? [...others, '(빈 값)'] : others;
}

export function buildCrossTab(rows: Row[], rowCol: string, colCol: string): CrossTab {
  const rowSet = new Set<string>();
  const colSet = new Set<string>();
  const pairs: { r: string; c: string }[] = [];
  for (const r of rows) {
    const rv = normalize(r[rowCol]);
    const cv = normalize(r[colCol]);
    rowSet.add(rv);
    colSet.add(cv);
    pairs.push({ r: rv, c: cv });
  }
  const rowValues = sortValues(Array.from(rowSet));
  const colValues = sortValues(Array.from(colSet));
  const rowIdx = new Map(rowValues.map((v, i) => [v, i]));
  const colIdx = new Map(colValues.map((v, i) => [v, i]));
  const counts: number[][] = rowValues.map(() => colValues.map(() => 0));
  for (const p of pairs) {
    const ri = rowIdx.get(p.r);
    const ci = colIdx.get(p.c);
    if (ri === undefined || ci === undefined) continue;
    counts[ri][ci] += 1;
  }
  const colTotals = colValues.map((_, j) =>
    counts.reduce((s, row) => s + row[j], 0),
  );
  const rowTotals = counts.map((row) => row.reduce((s, n) => s + n, 0));
  const total = rowTotals.reduce((s, n) => s + n, 0);
  return { rowName: rowCol, colName: colCol, rowValues, colValues, counts, rowTotals, colTotals, total };
}

export function toCsv(t: CrossTab): string {
  const esc = (s: string) =>
    /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const head = [esc(`${t.rowName} \\ ${t.colName}`), ...t.colValues.map(esc), 'Total'];
  const body = t.rowValues.map((rv, i) => [
    esc(rv),
    ...t.counts[i].map(String),
    String(t.rowTotals[i]),
  ]);
  const tail = ['Total', ...t.colTotals.map(String), String(t.total)];
  return [head, ...body, tail].map((r) => r.join(',')).join('\n');
}

import ExcelJS from 'exceljs';

// Shared XLSX → row-objects parser, backed by exceljs (already a dependency —
// see scheduler/csv.ts which inlined the same logic). Kept generic so any
// feature that ingests spreadsheet uploads can reuse one hardened cell-unwrap
// path instead of re-deriving richText/formula/hyperlink handling.

export type XlsxRows = {
  headers: string[];
  rows: Record<string, unknown>[];
};

export async function parseXlsxToRows(buf: ArrayBuffer): Promise<XlsxRows> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheet = wb.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };

  // Header row = first non-empty row in the sheet.
  let headerRowNumber: number | null = null;
  const headers: string[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (headerRowNumber != null) return;
    headerRowNumber = rowNumber;
    const max = row.cellCount;
    for (let c = 1; c <= max; c++) {
      headers.push(cellValueToString(row.getCell(c).value));
    }
  });
  if (headerRowNumber == null) return { headers: [], rows: [] };

  const rows: Record<string, unknown>[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRowNumber!) return;
    const obj: Record<string, unknown> = {};
    let hasAny = false;
    for (let i = 0; i < headers.length; i++) {
      const v = cellValueToRaw(row.getCell(i + 1).value);
      obj[headers[i] ?? `_col${i}`] = v ?? '';
      if (v != null && v !== '') hasAny = true;
    }
    if (hasAny) rows.push(obj);
  });
  return { headers, rows };
}

function cellValueToString(value: unknown): string {
  const raw = cellValueToRaw(value);
  if (raw == null) return '';
  if (raw instanceof Date) {
    return isNaN(raw.getTime()) ? '' : raw.toISOString().slice(0, 10);
  }
  return typeof raw === 'string' ? raw : String(raw);
}

// Unwrap an exceljs cell `value` object, preserving Date/primitive types.
function cellValueToRaw(value: unknown): unknown {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (Array.isArray((v as { richText?: unknown }).richText)) {
      return ((v as { richText: { text?: string }[] }).richText)
        .map((r) => r.text ?? '')
        .join('');
    }
    if ('text' in v) return cellValueToRaw((v as { text: unknown }).text);
    if ('result' in v) return cellValueToRaw((v as { result: unknown }).result);
    if ('error' in v) return String((v as { error: unknown }).error);
    if ('hyperlink' in v) return String((v as { hyperlink: unknown }).hyperlink);
  }
  return String(value);
}

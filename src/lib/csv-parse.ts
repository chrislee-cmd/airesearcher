// Minimal RFC 4180-style CSV parser. Used wherever we previously leaned on
// xlsx's csv path. Handles quoted fields with embedded commas / newlines /
// escaped double-quotes, strips UTF-8 BOM, accepts CR / LF / CRLF row
// terminators, and skips fully blank rows.
//
// Decode multi-encoding buffers with `decodeCsvBuffer` first when the source
// is arbitrary user upload; this parser assumes the input is already a UTF-8
// string.

export type CsvRows = {
  headers: string[];
  rows: Record<string, unknown>[];
};

export function parseCsvString(text: string): CsvRows {
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (inQuotes) {
      if (ch === '"') {
        if (stripped[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        row.push(field);
        field = '';
        if (row.some((c) => c !== '')) records.push(row);
        row = [];
        if (ch === '\r' && stripped[i + 1] === '\n') i++;
      } else {
        field += ch;
      }
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((c) => c !== '')) records.push(row);
  }

  if (records.length === 0) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.trim());
  const rows: Record<string, unknown>[] = [];
  for (let r = 1; r < records.length; r++) {
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c] ?? `_col${c}`] = records[r][c] ?? '';
    }
    rows.push(obj);
  }
  return { headers, rows };
}

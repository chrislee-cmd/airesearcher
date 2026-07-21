const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export async function createGoogleSheet(
  accessToken: string,
  title: string,
  rows: string[][],
): Promise<{ url: string; spreadsheetId: string }> {
  const rowData = rows.map((row) => ({
    values: row.map((cell) => ({
      userEnteredValue: { stringValue: cell },
    })),
  }));

  const body = {
    properties: { title },
    sheets: [
      {
        properties: { title: 'Sheet1' },
        data: [{ rowData }],
      },
    ],
  };

  const res = await fetch(SHEETS_BASE, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`sheets_create_failed: ${res.status} ${msg}`);
  }
  const sheet = (await res.json()) as { spreadsheetId: string };

  return {
    spreadsheetId: sheet.spreadsheetId,
    url: `https://docs.google.com/spreadsheets/d/${sheet.spreadsheetId}/edit`,
  };
}

// Pull a spreadsheetId out of a full Google Sheets URL. Accepts the canonical
// `/spreadsheets/d/<id>/edit` shape as well as a bare id pasted directly.
export function extractSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  const m = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  // A bare id (no slashes/spaces) is accepted as-is.
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

// Read the first sheet/tab of a spreadsheet as a header row + value rows.
// Requires the broad `spreadsheets` scope (SHARE_SCOPES) since the target is an
// arbitrary user-owned sheet, not one the app created. The first row is treated
// as headers; rows are normalized to the header count so ragged rows don't drop
// trailing empty cells.
export async function readGoogleSheetValues(
  accessToken: string,
  spreadsheetId: string,
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  // Fetch the first sheet's title so the values range targets it explicitly
  // (a spreadsheet's first tab isn't always named "Sheet1").
  const metaRes = await fetch(
    `${SHEETS_BASE}/${spreadsheetId}?fields=sheets.properties.title`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!metaRes.ok) {
    const msg = await metaRes.text();
    throw new Error(`sheets_meta_failed: ${metaRes.status} ${msg}`);
  }
  const meta = (await metaRes.json()) as {
    sheets?: { properties?: { title?: string } }[];
  };
  const firstTitle = meta.sheets?.[0]?.properties?.title;
  if (!firstTitle) {
    throw new Error('sheets_empty');
  }

  const range = encodeURIComponent(firstTitle);
  const valRes = await fetch(
    `${SHEETS_BASE}/${spreadsheetId}/values/${range}?majorDimension=ROWS`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!valRes.ok) {
    const msg = await valRes.text();
    throw new Error(`sheets_values_failed: ${valRes.status} ${msg}`);
  }
  const data = (await valRes.json()) as { values?: unknown[][] };
  const values = data.values ?? [];
  if (values.length === 0) return { headers: [], rows: [] };

  const headers = values[0].map((h) => String(h ?? '').trim());
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < values.length; r++) {
    const raw = values[r];
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) row[h] = String(raw[i] ?? '');
    });
    rows.push(row);
  }
  return { headers, rows };
}

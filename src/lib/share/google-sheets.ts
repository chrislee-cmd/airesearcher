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

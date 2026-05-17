const DOCS_BASE = 'https://docs.googleapis.com/v1/documents';

export async function createGoogleDoc(
  accessToken: string,
  title: string,
  text: string,
): Promise<{ url: string; documentId: string }> {
  // Step 1: create blank document
  const createRes = await fetch(DOCS_BASE, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ title }),
  });
  if (!createRes.ok) {
    const msg = await createRes.text();
    throw new Error(`docs_create_failed: ${createRes.status} ${msg}`);
  }
  const doc = (await createRes.json()) as { documentId: string };

  // Step 2: insert content via batchUpdate at index 1 (after the title paragraph)
  if (text.trim()) {
    const updateRes = await fetch(`${DOCS_BASE}/${doc.documentId}:batchUpdate`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text: text.trim(),
            },
          },
        ],
      }),
    });
    if (!updateRes.ok) {
      const msg = await updateRes.text();
      throw new Error(`docs_update_failed: ${updateRes.status} ${msg}`);
    }
  }

  return {
    documentId: doc.documentId,
    url: `https://docs.google.com/document/d/${doc.documentId}/edit`,
  };
}

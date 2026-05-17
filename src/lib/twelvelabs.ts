// Twelvelabs v1.3 REST client.
// New asset-based flow: /assets → /indexed-assets → /analyze (Pegasus)
// /search still uses marengo index via /search endpoint.

const BASE = 'https://api.twelvelabs.io/v1.3';

function getKey(): string {
  const key = process.env.TWELVELABS_API_KEY;
  if (!key) throw new Error('missing_twelvelabs_key');
  return key;
}

export function getAnalyzeIndexId(): string {
  const id = process.env.TWELVELABS_ANALYZE_INDEX_ID;
  if (!id) throw new Error('missing_twelvelabs_analyze_index_id');
  return id;
}

export type TLAsset = {
  id: string;
  filename: string;
  status: string;
};

export type TLIndexedAssetStatus =
  | 'ready'
  | 'pending'
  | 'queued'
  | 'indexing'
  | 'failed';

export type TLIndexedAsset = {
  _id: string;
  status: TLIndexedAssetStatus;
  system_metadata?: {
    filename?: string;
    duration?: number;
    fps?: number;
    width?: number;
    height?: number;
    size?: number;
  };
};

// ─── Step 1: Create asset from a publicly accessible URL ─────────────────────
export async function createAsset(
  videoUrl: string,
  filename: string,
): Promise<string> {
  const key = getKey();
  const form = new FormData();
  form.append('method', 'url');
  form.append('url', videoUrl);
  form.append('filename', filename);

  const res = await fetch(`${BASE}/assets`, {
    method: 'POST',
    headers: { 'x-api-key': key },
    body: form,
  });
  const data = (await res.json()) as { id?: string; code?: string; message?: string };
  if (!res.ok || !data.id) {
    throw new Error(data.message ?? `tl_asset_create_${res.status}`);
  }
  return data.id;
}

// ─── Step 2: Index asset into the Pegasus+Marengo index ──────────────────────
// Returns the indexed-asset-id parsed from the Location response header.
export async function createIndexedAsset(
  indexId: string,
  assetId: string,
): Promise<string> {
  const key = getKey();
  const res = await fetch(`${BASE}/indexes/${indexId}/indexed-assets`, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ asset_id: assetId }),
  });

  if (res.status !== 202 && !res.ok) {
    const data = await res.json().catch(() => ({})) as { code?: string; message?: string };
    throw new Error(data.message ?? `tl_indexed_asset_create_${res.status}`);
  }

  // Location header: /indexes/{index-id}/indexed-assets/{indexed-asset-id}
  const location = res.headers.get('location') ?? '';
  const parts = location.split('/');
  const indexedAssetId = parts[parts.length - 1];

  if (!indexedAssetId) {
    // Fallback: try to get from response body
    const body = await res.json().catch(() => ({})) as { _id?: string };
    if (body._id) return body._id;
    throw new Error('tl_indexed_asset_id_missing');
  }
  return indexedAssetId;
}

// ─── Step 3: Poll indexed asset status ───────────────────────────────────────
export async function getIndexedAsset(
  indexId: string,
  indexedAssetId: string,
): Promise<TLIndexedAsset> {
  const key = getKey();
  const res = await fetch(
    `${BASE}/indexes/${indexId}/indexed-assets/${indexedAssetId}`,
    { headers: { 'x-api-key': key } },
  );
  const data = (await res.json()) as TLIndexedAsset & { code?: string; message?: string };
  if (!res.ok) {
    throw new Error((data as { message?: string }).message ?? `tl_indexed_asset_get_${res.status}`);
  }
  return data;
}

// ─── Step 4: Analyze with Pegasus (open-ended prompt) ────────────────────────
// video_id = indexed-asset-id from step 2/3.
export async function analyzeVideo(
  videoId: string,
  prompt: string,
  maxTokens = 4000,
): Promise<string> {
  const key = getKey();
  const res = await fetch(`${BASE}/analyze`, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      video_id: videoId,
      prompt,
      temperature: 0.2,
      max_tokens: maxTokens,
    }),
  });
  const data = (await res.json()) as { data?: string; code?: string; message?: string };
  if (!res.ok) {
    throw new Error(data.message ?? `tl_analyze_${res.status}`);
  }
  return data.data ?? '';
}

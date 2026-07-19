// Twelvelabs v1.3 REST client.
// New asset-based flow: /assets → /indexed-assets → /analyze (Pegasus)
// /search still uses marengo index via /search endpoint.

import { env } from '@/env';

const BASE = 'https://api.twelvelabs.io/v1.3';

function getKey(): string {
  const key = env.TWELVELABS_API_KEY;
  if (!key) throw new Error('missing_twelvelabs_key');
  return key;
}

export function getAnalyzeIndexId(): string {
  const id = env.TWELVELABS_ANALYZE_INDEX_ID;
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
  const data = (await res.json()) as { id?: string; _id?: string; code?: string; message?: string };
  const assetId = data.id ?? data._id;
  if (!res.ok || !assetId) {
    throw new Error(data.message ?? `tl_asset_create_${res.status}`);
  }
  return assetId;
}

// True if the error from POST /indexed-assets means "asset isn't ready yet" —
// TL is still downloading/transcoding the asset behind the scenes. Callers
// should defer indexing and retry later instead of failing the upload.
export function isAssetStillProcessing(err: unknown): boolean {
  return err instanceof Error && /being processed/i.test(err.message);
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
    const text = await res.text().catch(() => '');
    let msg: string | undefined;
    try { msg = (JSON.parse(text) as { message?: string }).message; } catch {}
    throw new Error(msg ?? `tl_indexed_asset_create_${res.status}: ${text.slice(0, 120)}`);
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
  const text = await res.text();
  let data: TLIndexedAsset & { code?: string; message?: string };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    throw new Error(`tl_indexed_asset_get_${res.status}: ${text.slice(0, 120)}`);
  }
  if (!res.ok) {
    throw new Error(data.message ?? `tl_indexed_asset_get_${res.status}`);
  }
  return data;
}

// ─── Marengo semantic moment search ──────────────────────────────────────────
// Retrieve time ranges in the index that best match a natural-language query
// (혼란/망설임·에러·강한 반응 …). The analyze index is SHARED across every
// video, so callers MUST filter the results down to their own asset via
// `filterVideoId` (the indexed-asset id) — otherwise a search could surface
// moments from another user's session. Returns [] on any error so the caller
// can gracefully fall back to transcript-only segmentation (card 626 §graceful).
export type TLSearchClip = {
  video_id: string;
  score: number;
  confidence?: string;
  start: number; // seconds
  end: number; // seconds
};

export async function searchIndex(
  indexId: string,
  query: string,
  opts?: { filterVideoId?: string; pageLimit?: number },
): Promise<TLSearchClip[]> {
  const key = getKey();
  const form = new FormData();
  form.append('index_id', indexId);
  form.append('query_text', query);
  // Multimodal moment retrieval — screen visuals + spoken audio.
  form.append('search_options', 'visual');
  form.append('search_options', 'audio');
  form.append('page_limit', String(opts?.pageLimit ?? 10));

  const res = await fetch(`${BASE}/search`, {
    method: 'POST',
    headers: { 'x-api-key': key },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`tl_search_${res.status}: ${text.slice(0, 160)}`);
  }
  const body = (await res.json().catch(() => ({}))) as {
    data?: Array<{ video_id?: string; score?: number; confidence?: string; start?: number; end?: number }>;
  };
  const rows = (body.data ?? [])
    .filter((r) => typeof r.start === 'number' && typeof r.end === 'number')
    .map((r) => ({
      video_id: r.video_id ?? '',
      score: typeof r.score === 'number' ? r.score : 0,
      confidence: r.confidence,
      start: r.start as number,
      end: r.end as number,
    }));
  if (opts?.filterVideoId) {
    const mine = rows.filter((r) => r.video_id === opts.filterVideoId);
    // Some deployments key search hits on the asset rather than the indexed
    // asset id; if the filter zeroes everything out, prefer no moments over
    // cross-session leakage — the caller falls back to transcript segments.
    return mine;
  }
  return rows;
}

// ─── Step 4: Analyze with Pegasus 1.5 (open-ended prompt) ────────────────────
// Uses the new `video: { type: "asset_id", asset_id }` form. The legacy
// `video_id` parameter is deprecated and worked only with pegasus1.2 — and the
// id it expected is NOT the indexed-asset _id. The asset_id below is the ID
// returned by POST /assets (saved as `tl_asset_id`), not `tl_indexed_asset_id`.
//
// /analyze returns NDJSON (one JSON object per line):
//   {"event_type":"stream_start","metadata":{...}}
//   {"event_type":"text_generation","text":"..."}
//   {"event_type":"stream_end",...}
export async function analyzeVideo(
  assetId: string,
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
      model_name: 'pegasus1.5',
      video: { type: 'asset_id', asset_id: assetId },
      prompt,
      temperature: 0.2,
      max_tokens: maxTokens,
      stream: true,
    }),
  });

  const rawText = await res.text();

  if (!res.ok) {
    // Try to get an error message from the first parseable line
    const firstLine = rawText.split('\n').find((l) => l.trim());
    let msg: string | undefined;
    try { msg = (JSON.parse(firstLine ?? '') as { message?: string }).message; } catch {}
    throw new Error(msg ?? `tl_analyze_${res.status}: ${rawText.slice(0, 200)}`);
  }

  // Parse NDJSON — each non-empty line is a separate JSON event
  const chunks: string[] = [];
  for (const line of rawText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as { event_type?: string; text?: string };
      if (event.event_type === 'text_generation' && event.text) {
        chunks.push(event.text);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return chunks.join('');
}

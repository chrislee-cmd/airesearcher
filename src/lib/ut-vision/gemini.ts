// Gemini video-understanding client for AI-UT behavior analysis (card 622).
//
// Why REST (not @ai-sdk/google): the recording must be read as VIDEO, and the
// repo's AI SDK provider is Anthropic, which is image-only — extracting frames
// server-side would need ffmpeg (absent). Gemini reads video natively and
// samples it itself (~1 fps by default), which satisfies the spec's frame-
// sampling cost constraint without a new npm dependency or an ffmpeg binary. We
// call the public Generative Language REST API directly with the existing
// GEMINI_API_KEY.
//
// Flow: Files API resumable upload → poll until the file is ACTIVE (video
// processing) → generateContent with responseMimeType=json + a response schema
// → best-effort delete. Every failure is surfaced as a typed result so the
// caller keeps the session graceful (analysis failure never fails the session).
import { geminiResponseSchema } from './schema';

const BASE = 'https://generativelanguage.googleapis.com';
// gemini-2.5-flash: video-capable, cheap, high context — the cost-sensible
// choice for sampling a full UT recording.
const MODEL = 'gemini-2.5-flash';

const FILE_ACTIVE_TIMEOUT_MS = 90_000;
const FILE_POLL_INTERVAL_MS = 2_000;

export type GeminiResult =
  | { ok: true; json: unknown }
  | { ok: false; error: string; status: number };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Resumable upload — start handshake returns an upload URL, then a single
// upload+finalize command streams the bytes. Returns the file resource
// (name + uri + state).
async function uploadFile(
  apiKey: string,
  bytes: Buffer,
  mimeType: string,
): Promise<{ ok: true; name: string; uri: string; state: string } | { ok: false; error: string; status: number }> {
  const startRes = await fetch(`${BASE}/upload/v1beta/files?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.length),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: 'ut-recording' } }),
  });
  if (!startRes.ok) {
    return { ok: false, error: `upload_start_${startRes.status}`, status: 502 };
  }
  const uploadUrl = startRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) return { ok: false, error: 'no_upload_url', status: 502 };

  const upRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
      'content-length': String(bytes.length),
    },
    // Copy into a plain Uint8Array — a valid BodyInit (ArrayBufferView) that
    // sidesteps the Node Buffer vs DOM fetch type conflict.
    body: new Uint8Array(bytes),
  });
  if (!upRes.ok) return { ok: false, error: `upload_finalize_${upRes.status}`, status: 502 };
  const body = (await upRes.json().catch(() => null)) as {
    file?: { name?: string; uri?: string; state?: string };
  } | null;
  const file = body?.file;
  if (!file?.name || !file?.uri) return { ok: false, error: 'upload_no_file', status: 502 };
  return { ok: true, name: file.name, uri: file.uri, state: file.state ?? 'PROCESSING' };
}

// Video files land in PROCESSING and must reach ACTIVE before generateContent
// will accept them. Poll the file resource until ACTIVE / FAILED / timeout.
async function waitActive(apiKey: string, name: string): Promise<'ACTIVE' | 'FAILED' | 'TIMEOUT'> {
  const deadline = Date.now() + FILE_ACTIVE_TIMEOUT_MS;
  // `name` is like "files/abc123"; the resource GET is BASE/v1beta/{name}.
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/v1beta/${name}?key=${apiKey}`);
    if (res.ok) {
      const j = (await res.json().catch(() => null)) as { state?: string } | null;
      if (j?.state === 'ACTIVE') return 'ACTIVE';
      if (j?.state === 'FAILED') return 'FAILED';
    }
    await sleep(FILE_POLL_INTERVAL_MS);
  }
  return 'TIMEOUT';
}

async function deleteFile(apiKey: string, name: string): Promise<void> {
  try {
    await fetch(`${BASE}/v1beta/${name}?key=${apiKey}`, { method: 'DELETE' });
  } catch {
    // Best-effort; the Files API auto-expires uploads after ~48h anyway.
  }
}

// Upload the recording, run the extraction prompt against it, and return the
// parsed JSON candidate (still untyped — the caller validates with zod).
export async function analyzeVideoWithGemini(
  apiKey: string,
  bytes: Buffer,
  mimeType: string,
  prompt: string,
): Promise<GeminiResult> {
  const uploaded = await uploadFile(apiKey, bytes, mimeType);
  if (!uploaded.ok) return uploaded;

  try {
    const state = uploaded.state === 'ACTIVE' ? 'ACTIVE' : await waitActive(apiKey, uploaded.name);
    if (state !== 'ACTIVE') {
      return { ok: false, error: `file_${state.toLowerCase()}`, status: 502 };
    }

    const genRes = await fetch(`${BASE}/v1beta/models/${MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { file_data: { mime_type: mimeType, file_uri: uploaded.uri } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1, // low → reproducible extraction
          responseMimeType: 'application/json',
          responseSchema: geminiResponseSchema,
        },
      }),
    });
    if (!genRes.ok) {
      const detail = await genRes.text().catch(() => '');
      return { ok: false, error: `generate_${genRes.status}: ${detail.slice(0, 160)}`, status: 502 };
    }
    const gen = (await genRes.json().catch(() => null)) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    } | null;
    const text = gen?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text.trim()) return { ok: false, error: 'empty_candidate', status: 502 };

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, error: 'invalid_json', status: 502 };
    }
    return { ok: true, json };
  } finally {
    void deleteFile(apiKey, uploaded.name);
  }
}

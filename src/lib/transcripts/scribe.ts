// Shared ElevenLabs Scribe (speech-to-text) call — the raw round trip that
// both the QA voice-feedback pipeline and the AI-UT session pipeline use. The
// QA route (api/qa/transcribe) still inlines its own copy (intentionally left
// untouched so this PR can't perturb QA data); new callers should use this
// helper so the fetch shape lives in one place.
//
// Short clips only: no webhook flag → the POST blocks until the transcript is
// ready and returns the full body. Fine well inside a 60s function budget.
import { ELEVENLABS_API_MODEL } from './models';
import type { ElevenLabsScribeResult } from './elevenlabs';

export type ScribeOutcome =
  | { ok: true; transcript: string }
  | { ok: false; error: string; status: number };

export async function scribeTranscribe(
  apiKey: string,
  audio: Blob,
  filename: string,
): Promise<ScribeOutcome> {
  const form = new FormData();
  form.append('model_id', ELEVENLABS_API_MODEL);
  form.append('file', audio, filename);

  let resp: Response;
  try {
    resp = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'elevenlabs_fetch_failed';
    return { ok: false, error: msg, status: 502 };
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    return { ok: false, error: `elevenlabs_${resp.status}: ${txt.slice(0, 200)}`, status: 502 };
  }

  const result = (await resp.json().catch(() => ({}))) as ElevenLabsScribeResult;
  const transcript = (result.data?.text ?? result.text ?? '').trim();
  return { ok: true, transcript };
}

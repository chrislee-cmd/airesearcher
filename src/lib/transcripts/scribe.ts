// Shared ElevenLabs Scribe (speech-to-text) call — the raw round trip that
// both the QA voice-feedback pipeline and the AI-UT session pipeline use. The
// QA route (api/qa/transcribe) still inlines its own copy (intentionally left
// untouched so this PR can't perturb QA data); new callers should use this
// helper so the fetch shape lives in one place.
//
// Short clips only: no webhook flag → the POST blocks until the transcript is
// ready and returns the full body. Fine well inside a 60s function budget.
import { ELEVENLABS_API_MODEL } from './models';
import type { ElevenLabsScribeResult, ElevenLabsWord } from './elevenlabs';

export type ScribeOutcome =
  // `words` carries the raw word-level data (start/end/speaker) so callers that
  // need clip-boundary timestamps (AI-UT insight clips, card 626) can persist
  // turns without a second round trip. Empty when Scribe returns text only.
  | { ok: true; transcript: string; words: ElevenLabsWord[] }
  | { ok: false; error: string; status: number };

export async function scribeTranscribe(
  apiKey: string,
  audio: Blob,
  filename: string,
  // Optional STT language hint (ElevenLabs `language_code`, ISO 639-1/-3). When
  // omitted Scribe auto-detects — the historical behaviour every existing caller
  // (quotes/qa) still relies on, so this MUST stay optional and additive. Only
  // the AI-UT pipeline passes it, from the researcher-chosen session language.
  languageCode?: string,
): Promise<ScribeOutcome> {
  const form = new FormData();
  form.append('model_id', ELEVENLABS_API_MODEL);
  form.append('file', audio, filename);
  if (languageCode) form.append('language_code', languageCode);

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
  const root = result.data ?? result;
  const transcript = (root.text ?? '').trim();
  return { ok: true, transcript, words: root.words ?? [] };
}

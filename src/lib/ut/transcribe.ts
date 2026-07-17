// AI-UT transcription pipeline — mirrors api/qa/transcribe but fully separate
// data: it reads the mic-voice track from the `ut-audio` bucket and writes back
// to `ut_sessions.transcript`. NEVER touches qa_feedbacks / qa-feedback-audio.
//
// Callers (POST /api/ut/sessions/[id]/finalize and POST /api/ut/transcribe)
// must have already authorized the request; `admin` is a service-role client.
// Status walk here: (…) → transcribing → done | error.
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/env';
import { scribeTranscribe } from '@/lib/transcripts/scribe';

export type UtTranscribeResult =
  | { ok: true; transcript: string }
  | { ok: false; error: string; status: number };

export async function transcribeUtSession(
  admin: SupabaseClient,
  sessionId: string,
): Promise<UtTranscribeResult> {
  const { data: row, error: rowErr } = await admin
    .from('ut_sessions')
    .select('id, audio_storage_key, status, meta')
    .eq('id', sessionId)
    .single();
  if (rowErr || !row) return { ok: false, error: 'not_found', status: 404 };

  // Preserve client-captured meta (user_agent, …) — error detail is merged in,
  // never clobbered, since the table has no dedicated error column.
  const baseMeta =
    row.meta && typeof row.meta === 'object' ? (row.meta as Record<string, unknown>) : {};
  const failWith = async (error: string) => {
    await admin
      .from('ut_sessions')
      .update({ status: 'error', meta: { ...baseMeta, error } })
      .eq('id', sessionId);
  };

  if (!row.audio_storage_key) {
    await failWith('missing_audio');
    return { ok: false, error: 'missing_audio', status: 400 };
  }

  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    await failWith('missing_elevenlabs_key');
    return { ok: false, error: 'missing_elevenlabs_key', status: 500 };
  }

  await admin.from('ut_sessions').update({ status: 'transcribing' }).eq('id', sessionId);

  // Pull the private mic-audio object down and hand it to Scribe as a multipart
  // file — no signed-URL round trip needed for a small blob.
  const { data: audio, error: dlErr } = await admin.storage
    .from('ut-audio')
    .download(row.audio_storage_key);
  if (dlErr || !audio) {
    await failWith(`download_failed: ${dlErr?.message ?? 'no_data'}`);
    return { ok: false, error: 'download_failed', status: 502 };
  }

  const outcome = await scribeTranscribe(apiKey, audio, 'ut-audio.webm');
  if (!outcome.ok) {
    await failWith(outcome.error);
    return { ok: false, error: outcome.error, status: outcome.status };
  }

  await admin
    .from('ut_sessions')
    .update({ transcript: outcome.transcript, status: 'done' })
    .eq('id', sessionId);
  return { ok: true, transcript: outcome.transcript };
}

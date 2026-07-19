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
import { getLanguage } from '@/lib/transcripts/languages';
import { buildTurnsMs } from '@/lib/transcripts/elevenlabs';

export type UtTranscribeResult =
  | { ok: true; transcript: string }
  | { ok: false; error: string; status: number };

export async function transcribeUtSession(
  admin: SupabaseClient,
  sessionId: string,
): Promise<UtTranscribeResult> {
  const { data: row, error: rowErr } = await admin
    .from('ut_sessions')
    .select('id, audio_storage_key, status, meta, task_goal, target_url, input_language')
    .eq('id', sessionId)
    .single();
  if (rowErr || !row) return { ok: false, error: 'not_found', status: 404 };

  // Preserve client-captured meta (user_agent, …) — error detail is merged in,
  // never clobbered, since the table has no dedicated error column. The
  // researcher-posed task_goal + target_url are stashed into meta.context so the
  // downstream analysis (622 vision timeline, report gen) reads the intent that
  // framed the session co-located with the transcript, without re-querying
  // (spec §4 — task/goal = 분석 컨텍스트). Scribe is pure STT with no prompt
  // slot, so the context lives with the result rather than steering the STT.
  const baseMeta =
    row.meta && typeof row.meta === 'object' ? (row.meta as Record<string, unknown>) : {};
  const context: Record<string, unknown> = {};
  if (row.task_goal) context.task_goal = row.task_goal;
  if (row.target_url) context.target_url = row.target_url;
  const withContext =
    Object.keys(context).length > 0 ? { ...baseMeta, context } : baseMeta;
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

  // Announce the real container to Scribe — the mic track may be m4a (AAC) on
  // browsers that record mp4, not just webm. ElevenLabs sniffs the bytes but the
  // filename extension is a hint, so keep it truthful to the stored object.
  const audioExt = row.audio_storage_key.split('.').pop()?.toLowerCase() || 'webm';
  // Map the stored internal language code (e.g. 'ko', 'zh-TW') to the provider
  // `language_code` Scribe accepts (getLanguage().dgLanguage doubles as the
  // ElevenLabs code). New sessions always carry a value (API-enforced); legacy
  // rows (null) — and any stray 'multi' — resolve to undefined so Scribe keeps
  // auto-detecting for them (backward compatible, no regression).
  const langEntry = row.input_language ? getLanguage(row.input_language) : null;
  const languageCode =
    langEntry && langEntry.code !== 'multi' ? langEntry.dgLanguage : undefined;
  const outcome = await scribeTranscribe(apiKey, audio, `ut-audio.${audioExt}`, languageCode);
  if (!outcome.ok) {
    await failWith(outcome.error);
    return { ok: false, error: outcome.error, status: outcome.status };
  }

  // The core write (transcript + status) goes first and ALONE — this is the
  // contract every existing consumer depends on and must never be coupled to a
  // newer column.
  await admin
    .from('ut_sessions')
    .update({ transcript: outcome.transcript, status: 'done', meta: withContext })
    .eq('id', sessionId);

  // Persist word/turn timestamps in a SEPARATE, best-effort write (626 gap): the
  // clip pipeline snaps moment boundaries to these turn edges. Kept separate so
  // the ~few-minute additive-migration drift window after merge (PROJECT.md
  // §7.5 — the `transcript_words` column lands slightly after this code) can't
  // break the transcript/status write above. Empty when Scribe returned text
  // only; the clip pipeline then falls back to time-only windows.
  const turns = buildTurnsMs({ words: outcome.words });
  if (turns.length > 0) {
    const { error: wordsErr } = await admin
      .from('ut_sessions')
      .update({ transcript_words: turns })
      .eq('id', sessionId);
    if (wordsErr) {
      console.warn('[ut/transcribe] transcript_words persist skipped', wordsErr.message);
    }
  }
  return { ok: true, transcript: outcome.transcript };
}

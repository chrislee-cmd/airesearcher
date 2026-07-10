import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getLanguage } from '@/lib/transcripts/languages';
import { ELEVENLABS_API_MODEL } from '@/lib/transcripts/models';
import { classifyTextFile } from '@/lib/transcripts/text-extract';
import {
  dispatchDeepgram,
  dispatchElevenLabs,
  dispatchTextExtraction,
} from '@/lib/transcripts/dispatch';

// Re-dispatch a stuck / failed transcript job WITHOUT re-uploading the audio.
//
// A job stuck in `submitting` (the real prod case: the upload landed but the
// upload→job-dispatch handoff never completed) already has its audio in
// storage under `storage_key`. Retry re-runs the exact same provider dispatch
// against that existing row — no new row, no re-upload, no double credit
// (credits are charged only on completion in poll/webhook). `error` jobs and
// jobs stuck in `transcribing` (provider never finished) can also be retried.
//
// Same dispatch path as /api/transcripts/start (shared lib/transcripts/dispatch)
// so the paid transcription path is not duplicated.

export const maxDuration = 60;

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Read with the user's RLS — they must own/share the job. We reuse the row's
  // stored storage_key + provider/model/speaker_count so the re-dispatch mirrors
  // the original start call.
  const { data: job, error: fetchErr } = await supabase
    .from('transcript_jobs')
    .select(
      'id, org_id, user_id, storage_key, filename, provider, model, speaker_count, status',
    )
    .eq('id', id)
    .single();
  if (fetchErr || !job) {
    return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  }

  // Only stuck / failed rows are retryable. A `done` job has a result already;
  // a freshly `queued`/`submitting` job that is still progressing is handled by
  // the client, which only exposes retry once a job is old enough to be stuck.
  if (job.status === 'done') {
    return NextResponse.json({ error: 'already_done' }, { status: 400 });
  }
  if (!job.storage_key) {
    // No audio to re-dispatch against (should not happen for real uploads).
    return NextResponse.json({ error: 'no_storage_key' }, { status: 400 });
  }

  // Reset the row to `submitting` and clear the previous failure so the UI
  // immediately leaves the stuck bucket (staleness keys off `updated_at`, which
  // this UPDATE bumps via the touch trigger). provider_request_id is cleared so
  // a stale id from a half-dispatched attempt isn't polled against the new run.
  await supabase
    .from('transcript_jobs')
    .update({
      status: 'submitting',
      error_message: null,
      provider_request_id: null,
      deepgram_request_id: null,
    })
    .eq('id', id);

  // Text files (.txt/.md/.docx) never hit a provider — re-extract directly.
  const textKind = classifyTextFile(job.filename);
  if (textKind) {
    return await dispatchTextExtraction({
      supabase,
      jobId: id,
      orgId: job.org_id,
      userId: job.user_id,
      storageKey: job.storage_key,
      filename: job.filename,
    });
  }

  // Fresh 6h signed URL for the provider to fetch the audio.
  const { data: signed, error: signedErr } = await supabase.storage
    .from('audio-uploads')
    .createSignedUrl(job.storage_key, 60 * 60 * 6);
  if (signedErr || !signed?.signedUrl) {
    await supabase
      .from('transcript_jobs')
      .update({ status: 'error', error_message: signedErr?.message ?? 'sign_failed' })
      .eq('id', id);
    return NextResponse.json(
      { error: signedErr?.message ?? 'sign_failed' },
      { status: 500 },
    );
  }

  if (job.provider === 'deepgram') {
    // Deepgram is English-only in this app (English → Deepgram). The original
    // language code isn't stored on the row; 'en' reconstructs the right
    // nova-3 English entry (en-GB also maps to nova-3, so the model matches).
    return await dispatchDeepgram({
      supabase,
      jobId: id,
      signedUrl: signed.signedUrl,
      langEntry: getLanguage('en'),
    });
  }

  // ElevenLabs (default for everything non-English incl. auto-detect). The
  // original language_code isn't persisted, so we re-dispatch with auto-detect
  // (language_code=null) — Scribe v2 auto-detect is robust. speaker_count IS
  // stored, so the 1·2 diarization hint is preserved.
  return await dispatchElevenLabs({
    supabase,
    jobId: id,
    signedUrl: signed.signedUrl,
    apiModel: job.model ?? ELEVENLABS_API_MODEL,
    languageCode: null,
    numSpeakers:
      job.speaker_count === 1 || job.speaker_count === 2
        ? job.speaker_count
        : null,
  });
}

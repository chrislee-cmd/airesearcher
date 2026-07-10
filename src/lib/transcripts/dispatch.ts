import { NextResponse } from 'next/server';
import { env } from '@/env';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getLanguage } from '@/lib/transcripts/languages';
import {
  extractTextFromBuffer,
  formatAsMarkdown,
} from '@/lib/transcripts/text-extract';
import { spendCreditsAdmin } from '@/lib/credits';

// Provider dispatch — shared by /api/transcripts/start (initial dispatch) and
// /api/transcripts/jobs/[id]/retry (re-dispatch of a stuck row). Each function
// updates an EXISTING transcript_jobs row (the row is inserted by the caller)
// and either flips it to `transcribing` or `error`. Kept out of the route
// files so retry can re-run the exact same dispatch without duplicating the
// paid transcription path.

export type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

export function getDeploymentBaseUrl(): string {
  // Prefer the deployment-specific URL so previews route to themselves.
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  if (env.NEXT_PUBLIC_SITE_URL) return env.NEXT_PUBLIC_SITE_URL;
  return 'http://localhost:3000';
}

export async function dispatchDeepgram(args: {
  supabase: SupabaseServer;
  jobId: string;
  signedUrl: string;
  langEntry: ReturnType<typeof getLanguage>;
}) {
  const { supabase, jobId, signedUrl, langEntry } = args;

  const dgKey = env.DEEPGRAM_API_KEY;
  const webhookSecret = env.DEEPGRAM_WEBHOOK_SECRET;
  if (!dgKey) {
    return NextResponse.json({ error: 'missing_deepgram_key' }, { status: 500 });
  }
  if (!webhookSecret) {
    return NextResponse.json({ error: 'missing_webhook_secret' }, { status: 500 });
  }

  const base = getDeploymentBaseUrl();
  const callbackUrl = `${base}/api/transcripts/webhook?secret=${encodeURIComponent(
    webhookSecret,
  )}&job=${jobId}`;

  const dgUrl =
    'https://api.deepgram.com/v1/listen?' +
    new URLSearchParams({
      model: langEntry.dgModel,
      language: langEntry.dgLanguage,
      diarize: 'true',
      punctuate: 'true',
      utterances: 'true',
      smart_format: 'true',
      paragraphs: 'true',
      callback: callbackUrl,
    }).toString();

  let dgResp: Response;
  try {
    dgResp = await fetch(dgUrl, {
      method: 'POST',
      headers: {
        Authorization: `Token ${dgKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: signedUrl }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'deepgram_fetch_failed';
    await supabase
      .from('transcript_jobs')
      .update({ status: 'error', error_message: msg })
      .eq('id', jobId);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  if (!dgResp.ok) {
    const txt = await dgResp.text().catch(() => '');
    await supabase
      .from('transcript_jobs')
      .update({
        status: 'error',
        error_message: `deepgram_${dgResp.status}: ${txt.slice(0, 200)}`,
      })
      .eq('id', jobId);
    return NextResponse.json(
      { error: 'deepgram_rejected', detail: txt.slice(0, 500) },
      { status: 502 },
    );
  }

  const dgJson = (await dgResp.json().catch(() => ({}))) as {
    request_id?: string;
  };

  await supabase
    .from('transcript_jobs')
    .update({
      status: 'transcribing',
      deepgram_request_id: dgJson.request_id ?? null,
      provider_request_id: dgJson.request_id ?? null,
    })
    .eq('id', jobId);

  return NextResponse.json({
    job_id: jobId,
    provider: 'deepgram',
    request_id: dgJson.request_id ?? null,
  });
}

export async function dispatchElevenLabs(args: {
  supabase: SupabaseServer;
  jobId: string;
  signedUrl: string;
  apiModel: string;
  languageCode: string | null;
  numSpeakers: number | null;
}) {
  const { supabase, jobId, signedUrl, apiModel, languageCode, numSpeakers } =
    args;

  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    await supabase
      .from('transcript_jobs')
      .update({ status: 'error', error_message: 'missing_elevenlabs_key' })
      .eq('id', jobId);
    return NextResponse.json({ error: 'missing_elevenlabs_key' }, { status: 500 });
  }

  // ElevenLabs Speech-to-Text: multipart/form-data with `cloud_storage_url`
  // (the API fetches it itself — no re-upload). We send `webhook=true` so the
  // POST returns immediately with just `transcription_id` instead of blocking
  // until full transcription finishes — long files (a 90-min Korean interview
  // tripped the Vercel 60s timeout in sync mode). The transcription itself
  // is fetched by the client via `/api/transcripts/jobs/[id]/poll`, which
  // proxies `GET /v1/speech-to-text/transcripts/{id}`. (The webhook delivery
  // itself is unreliable — never delivered in practice — so we don't rely
  // on it; `webhook=true` is purely the toggle that switches the dispatch
  // call into async mode.)
  const form = new FormData();
  form.append('model_id', apiModel);
  form.append('cloud_storage_url', signedUrl);
  form.append('diarize', 'true');
  form.append('timestamps_granularity', 'word');
  form.append('tag_audio_events', 'true');
  form.append('webhook', 'true');
  if (languageCode) form.append('language_code', languageCode);
  // 고정 발화자 수 hint (1·2). 미지정이면 ElevenLabs 가 화자 수를 자동 추정.
  if (numSpeakers) form.append('num_speakers', String(numSpeakers));

  let resp: Response;
  try {
    resp = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'elevenlabs_fetch_failed';
    await supabase
      .from('transcript_jobs')
      .update({ status: 'error', error_message: msg })
      .eq('id', jobId);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    await supabase
      .from('transcript_jobs')
      .update({
        status: 'error',
        error_message: `elevenlabs_${resp.status}: ${txt.slice(0, 200)}`,
      })
      .eq('id', jobId);
    return NextResponse.json(
      { error: 'elevenlabs_rejected', detail: txt.slice(0, 500) },
      { status: 502 },
    );
  }

  // ElevenLabs returns: { request_id, transcription_id, message }
  // We store `transcription_id` in `provider_request_id` because that is the
  // id the polling endpoint (GET /v1/speech-to-text/transcripts/{id}) needs.
  const parsed = (await resp.json().catch(() => ({}))) as {
    request_id?: string;
    transcription_id?: string;
  };
  const transcriptionId = parsed.transcription_id ?? parsed.request_id ?? null;

  await supabase
    .from('transcript_jobs')
    .update({
      status: 'transcribing',
      provider_request_id: transcriptionId,
    })
    .eq('id', jobId);

  return NextResponse.json({
    job_id: jobId,
    provider: 'elevenlabs',
    request_id: transcriptionId,
  });
}

export async function dispatchTextExtraction(args: {
  supabase: SupabaseServer;
  jobId: string;
  orgId: string;
  userId: string;
  storageKey: string;
  filename: string;
}) {
  const { supabase, jobId, orgId, userId, storageKey, filename } = args;
  const admin = createAdminClient();

  const { data: blob, error: dlErr } = await admin.storage
    .from('audio-uploads')
    .download(storageKey);
  if (dlErr || !blob) {
    const msg = dlErr?.message ?? 'storage_download_failed';
    await supabase
      .from('transcript_jobs')
      .update({ status: 'error', error_message: msg })
      .eq('id', jobId);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  let markdown: string;
  try {
    const buffer = Buffer.from(await blob.arrayBuffer());
    const raw = await extractTextFromBuffer(filename, buffer);
    markdown = formatAsMarkdown(filename, raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'text_extract_failed';
    await supabase
      .from('transcript_jobs')
      .update({ status: 'error', error_message: msg })
      .eq('id', jobId);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Skip updating provider/model — the `provider` column has a check
  // constraint that only allows 'deepgram'/'elevenlabs'. The initial insert
  // already set those from the user's selection; for text files they're
  // meaningless metadata, but flipping them would violate the constraint.
  await supabase
    .from('transcript_jobs')
    .update({
      status: 'done',
      markdown,
    })
    .eq('id', jobId);

  // Match the audio-transcription path: webhook charges credits on completion,
  // so we charge here too. spendCreditsAdmin is no-op for is_unlimited orgs.
  await spendCreditsAdmin(orgId, userId, 'transcripts', jobId);

  return NextResponse.json({
    job_id: jobId,
    provider: 'text',
    request_id: null,
  });
}

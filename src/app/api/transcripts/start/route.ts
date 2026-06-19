import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { getLanguage } from '@/lib/transcripts/languages';
import { ELEVENLABS_API_MODEL } from '@/lib/transcripts/models';
import {
  classifyTextFile,
  extractTextFromBuffer,
  formatAsMarkdown,
} from '@/lib/transcripts/text-extract';
import { spendCreditsAdmin } from '@/lib/credits';

export const maxDuration = 60;

const Body = z.object({
  storage_key: z.string().min(1),
  filename: z.string().min(1),
  mime_type: z.string().optional(),
  size_bytes: z.number().int().nonnegative().optional(),
  language: z.string().optional(),
  project_id: z.string().uuid().nullable().optional(),
});

function getDeploymentBaseUrl(): string {
  // Prefer the deployment-specific URL so previews route to themselves.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  return 'http://localhost:3000';
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { storage_key, filename, mime_type, size_bytes, language, project_id } =
    parsed.data;
  const langEntry = getLanguage(language);
  // Provider is now derived from language (see languages.ts): English →
  // Deepgram nova-3, everything else → ElevenLabs Scribe v2. The user-facing
  // model selector was retired.
  const provider = langEntry.provider;
  const apiModel = provider === 'deepgram' ? langEntry.dgModel : ELEVENLABS_API_MODEL;

  // Insert the job row first so the webhook has somewhere to land.
  const { data: job, error: insertErr } = await supabase
    .from('transcript_jobs')
    .insert({
      org_id: org.org_id,
      project_id: project_id ?? null,
      user_id: user.id,
      storage_key,
      filename,
      mime_type: mime_type ?? null,
      size_bytes: size_bytes ?? null,
      provider,
      model: apiModel,
      status: 'submitting',
    })
    .select('id')
    .single();
  if (insertErr || !job) {
    return NextResponse.json(
      { error: insertErr?.message ?? 'db_error' },
      { status: 500 },
    );
  }

  // 6h signed download URL — the provider fetches the audio from there.
  const { data: signed, error: signedErr } = await supabase.storage
    .from('audio-uploads')
    .createSignedUrl(storage_key, 60 * 60 * 6);
  if (signedErr || !signed?.signedUrl) {
    await supabase
      .from('transcript_jobs')
      .update({ status: 'error', error_message: signedErr?.message ?? 'sign_failed' })
      .eq('id', job.id);
    return NextResponse.json(
      { error: signedErr?.message ?? 'sign_failed' },
      { status: 500 },
    );
  }

  // Text files (.txt/.md/.docx) skip transcription entirely — extract directly
  // and mark done. The dropzone advertises these formats but Deepgram would
  // reject them with a 415 "Unsupported Media Type".
  const textKind = classifyTextFile(filename);
  if (textKind) {
    return await dispatchTextExtraction({
      supabase,
      jobId: job.id,
      orgId: org.org_id,
      userId: user.id,
      storageKey: storage_key,
      filename,
    });
  }

  if (provider === 'deepgram') {
    return await dispatchDeepgram({
      supabase,
      jobId: job.id,
      signedUrl: signed.signedUrl,
      langEntry,
    });
  }

  return await dispatchElevenLabs({
    supabase,
    jobId: job.id,
    signedUrl: signed.signedUrl,
    apiModel,
    languageCode: langEntry.dgLanguage,
  });
}

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

async function dispatchDeepgram(args: {
  supabase: SupabaseServer;
  jobId: string;
  signedUrl: string;
  langEntry: ReturnType<typeof getLanguage>;
}) {
  const { supabase, jobId, signedUrl, langEntry } = args;

  const dgKey = process.env.DEEPGRAM_API_KEY;
  const webhookSecret = process.env.DEEPGRAM_WEBHOOK_SECRET;
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

async function dispatchElevenLabs(args: {
  supabase: SupabaseServer;
  jobId: string;
  signedUrl: string;
  apiModel: string;
  languageCode: string | null;
}) {
  const { supabase, jobId, signedUrl, apiModel, languageCode } = args;

  const apiKey = process.env.ELEVENLABS_API_KEY;
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

async function dispatchTextExtraction(args: {
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

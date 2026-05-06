import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { getLanguage } from '@/lib/transcripts/languages';
import { getModel } from '@/lib/transcripts/models';

export const maxDuration = 60;

const Body = z.object({
  storage_key: z.string().min(1),
  filename: z.string().min(1),
  mime_type: z.string().optional(),
  size_bytes: z.number().int().nonnegative().optional(),
  language: z.string().optional(),
  model: z.string().optional(),
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
  const { storage_key, filename, mime_type, size_bytes, language, model } =
    parsed.data;
  const langEntry = getLanguage(language);
  const modelEntry = getModel(model);

  // Insert the job row first so the webhook has somewhere to land.
  const { data: job, error: insertErr } = await supabase
    .from('transcript_jobs')
    .insert({
      org_id: org.org_id,
      user_id: user.id,
      storage_key,
      filename,
      mime_type: mime_type ?? null,
      size_bytes: size_bytes ?? null,
      provider: modelEntry.provider,
      model: modelEntry.apiModel,
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

  if (modelEntry.provider === 'deepgram') {
    return await dispatchDeepgram({
      supabase,
      jobId: job.id,
      signedUrl: signed.signedUrl,
      langEntry,
    });
  }

  if (modelEntry.provider === 'elevenlabs') {
    return await dispatchElevenLabs({
      supabase,
      jobId: job.id,
      signedUrl: signed.signedUrl,
      apiModel: modelEntry.apiModel,
      languageCode: langEntry.code === 'multi' ? null : langEntry.dgLanguage,
    });
  }

  await supabase
    .from('transcript_jobs')
    .update({ status: 'error', error_message: 'unknown_provider' })
    .eq('id', job.id);
  return NextResponse.json({ error: 'unknown_provider' }, { status: 400 });
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
  const webhookSecret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!apiKey) {
    await supabase
      .from('transcript_jobs')
      .update({ status: 'error', error_message: 'missing_elevenlabs_key' })
      .eq('id', jobId);
    return NextResponse.json({ error: 'missing_elevenlabs_key' }, { status: 500 });
  }
  if (!webhookSecret) {
    await supabase
      .from('transcript_jobs')
      .update({ status: 'error', error_message: 'missing_elevenlabs_webhook_secret' })
      .eq('id', jobId);
    return NextResponse.json(
      { error: 'missing_elevenlabs_webhook_secret' },
      { status: 500 },
    );
  }

  // ElevenLabs Speech-to-Text: multipart/form-data with `cloud_storage_url`
  // (the API fetches it itself — no re-upload). `webhook=true` switches to
  // async delivery: result is POSTed to the webhook URL configured in the
  // ElevenLabs dashboard. The dashboard webhook should target
  // `${base}/api/transcripts/webhook/elevenlabs`. We attach `webhook_metadata`
  // so the callback can identify our job row without trusting query params.
  const form = new FormData();
  form.append('model_id', apiModel);
  form.append('cloud_storage_url', signedUrl);
  form.append('diarize', 'true');
  form.append('timestamps_granularity', 'word');
  form.append('tag_audio_events', 'true');
  form.append('webhook', 'true');
  form.append('webhook_metadata', JSON.stringify({ job_id: jobId }));
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

  const json = (await resp.json().catch(() => ({}))) as {
    request_id?: string;
    task_id?: string;
  };
  const requestId = json.request_id ?? json.task_id ?? null;

  await supabase
    .from('transcript_jobs')
    .update({
      status: 'transcribing',
      provider_request_id: requestId,
    })
    .eq('id', jobId);

  return NextResponse.json({
    job_id: jobId,
    provider: 'elevenlabs',
    request_id: requestId,
  });
}

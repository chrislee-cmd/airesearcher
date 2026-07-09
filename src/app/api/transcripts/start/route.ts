import { NextResponse } from 'next/server';
import { z } from 'zod';
import { env } from '@/env';
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
import { checkLlmRateLimit } from '@/lib/rate-limit';

const Body = z.object({
  storage_key: z.string().min(1),
  filename: z.string().min(1),
  mime_type: z.string().optional(),
  size_bytes: z.number().int().nonnegative().optional(),
  language: z.string().optional(),
  project_id: z.string().uuid().nullable().optional(),
  // 전사 모드 (card #484) — 'research'(현행) | 'meeting'(회의록 요약+Todo #485
  // 가 소비). 이 라우트는 값 저장만, 전사 자체는 두 모드 동일.
  mode: z.enum(['research', 'meeting']).optional(),
  // 발화자 수 hint — 1 / 2 / 3(="3명 이상"). ElevenLabs num_speakers 로 매핑
  // (1·2 만 실어 보냄; 3/미지정 = auto diarize = 현행). null = 미지정.
  speaker_count: z.number().int().min(1).max(3).nullable().optional(),
});

function getDeploymentBaseUrl(): string {
  // Prefer the deployment-specific URL so previews route to themselves.
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  if (env.NEXT_PUBLIC_SITE_URL) return env.NEXT_PUBLIC_SITE_URL;
  return 'http://localhost:3000';
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const limited = await checkLlmRateLimit(user.id, org.org_id);
  if (limited) return limited;

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const {
    storage_key,
    filename,
    mime_type,
    size_bytes,
    language,
    project_id,
    mode,
    speaker_count,
  } = parsed.data;
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
      mode: mode ?? 'research',
      speaker_count: speaker_count ?? null,
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
    languageCode: langEntry.code === 'multi' ? null : langEntry.dgLanguage,
    // 발화자 수 hint → ElevenLabs num_speakers. 1·2 만 고정 hint 로 실어
    // 정확도를 높이고, 3("3명 이상")/미지정은 실어 보내지 않아 auto diarize
    // (현행 동작) 를 그대로 유지한다. Deepgram(영어)은 고정 화자 수 파라미터가
    // 없어 hint 미적용 — 항상 auto diarize.
    numSpeakers: speaker_count === 1 || speaker_count === 2 ? speaker_count : null,
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

async function dispatchElevenLabs(args: {
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

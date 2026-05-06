import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { spendCreditsAdmin } from '@/lib/credits';
import {
  elevenlabsToMarkdown,
  type ElevenLabsScribeResult,
} from '@/lib/transcripts/elevenlabs';

export const maxDuration = 60;

// ElevenLabs webhooks sign each delivery. The header carries a timestamp and
// one or more v0 signatures separated by commas, e.g.
//   ElevenLabs-Signature: t=1700000000,v0=abc123
// The signature is HMAC-SHA256 of `${timestamp}.${rawBody}` using the webhook
// secret from the dashboard.
function verifySignature(
  rawBody: string,
  header: string | null,
  secret: string,
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const [k, ...rest] = p.trim().split('=');
      return [k, rest.join('=')];
    }),
  );
  const ts = parts.t;
  const sig = parts.v0;
  if (!ts || !sig) return false;
  // Reject deliveries older than 30 minutes to limit replay surface.
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 1800) {
    return false;
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${ts}.${rawBody}`)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(sig, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    return false;
  }
}

type WebhookEnvelope = {
  type?: string;
  event_timestamp?: number;
  data?: ElevenLabsScribeResult & {
    webhook_metadata?: string | { job_id?: string };
  };
};

export async function POST(request: Request) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'missing_secret' }, { status: 500 });
  }

  const raw = await request.text();
  const sigHeader =
    request.headers.get('elevenlabs-signature') ??
    request.headers.get('ElevenLabs-Signature');

  if (!verifySignature(raw, sigHeader, secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: WebhookEnvelope;
  try {
    body = JSON.parse(raw) as WebhookEnvelope;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  // We send `webhook_metadata: JSON.stringify({ job_id })` from the start
  // route. ElevenLabs returns it back either as a string or already parsed.
  const meta = body.data?.webhook_metadata;
  let jobId: string | null = null;
  if (typeof meta === 'string') {
    try {
      jobId = (JSON.parse(meta) as { job_id?: string }).job_id ?? null;
    } catch {
      jobId = null;
    }
  } else if (meta && typeof meta === 'object') {
    jobId = meta.job_id ?? null;
  }
  if (!jobId) {
    return NextResponse.json({ error: 'missing_job' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: job, error: fetchErr } = await admin
    .from('transcript_jobs')
    .select('id, org_id, user_id, filename, status')
    .eq('id', jobId)
    .single();
  if (fetchErr || !job) {
    console.error('[transcripts/webhook/elevenlabs] job not found', jobId, fetchErr);
    return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  }
  if (job.status === 'done') {
    return NextResponse.json({ ok: true, already: true });
  }

  const result = body.data;
  if (!result || (!result.words?.length && !result.text)) {
    await admin
      .from('transcript_jobs')
      .update({
        status: 'error',
        error_message: 'no_transcript_in_payload',
        raw_result: body as unknown as object,
      })
      .eq('id', job.id);
    return NextResponse.json({ ok: false, error: 'no_transcript' }, { status: 200 });
  }

  let formatted: { markdown: string; duration: number; speakers: number };
  try {
    formatted = elevenlabsToMarkdown(result, job.filename);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'format_failed';
    await admin
      .from('transcript_jobs')
      .update({ status: 'error', error_message: msg })
      .eq('id', job.id);
    return NextResponse.json({ ok: false, error: msg }, { status: 200 });
  }

  await admin
    .from('transcript_jobs')
    .update({
      status: 'done',
      markdown: formatted.markdown,
      duration_seconds: formatted.duration,
      speakers_count: formatted.speakers,
      raw_result: body as unknown as object,
      credits_spent: 1,
    })
    .eq('id', job.id);

  try {
    await spendCreditsAdmin(job.org_id, job.user_id, 'transcripts', job.id);
  } catch (e) {
    console.warn('[transcripts/webhook/elevenlabs] credit deduction failed', e);
  }

  return NextResponse.json({ ok: true });
}

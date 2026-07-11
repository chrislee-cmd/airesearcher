// Transcript reconcile cron — background safety-net for stuck jobs.
//
// #549 (row-first handoff, merged 2d93b5f) fixed the root cause: a job row is
// now inserted at UPLOAD START (status 'uploading') and transitioned
// 'uploading' → 'submitting' → 'transcribing' → 'done'/'error'. That removes
// the orphan-file class of bugs. But a row can still get *stranded* mid-flight
// if the process that owns the transition dies between states:
//   - 'submitting'   — /start began the handoff but the provider dispatch never
//                      completed (function timeout / crash after the row flip).
//   - 'transcribing' — the provider accepted the job but the webhook/poll that
//                      moves it to 'done' never landed (ElevenLabs webhooks are
//                      unreliable in practice — see dispatch.ts).
//   - 'uploading'    — the browser TUS upload finished but the /start handoff
//                      was lost, OR the upload was abandoned and no audio exists.
//
// This cron sweeps those stranded rows and either idempotently re-dispatches
// them (same paid path as /api/transcripts/jobs/[id]/retry, no re-upload, no
// double credit — credits are charged only on completion) or, if they are past
// a hard age ceiling / have no recoverable audio, marks them
// status='error' + error_message='reconcile_timeout' so the UI leaves the
// stuck bucket. Every action is reported to Sentry so operations sees the
// otherwise-silent loss.
//
// Auth: standard Vercel cron pattern — Authorization: Bearer <CRON_SECRET>.
// Vercel cron issues GET, so GET handler (same convention as retention/sweep).
// Runs service_role (createAdminClient) — no user session, must bypass RLS.

import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { env } from '@/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { getLanguage } from '@/lib/transcripts/languages';
import { ELEVENLABS_API_MODEL } from '@/lib/transcripts/models';
import { classifyTextFile } from '@/lib/transcripts/text-extract';
import {
  dispatchDeepgram,
  dispatchElevenLabs,
  dispatchTextExtraction,
  type SupabaseServer,
} from '@/lib/transcripts/dispatch';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Staleness threshold for the mid-flight states. A job that has not been
// touched (updated_at, bumped by the touch trigger on every UPDATE) in this
// long is stranded — no healthy path leaves 'submitting'/'transcribing'
// untouched for 30 minutes.
const STALE_MINUTES = 30;
// 'uploading' gets a longer grace window. During a browser TUS upload the DB
// row is NOT updated (bytes stream to storage, not Postgres), so updated_at
// sits at creation time even while a large file is legitimately still
// uploading. A longer threshold avoids yanking a genuinely-in-progress upload.
const UPLOADING_STALE_MINUTES = 60;
// Hard age ceiling (from created_at). Past this we stop re-dispatching and
// mark the job errored — the retry cap / backoff bound. Combined with the
// 10-min cron cadence + touch-trigger bumping updated_at on each re-dispatch,
// a job is re-tried at most ~once per STALE_MINUTES window until it either
// completes or ages out here.
const HARD_CEILING_HOURS = 6;
// Cap rows processed per run so a backlog can't blow the function timeout.
// Oldest-first, so the next run picks up whatever this one didn't reach.
const BATCH_LIMIT = 20;

const RECONCILE_TIMEOUT = 'reconcile_timeout';

function authorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? '';
  return header === `Bearer ${env.CRON_SECRET}`;
}

type StuckJob = {
  id: string;
  org_id: string;
  user_id: string;
  storage_key: string | null;
  filename: string;
  provider: string | null;
  model: string | null;
  speaker_count: number | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  // dispatch* helpers are typed for the SSR server client but only touch
  // `.from('transcript_jobs')`; the admin (service_role) client is
  // structurally identical for those calls. Cast once here.
  const dispatchClient = admin as unknown as SupabaseServer;

  const now = Date.now();
  const staleCutoff = new Date(now - STALE_MINUTES * 60_000).toISOString();
  const uploadingCutoff = new Date(
    now - UPLOADING_STALE_MINUTES * 60_000,
  ).toISOString();
  const ceilingCutoff = new Date(
    now - HARD_CEILING_HOURS * 3_600_000,
  ).toISOString();

  const { data: jobs, error: queryErr } = await admin
    .from('transcript_jobs')
    .select(
      'id, org_id, user_id, storage_key, filename, provider, model, speaker_count, status, created_at, updated_at',
    )
    .in('status', ['uploading', 'submitting', 'transcribing'])
    .lt('updated_at', staleCutoff)
    .order('updated_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (queryErr) {
    Sentry.captureException(new Error(`reconcile_query_failed: ${queryErr.message}`), {
      tags: { area: 'transcript-reconcile' },
    });
    return NextResponse.json({ error: queryErr.message }, { status: 500 });
  }

  const result = { scanned: 0, redispatched: 0, expired: 0, failed: 0, skipped: 0 };

  for (const job of (jobs ?? []) as StuckJob[]) {
    result.scanned += 1;

    // 'uploading' rows between STALE_MINUTES and UPLOADING_STALE_MINUTES old
    // may still be a legitimately-slow upload in flight — leave them.
    if (job.status === 'uploading' && job.updated_at >= uploadingCutoff) {
      result.skipped += 1;
      continue;
    }

    // Past the hard age ceiling — give up and error out (retry cap).
    if (job.created_at < ceilingCutoff) {
      await markError(admin, job, RECONCILE_TIMEOUT);
      Sentry.captureMessage(
        `transcript reconcile: job aged out after ${HARD_CEILING_HOURS}h`,
        {
          level: 'warning',
          tags: { area: 'transcript-reconcile', job_id: job.id, prior_status: job.status },
        },
      );
      result.expired += 1;
      continue;
    }

    try {
      const outcome = await redispatch(admin, dispatchClient, job);
      if (outcome === 'redispatched') {
        result.redispatched += 1;
        Sentry.captureMessage('transcript reconcile: re-dispatched stuck job', {
          level: 'info',
          tags: { area: 'transcript-reconcile', job_id: job.id, prior_status: job.status },
        });
      } else {
        // No recoverable audio → errored out.
        result.expired += 1;
        Sentry.captureMessage('transcript reconcile: no recoverable audio, errored', {
          level: 'warning',
          tags: { area: 'transcript-reconcile', job_id: job.id, prior_status: job.status },
        });
      }
    } catch (e) {
      result.failed += 1;
      await markError(admin, job, RECONCILE_TIMEOUT);
      Sentry.captureException(e instanceof Error ? e : new Error(String(e)), {
        tags: { area: 'transcript-reconcile', job_id: job.id, prior_status: job.status },
      });
    }
  }

  return NextResponse.json({ ok: true, result });
}

type Admin = ReturnType<typeof createAdminClient>;

async function markError(admin: Admin, job: StuckJob, message: string): Promise<void> {
  await admin
    .from('transcript_jobs')
    .update({ status: 'error', error_message: message })
    .eq('id', job.id)
    .neq('status', 'done');
}

// Re-run the exact same dispatch path as the manual retry route against the
// existing row. Returns 'redispatched' when a provider/text dispatch was fired,
// or 'errored' when there was no recoverable audio (row already marked error).
async function redispatch(
  admin: Admin,
  dispatchClient: SupabaseServer,
  job: StuckJob,
): Promise<'redispatched' | 'errored'> {
  if (!job.storage_key) {
    await markError(admin, job, RECONCILE_TIMEOUT);
    return 'errored';
  }

  // Reset to 'submitting' and clear any stale provider ids so a half-dispatched
  // attempt's id isn't polled against the new run (mirrors the retry route).
  await admin
    .from('transcript_jobs')
    .update({
      status: 'submitting',
      error_message: null,
      provider_request_id: null,
      deepgram_request_id: null,
    })
    .eq('id', job.id)
    .neq('status', 'done');

  // Text files (.txt/.md/.docx) never hit a provider — re-extract directly.
  if (classifyTextFile(job.filename)) {
    await dispatchTextExtraction({
      supabase: dispatchClient,
      jobId: job.id,
      orgId: job.org_id,
      userId: job.user_id,
      storageKey: job.storage_key,
      filename: job.filename,
    });
    return 'redispatched';
  }

  // Fresh 6h signed URL. Also serves as the existence probe: if the object is
  // gone (abandoned 'uploading' upload that never completed), createSignedUrl
  // errors and we error the row out instead of re-dispatching into a 404.
  const { data: signed, error: signedErr } = await admin.storage
    .from('audio-uploads')
    .createSignedUrl(job.storage_key, 60 * 60 * 6);
  if (signedErr || !signed?.signedUrl) {
    await markError(admin, job, RECONCILE_TIMEOUT);
    return 'errored';
  }

  if (job.provider === 'deepgram') {
    // Deepgram is English-only here; 'en' reconstructs the nova-3 entry (same
    // reasoning as the retry route — original language code isn't persisted).
    await dispatchDeepgram({
      supabase: dispatchClient,
      jobId: job.id,
      signedUrl: signed.signedUrl,
      langEntry: getLanguage('en'),
    });
    return 'redispatched';
  }

  // ElevenLabs (everything non-English incl. auto-detect). Auto-detect on
  // re-dispatch (language_code isn't persisted); speaker_count IS stored so the
  // 1·2 diarization hint is preserved.
  await dispatchElevenLabs({
    supabase: dispatchClient,
    jobId: job.id,
    signedUrl: signed.signedUrl,
    apiModel: job.model ?? ELEVENLABS_API_MODEL,
    languageCode: null,
    numSpeakers:
      job.speaker_count === 1 || job.speaker_count === 2 ? job.speaker_count : null,
  });
  return 'redispatched';
}

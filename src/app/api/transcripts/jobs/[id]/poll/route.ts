import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { spendCreditsAdmin } from '@/lib/credits';
import {
  elevenlabsToMarkdown,
  type ElevenLabsScribeResult,
} from '@/lib/transcripts/elevenlabs';

export const maxDuration = 30;

// Poll endpoint for ElevenLabs jobs. Replaces webhook delivery, which proved
// unreliable in this workspace (no delivery attempts ever recorded). The
// client (transcript-studio) calls this every few seconds while a job is
// `transcribing`. On completion we convert the response to markdown, mark
// the job done, and spend credits — same end state as the webhook path.

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Read with the user's RLS — they must own/share the job.
  const { data: job, error: fetchErr } = await supabase
    .from('transcript_jobs')
    .select(
      'id, org_id, user_id, filename, status, provider, provider_request_id',
    )
    .eq('id', id)
    .single();
  if (fetchErr || !job) {
    return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  }
  if (job.provider !== 'elevenlabs') {
    return NextResponse.json({ error: 'wrong_provider' }, { status: 400 });
  }
  if (job.status === 'done' || job.status === 'error') {
    return NextResponse.json({ status: job.status });
  }
  if (!job.provider_request_id) {
    return NextResponse.json({ status: job.status });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'missing_elevenlabs_key' }, { status: 500 });
  }

  // ElevenLabs polling. The 401-vs-404 split observed in earlier ad-hoc
  // testing suggested two candidate paths might exist; we try both so the
  // exact route name change in the SDK doesn't break us silently.
  const candidates = [
    `https://api.elevenlabs.io/v1/speech-to-text/transcripts/${job.provider_request_id}`,
    `https://api.elevenlabs.io/v1/speech-to-text/${job.provider_request_id}`,
  ];

  let resp: Response | null = null;
  let lastBody = '';
  for (const url of candidates) {
    const r = await fetch(url, {
      headers: { 'xi-api-key': apiKey },
    }).catch(() => null);
    if (!r) continue;
    if (r.status === 404) {
      lastBody = await r.text().catch(() => '');
      continue; // try next URL shape
    }
    resp = r;
    break;
  }

  if (!resp) {
    return NextResponse.json(
      { error: 'elevenlabs_not_found', detail: lastBody.slice(0, 200) },
      { status: 502 },
    );
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    // Don't mark errored on transient 5xx — let the next poll retry.
    if (resp.status >= 500) {
      return NextResponse.json(
        { status: job.status, transient: true, code: resp.status },
        { status: 200 },
      );
    }
    const admin = createAdminClient();
    await admin
      .from('transcript_jobs')
      .update({
        status: 'error',
        error_message: `elevenlabs_${resp.status}: ${txt.slice(0, 200)}`,
      })
      .eq('id', job.id);
    return NextResponse.json({ status: 'error' });
  }

  const body = (await resp.json().catch(() => ({}))) as ElevenLabsScribeResult & {
    status?: string;
  };

  // ElevenLabs status semantics:
  //   - "completed" / "succeeded" / "done" → result is in body
  //   - "processing" / "queued" / "in_progress" → still working
  //   - "failed" / "error" → terminal failure
  // The exact label varies; we check by what we can see in the payload.
  const hasResult = (body.words && body.words.length > 0) || !!body.text;
  const status = (body.status ?? '').toLowerCase();
  const failed =
    status === 'failed' ||
    status === 'error' ||
    status === 'cancelled' ||
    status === 'canceled';

  if (failed) {
    const admin = createAdminClient();
    await admin
      .from('transcript_jobs')
      .update({
        status: 'error',
        error_message: `elevenlabs_${status || 'failed'}`,
        raw_result: body as unknown as object,
      })
      .eq('id', job.id);
    return NextResponse.json({ status: 'error' });
  }

  if (!hasResult) {
    // Still processing.
    return NextResponse.json({ status: 'transcribing' });
  }

  // Completed → format and persist.
  let formatted: { markdown: string; duration: number; speakers: number };
  try {
    formatted = elevenlabsToMarkdown(body, job.filename);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'format_failed';
    const admin = createAdminClient();
    await admin
      .from('transcript_jobs')
      .update({ status: 'error', error_message: msg })
      .eq('id', job.id);
    return NextResponse.json({ status: 'error' });
  }

  const admin = createAdminClient();
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
    console.warn('[transcripts/poll] credit deduction failed', e);
  }

  return NextResponse.json({ status: 'done' });
}

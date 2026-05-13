import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { spendCreditsAdmin } from '@/lib/credits';
import { deepgramToMarkdown, type DeepgramResult } from '@/lib/transcripts/format';

export const maxDuration = 60;

export async function POST(request: Request) {
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret');
  const jobId = url.searchParams.get('job');
  const expected = process.env.DEEPGRAM_WEBHOOK_SECRET;

  if (!expected || !secret || secret !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!jobId) {
    return NextResponse.json({ error: 'missing_job' }, { status: 400 });
  }

  let body: DeepgramResult;
  try {
    body = (await request.json()) as DeepgramResult;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: job, error: fetchErr } = await admin
    .from('transcript_jobs')
    .select('id, org_id, user_id, filename, status')
    .eq('id', jobId)
    .single();
  if (fetchErr || !job) {
    console.error('[transcripts/webhook] job not found', jobId, fetchErr);
    return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  }
  if (job.status === 'done') {
    return NextResponse.json({ ok: true, already: true });
  }

  // Deepgram surfaces transcription errors inside metadata or as plain HTTP
  // failures. The async webhook still posts the JSON when something goes
  // wrong; we just look for missing transcript content.
  const alt = body.results?.channels?.[0]?.alternatives?.[0];
  const utteranceCount = body.results?.utterances?.length ?? 0;
  if (!alt && utteranceCount === 0) {
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
    formatted = deepgramToMarkdown(body, job.filename);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'format_failed';
    await admin
      .from('transcript_jobs')
      .update({ status: 'error', error_message: msg })
      .eq('id', job.id);
    return NextResponse.json({ ok: false, error: msg }, { status: 200 });
  }

  // Deepgram occasionally returns a result envelope with `alternatives[0]`
  // whose `transcript` is an empty string and no utterances/paragraphs (silent
  // audio, language detection miss, undecodable m4a, etc). The earlier
  // `!alt && utteranceCount === 0` guard misses this because `alt` is truthy.
  // `speakers === 0` is a reliable proxy for "formatter emitted zero blocks",
  // so flip the job to error rather than saving a frontmatter-only markdown
  // that renders as a blank `완료` preview.
  if (formatted.speakers === 0) {
    await admin
      .from('transcript_jobs')
      .update({
        status: 'error',
        error_message: 'empty_transcript',
        duration_seconds: formatted.duration,
        raw_result: body as unknown as object,
      })
      .eq('id', job.id);
    return NextResponse.json(
      { ok: false, error: 'empty_transcript' },
      { status: 200 },
    );
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

  // Charge for the transcripts feature via the service-role RPC, which
  // handles the trial / unlimited free-pass branches uniformly with the
  // user-facing endpoints. Previously this path manually deducted 1 credit
  // under the wrong feature label ('quotes') and bypassed trial logic.
  try {
    await spendCreditsAdmin(job.org_id, job.user_id, 'transcripts', job.id);
  } catch (e) {
    console.warn('[transcripts/webhook] credit deduction failed', e);
  }

  return NextResponse.json({ ok: true });
}

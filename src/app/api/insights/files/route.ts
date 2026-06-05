import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { convertFileToMarkdown } from '@/lib/insights/convert';
import {
  insightsExtractionSchema,
  INSIGHTS_EXTRACTION_SYSTEM,
} from '@/lib/insights-schema';

// Whisper + Sonnet on a 25MB file can spike well past the default. 300s is
// the Vercel Fluid Compute ceiling (PROJECT.md uplift), matched to the
// legacy `/api/interviews/convert` route's own `maxDuration`.
export const maxDuration = 300;

const JobIdSchema = z.string().uuid();

// Per-file body shape arrives as FormData (file + jobId text field) so
// we don't need a separate JSON body schema — FormData parsing happens
// inline below.

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get('file');
  const jobIdRaw = form.get('jobId');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing_file' }, { status: 400 });
  }
  const jobIdParse = JobIdSchema.safeParse(jobIdRaw);
  if (!jobIdParse.success) {
    return NextResponse.json({ error: 'invalid_job_id' }, { status: 400 });
  }
  const jobId = jobIdParse.data;

  // RLS-scoped read confirms the caller belongs to the org that owns the
  // job. `getActiveOrg()` would only check current org; this is tighter —
  // it also catches the "stale jobId from another session" case.
  const { data: job, error: jobErr } = await supabase
    .from('insights_jobs')
    .select('id, status, org_id, user_id')
    .eq('id', jobId)
    .single();
  if (jobErr || !job) {
    return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  }
  if (job.status === 'ready' || job.status === 'failed') {
    return NextResponse.json(
      { error: 'job_terminal', status: job.status },
      { status: 409 },
    );
  }

  const admin = createAdminClient();

  // First file flips pending → converting. Idempotent: re-setting to the
  // same state is harmless; jumping back from extracting is also fine
  // because the FSM is monotonic from the dashboard's perspective.
  if (job.status === 'pending') {
    await admin
      .from('insights_jobs')
      .update({ status: 'converting', updated_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('status', 'pending');
  }

  let markdown: string;
  let formatPath: string;
  try {
    const result = await convertFileToMarkdown(file);
    markdown = result.markdown;
    formatPath = result.format_path;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'convert_failed';
    return NextResponse.json(
      {
        error: 'convert_failed',
        filename: file.name,
        stage: 'convert',
        detail: msg,
      },
      { status: 502 },
    );
  }

  // Once at least one file has reached extraction we advance the FSM —
  // the dashboard now shows "분석 중" instead of "변환 중".
  await admin
    .from('insights_jobs')
    .update({ status: 'extracting', updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .in('status', ['converting', 'pending']);

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return NextResponse.json(
      { error: 'missing_anthropic_key', filename: file.name, stage: 'extract' },
      { status: 500 },
    );
  }

  let quotes: z.infer<typeof insightsExtractionSchema>['quotes'];
  try {
    const anthropic = createAnthropic({ apiKey: anthropicKey });
    const { object } = await generateObject({
      model: anthropic('claude-sonnet-4-6'),
      schema: insightsExtractionSchema,
      system: INSIGHTS_EXTRACTION_SYSTEM,
      // 200k char cap matches the legacy extract route — within Sonnet's
      // input window and avoids paying for prompt tokens on outlier inputs.
      prompt: `파일명: ${file.name}\n\n마크다운:\n\n${markdown.slice(0, 200_000)}`,
      temperature: 0.1,
    });
    quotes = object.quotes;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'extract_failed';
    return NextResponse.json(
      {
        error: 'extract_failed',
        filename: file.name,
        stage: 'extract',
        detail: msg,
      },
      { status: 502 },
    );
  }

  if (quotes.length === 0) {
    // The extractor returned zero rows — usually means the file had no
    // identifiable respondent voice (a list of facts, a table, a slide
    // deck without quotes). We return success with count=0 so the file is
    // counted toward the threshold, but no insights_quotes rows are
    // written. /finalize aggregates these as zero-yield, not as failure.
    return NextResponse.json({
      filename: file.name,
      format_path: formatPath,
      quote_count: 0,
    });
  }

  const rows = quotes.map((q) => ({
    job_id: jobId,
    participant_name: q.participant_name,
    theme: q.theme,
    sentiment: q.sentiment,
    text: q.text,
    source_file: file.name,
    source_offset: q.source_offset,
  }));

  const { error: insertErr } = await admin.from('insights_quotes').insert(rows);
  if (insertErr) {
    return NextResponse.json(
      {
        error: 'insert_failed',
        filename: file.name,
        stage: 'persist',
        detail: insertErr.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    filename: file.name,
    format_path: formatPath,
    quote_count: rows.length,
  });
}

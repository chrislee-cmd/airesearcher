import { NextResponse } from 'next/server';
import { z } from 'zod';
import { streamObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { env } from '@/env';
import { ZERO_RETENTION } from '@/lib/llm/config';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { convertFileToMarkdown } from '@/lib/insights/convert';
import {
  insightsQuoteSchema,
  buildInsightsExtractionSystem,
  type InsightsQuote,
} from '@/lib/insights-schema';
import { checkLlmRateLimit } from '@/lib/rate-limit';
import { sanitizeUserInput } from '@/lib/llm/sanitize';
import { resolveOutputLang } from '@/lib/i18n/output-language';
import { readRequestLocale } from '@/lib/i18n/request-locale';

// Batch size for incremental INSERTs into insights_quotes while the LLM
// streams. Small enough that the client's 2s poll picks up movement, large
// enough that we don't hammer Postgres with 100 single-row inserts.
const STREAM_BATCH = 5;

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

  // /files runs Whisper + Sonnet per upload. Bucket by user.id (per-min)
  // and org from the job row (per-day) so a batch upload across files
  // counts toward both limits.
  const limited = await checkLlmRateLimit(user.id, job.org_id ?? null);
  if (limited) return limited;

  // theme 라벨 출력 언어 = 유저 로케일 > en. quote(text)는 verbatim 이라 원문 유지.
  const lang = resolveOutputLang(undefined, await readRequestLocale());

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

  const anthropicKey = env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return NextResponse.json(
      { error: 'missing_anthropic_key', filename: file.name, stage: 'extract' },
      { status: 500 },
    );
  }

  // Stream quotes element-by-element and flush in small batches so the
  // 2s poll on /insights-analyzer ticks the live counter as extraction
  // progresses, instead of jumping 0 → 50 at the very end (the symptom
  // we hit with `generateObject`: ~4 min of "0개" then everything at once).
  let inserted = 0;
  const buffer: InsightsQuote[] = [];

  const flush = async () => {
    if (buffer.length === 0) return;
    const rows = buffer.map((q) => ({
      job_id: jobId,
      participant_name: q.participant_name,
      theme: q.theme,
      sentiment: q.sentiment,
      text: q.text,
      source_file: file.name,
      source_offset: q.source_offset,
    }));
    const { error: insertErr } = await admin
      .from('insights_quotes')
      .insert(rows);
    if (insertErr) throw new Error(`insert_failed: ${insertErr.message}`);
    inserted += rows.length;
    buffer.length = 0;
  };

  try {
    const anthropic = createAnthropic({ apiKey: anthropicKey });
    const markdownSlice = markdown.slice(0, 200_000);
    const markdownSan = await sanitizeUserInput(markdownSlice, 'insights_markdown', {
      endpoint: '/api/insights/files',
      user_id: user.id,
      org_id: job.org_id ?? null,
      actor_email: user.email ?? null,
      input_length: markdownSlice.length,
      input_label: 'insights_markdown',
    });
    const { elementStream } = streamObject({
      model: anthropic('claude-sonnet-4-6'),
      output: 'array',
      schema: insightsQuoteSchema,
      system: buildInsightsExtractionSystem(lang),
      // 200k char cap matches the legacy extract route — within Sonnet's
      // input window and avoids paying for prompt tokens on outlier inputs.
      prompt: `파일명: ${file.name}\n\n마크다운:\n\n${markdownSan.wrapped}`,
      temperature: 0.1,
      providerOptions: ZERO_RETENTION,
    });

    for await (const quote of elementStream) {
      buffer.push(quote);
      if (buffer.length >= STREAM_BATCH) await flush();
    }
    await flush();
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'extract_failed';
    return NextResponse.json(
      {
        // A mid-stream insert failure surfaces here too. We do not roll back
        // the rows already persisted before the error — /finalize's
        // distinct(source_file) count still picks them up so the file
        // contributes to the success ratio. The client treats the response
        // as a per-file failure for its own counter, which is fine: the
        // user sees "completed N of expected 50" semantics in the worst case.
        error: 'extract_failed',
        filename: file.name,
        stage: 'extract',
        detail: msg,
        partial_quote_count: inserted,
      },
      { status: 502 },
    );
  }

  // Zero-yield is a successful response with quote_count: 0. /finalize
  // aggregates these as zero-yield (not failure) — see threshold logic.
  return NextResponse.json({
    filename: file.name,
    format_path: formatPath,
    quote_count: inserted,
  });
}

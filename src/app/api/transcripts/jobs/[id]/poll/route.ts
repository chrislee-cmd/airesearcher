import { NextResponse, after } from 'next/server';
import { env } from '@/env';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { spendCreditsAdmin } from '@/lib/credits';
import {
  elevenlabsToMarkdown,
  type ElevenLabsScribeResult,
} from '@/lib/transcripts/elevenlabs';
import { mergeSpeakers } from '@/lib/transcripts/speaker-merge';
import { cleanupTranscript } from '@/lib/transcripts/cleanup';
import { classifySpeakerRoles } from '@/lib/transcripts/speaker-roles';
import { normalizeTermsInTranscript } from '@/lib/transcripts/term-normalize';
import { normalizeNumbersInTranscript } from '@/lib/transcripts/number-normalize';
import { classifyQaDiarization } from '@/lib/transcripts/diarization';
import { summarizeMeeting } from '@/lib/transcripts/meeting-summary';
import { updateWithInferredFallback } from '@/lib/transcripts/jobs-select';

// Bumped from 30s to 200s because the cleanup pass scheduled via `after()`
// extends function lifetime — Vercel keeps the instance alive until after()
// callbacks resolve, capped at `maxDuration`. The initial response still
// returns in <10s; the extra budget is just for the background cleanup.
export const maxDuration = 200;

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
      'id, org_id, user_id, filename, status, provider, provider_request_id, mode',
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

  const apiKey = env.ELEVENLABS_API_KEY;
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
  for (const url of candidates) {
    const r = await fetch(url, {
      headers: { 'xi-api-key': apiKey },
    }).catch(() => null);
    if (!r) continue;
    if (r.status === 404) {
      // Drain body to avoid keep-alive leaks.
      void r.text().catch(() => '');
      continue; // try next URL shape
    }
    resp = r;
    break;
  }

  if (!resp) {
    // Both candidate paths 404'd — in webhook=true async mode this is the
    // expected state while ElevenLabs is still processing (the transcript
    // object isn't queryable until generation finishes). Don't surface as
    // an error: the next tick will retry. Returning 200 keeps the client's
    // DevTools console clean during long jobs.
    return NextResponse.json({ status: 'transcribing', transient: true });
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

  // Completed → speaker-merge pass → format → persist.
  //
  // The merge pass runs an LLM over speaker stats + a turn sample to detect
  // over-split speakers (Scribe v2 occasionally splits one Korean interviewee
  // across multiple speaker IDs). On low-confidence / no-API-key / LLM error
  // the original words are returned unchanged — the markdown ends up identical
  // to the pre-merge build, so the failure mode is "no-op", never a regression.
  // We attach the decision under `raw_result._speaker_merge` for audit.
  const root = (body.data ?? body) as ElevenLabsScribeResult;
  const { words: mergedWords, decision: mergeDecision } = await mergeSpeakers(
    root.words ?? [],
    job.filename,
  );
  const resultForFormat: ElevenLabsScribeResult = { ...root, words: mergedWords };

  let formatted: { markdown: string; duration: number; speakers: number };
  try {
    formatted = elevenlabsToMarkdown(resultForFormat, job.filename);
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
  const rawWithMeta = { ...body, _speaker_merge: mergeDecision };
  await admin
    .from('transcript_jobs')
    .update({
      status: 'done',
      markdown: formatted.markdown,
      duration_seconds: formatted.duration,
      speakers_count: formatted.speakers,
      raw_result: rawWithMeta as unknown as object,
      credits_spent: 1,
    })
    .eq('id', job.id);

  try {
    await spendCreditsAdmin(job.org_id, job.user_id, 'transcripts', job.id);
  } catch (e) {
    console.warn('[transcripts/poll] credit deduction failed', e);
  }

  // Post-completion passes run AFTER the response goes out. We've already
  // saved un-cleaned `markdown` and marked the job done — the client unblocks
  // now. Two independent pipelines run in parallel and write together in a
  // single final UPDATE (avoids raw_result race):
  //   1. cleanup → term-normalize → number-normalize. Sequential chain —
  //      each reads the previous step's output.
  //   2. speaker-roles (질문자/응답자 classification) — independent.
  //
  // On any pass failure that column stays NULL → UI falls back to raw
  // markdown + Speaker N labels.
  const shouldDiarize = formatted.speakers === 1 && formatted.duration >= 60;
  // 회의록 모드(mode='meeting') 잡만 전체 요약 + Todo 후처리. 리서치 모드는
  // 현행 그대로(skip). 실패해도 markdown 은 이미 저장돼 전사 본문은 유지.
  const shouldSummarize = job.mode === 'meeting';
  after(async () => {
    try {
      const [textPipeline, rolesRes, diarRes, summaryRes] = await Promise.all([
        (async () => {
          const cleanup = await cleanupTranscript(
            mergedWords,
            job.filename,
            formatted.duration,
            formatted.speakers,
          ).catch((e) => {
            console.warn('[transcripts/poll] cleanup pass failed', e);
            return null;
          });
          if (!cleanup?.cleanMarkdown) {
            return { cleanup, termNormalize: null, numberNormalize: null };
          }
          const termNormalize = await normalizeTermsInTranscript(
            cleanup.cleanMarkdown,
          ).catch((e) => {
            console.warn('[transcripts/poll] term-normalize pass failed', e);
            return null;
          });
          const afterTerms = termNormalize?.normalized ?? cleanup.cleanMarkdown;
          const numberNormalize = await normalizeNumbersInTranscript(
            afterTerms,
          ).catch((e) => {
            console.warn('[transcripts/poll] number-normalize pass failed', e);
            return null;
          });
          return { cleanup, termNormalize, numberNormalize };
        })(),
        classifySpeakerRoles(mergedWords, job.filename).catch((e) => {
          console.warn('[transcripts/poll] roles pass failed', e);
          return null;
        }),
        // Q&A 문맥 diarization — single-speaker + 60s+ 만 호출.
        // 동시통역사 1인 인터뷰 시나리오 cover. monologue 면 자동 폐기.
        shouldDiarize
          ? classifyQaDiarization(mergedWords, job.filename, formatted.duration).catch(
              (e) => {
                console.warn('[transcripts/poll] diarization pass failed', e);
                return null;
              },
            )
          : Promise.resolve(null),
        shouldSummarize
          ? summarizeMeeting(formatted.markdown, job.filename).catch((e) => {
              console.warn('[transcripts/poll] meeting-summary pass failed', e);
              return null;
            })
          : Promise.resolve(null),
      ]);
      const { cleanup: cleanupRes, termNormalize: termRes, numberNormalize: numberRes } =
        textPipeline;
      const finalCleanMarkdown =
        numberRes?.normalized ??
        termRes?.normalized ??
        cleanupRes?.cleanMarkdown ??
        null;
      const patch: Record<string, unknown> = {
        raw_result: {
          ...rawWithMeta,
          ...(cleanupRes ? { _cleanup: cleanupRes.audit } : {}),
          ...(termRes ? { _term_normalize: termRes.audit } : {}),
          ...(numberRes ? { _number_normalize: numberRes.audit } : {}),
          ...(rolesRes ? { _roles: rolesRes.audit } : {}),
          ...(diarRes ? { _diarization: diarRes.audit } : {}),
          ...(summaryRes ? { _meeting_summary: summaryRes.audit } : {}),
        },
      };
      if (finalCleanMarkdown) patch.clean_markdown = finalCleanMarkdown;
      if (rolesRes?.roles) patch.speaker_roles = rolesRes.roles;
      if (diarRes?.inferred) patch.inferred_speakers = diarRes.inferred;
      if (summaryRes?.markdown) patch.meeting_summary = summaryRes.markdown;
      await updateWithInferredFallback(
        async (p) => {
          const r = await admin.from('transcript_jobs').update(p).eq('id', job.id);
          return { error: r.error as { code?: string; message?: string } | null };
        },
        patch,
      );
    } catch (e) {
      console.warn('[transcripts/poll] post-pass write failed', e);
    }
  });

  return NextResponse.json({ status: 'done' });
}

import { NextResponse, after } from 'next/server';
import { env } from '@/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { spendCreditsAdmin } from '@/lib/credits';
import { deepgramToMarkdown, type DeepgramResult } from '@/lib/transcripts/format';
import { classifySpeakerRolesEn } from '@/lib/transcripts/speaker-roles';
import { normalizeNumbersInTranscript } from '@/lib/transcripts/number-normalize';
import { classifyQaDiarizationEn } from '@/lib/transcripts/diarization';
import { updateWithInferredFallback } from '@/lib/transcripts/jobs-select';

// Bumped to 200s to match poll/route.ts — after() callbacks keep the function
// alive until they resolve, capped at maxDuration. Initial response still
// returns in <10s; the extra budget is for the English post-pass pipeline
// (speaker-roles + number-normalize) so Deepgram jobs get the same downstream
// quality treatment ElevenLabs jobs receive in poll/route.ts.
export const maxDuration = 200;

export async function POST(request: Request) {
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret');
  const jobId = url.searchParams.get('job');
  const expected = env.DEEPGRAM_WEBHOOK_SECRET;

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

  // English post-pass pipeline — mirrors the ElevenLabs/Korean pipeline in
  // poll/route.ts. We currently run only speaker-roles + number-normalize
  // for Deepgram (cleanup/term-normalize are Korean-prompted; English
  // variants land in a follow-up). On any pass failure that column stays
  // NULL → preview/download fall back to raw markdown + Speaker N labels.
  //
  // Q&A diarization (speakers_count===1 only) runs in parallel — covers the
  // 동시통역사 시나리오 where mic = 1명 but content = host/guest 교대.
  // Skips automatically on multi-speaker / monologue / low-confidence.
  const shouldDiarize = formatted.speakers === 1 && formatted.duration >= 60;
  after(async () => {
    try {
      const rawMd = formatted.markdown;
      const [rolesRes, numberRes, diarRes] = await Promise.all([
        classifySpeakerRolesEn(body, job.filename).catch((e) => {
          console.warn('[transcripts/webhook] roles pass failed', e);
          return null;
        }),
        normalizeNumbersInTranscript(rawMd, 'en').catch((e) => {
          console.warn('[transcripts/webhook] number-normalize pass failed', e);
          return null;
        }),
        shouldDiarize
          ? classifyQaDiarizationEn(body, job.filename, formatted.duration).catch((e) => {
              console.warn('[transcripts/webhook] diarization pass failed', e);
              return null;
            })
          : Promise.resolve(null),
      ]);
      const patch: Record<string, unknown> = {
        raw_result: {
          ...(body as unknown as Record<string, unknown>),
          ...(rolesRes ? { _roles: rolesRes.audit } : {}),
          ...(numberRes ? { _number_normalize: numberRes.audit } : {}),
          ...(diarRes ? { _diarization: diarRes.audit } : {}),
        },
      };
      if (numberRes?.normalized) patch.clean_markdown = numberRes.normalized;
      if (rolesRes?.roles) patch.speaker_roles = rolesRes.roles;
      if (diarRes?.inferred) patch.inferred_speakers = diarRes.inferred;
      await updateWithInferredFallback(
        async (p) => {
          const r = await admin.from('transcript_jobs').update(p).eq('id', job.id);
          return { error: r.error as { code?: string; message?: string } | null };
        },
        patch,
      );
    } catch (e) {
      console.warn('[transcripts/webhook] post-pass write failed', e);
    }
  });

  return NextResponse.json({ ok: true });
}

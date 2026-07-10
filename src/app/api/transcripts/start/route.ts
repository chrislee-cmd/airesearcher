import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { getLanguage } from '@/lib/transcripts/languages';
import { ELEVENLABS_API_MODEL } from '@/lib/transcripts/models';
import { classifyTextFile } from '@/lib/transcripts/text-extract';
import { checkLlmRateLimit } from '@/lib/rate-limit';
import {
  dispatchDeepgram,
  dispatchElevenLabs,
  dispatchTextExtraction,
} from '@/lib/transcripts/dispatch';

const Body = z.object({
  // Row-first: when the client pre-created the row at upload start (status
  // 'uploading'), it passes that row id here and we transition it to
  // 'submitting' instead of inserting a second row. Absent = legacy path
  // (insert a fresh row) so non-row-first callers keep working.
  job_id: z.string().uuid().optional(),
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
    job_id,
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

  // Row-first: the client pre-created the row at upload start (status
  // 'uploading'). Transition that same row to 'submitting' — no second row, no
  // orphan. provider/model were already set from the same language at create,
  // so we only flip status + clear any prior error. A `done` row is never
  // rewound (a stray start after completion must not clobber a result).
  // Legacy callers omit job_id → insert a fresh row as before.
  let jobId: string;
  if (job_id) {
    const { data: updated, error: updateErr } = await supabase
      .from('transcript_jobs')
      .update({ status: 'submitting', error_message: null })
      .eq('id', job_id)
      .neq('status', 'done')
      .select('id')
      .single();
    if (updateErr || !updated) {
      return NextResponse.json(
        { error: updateErr?.message ?? 'job_not_found' },
        { status: updateErr ? 500 : 404 },
      );
    }
    jobId = updated.id;
  } else {
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
    jobId = job.id;
  }

  // 6h signed download URL — the provider fetches the audio from there.
  const { data: signed, error: signedErr } = await supabase.storage
    .from('audio-uploads')
    .createSignedUrl(storage_key, 60 * 60 * 6);
  if (signedErr || !signed?.signedUrl) {
    await supabase
      .from('transcript_jobs')
      .update({ status: 'error', error_message: signedErr?.message ?? 'sign_failed' })
      .eq('id', jobId);
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
      jobId,
      orgId: org.org_id,
      userId: user.id,
      storageKey: storage_key,
      filename,
    });
  }

  if (provider === 'deepgram') {
    return await dispatchDeepgram({
      supabase,
      jobId,
      signedUrl: signed.signedUrl,
      langEntry,
    });
  }

  return await dispatchElevenLabs({
    supabase,
    jobId,
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

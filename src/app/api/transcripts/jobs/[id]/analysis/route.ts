import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  applySpeakerLabels,
  type SpeakerRolesMap,
} from '@/lib/transcripts/speaker-roles';
import {
  applyInferredSpeakerLabels,
  type InferredSpeakersPayload,
} from '@/lib/transcripts/diarization';
import {
  selectWithInferredFallback,
  updateWithInferredFallback,
} from '@/lib/transcripts/jobs-select';
import {
  analyzeTranscript,
  coerceAnalysis,
  type TranscriptAnalysis,
} from '@/lib/transcripts/analysis';

// research 모드 전사 결과의 AI 요약 + Key themes.
//   GET  — 저장된 analysis 를 돌려준다(미생성/미적용 컬럼이면 { analysis: null }).
//   POST — 전사 마크다운을 LLM 후처리해 analysis 를 생성·저장 후 돌려준다
//          (on-demand '생성' CTA). meeting_summary 와 동일한 graceful-degrade:
//          컬럼 미적용(preview) 이면 select/update 헬퍼가 그 컬럼만 빼고 살아남고,
//          LLM 실패/근거부족/키부재면 analysis 는 null 로 남아 UI 스텁 폴백.
//
// 전사 파이프/본문(markdown·clean_markdown)은 절대 건드리지 않는다 — analysis
// 컬럼만 read/write. 소유권은 RLS + 명시 user_id 확인으로 이중 게이트.

type JobRow = Record<string, unknown>;

async function loadJob(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  columns: string,
): Promise<{ data: JobRow | null; error: { code?: string; message?: string } | null }> {
  return selectWithInferredFallback<JobRow>(async (cols) => {
    const r = await supabase
      .from('transcript_jobs')
      .select(cols)
      .eq('id', id)
      .single();
    return {
      data: r.data as JobRow | null,
      error: r.error as { code?: string; message?: string } | null,
    };
  }, columns);
}

// 저장된 analysis 컬럼값 → 검증된 TranscriptAnalysis. 컬럼 미적용(select 가
// analysis 를 못 실음)이면 undefined → null.
function readStoredAnalysis(job: JobRow): TranscriptAnalysis | null {
  if (!('analysis' in job)) return null;
  return coerceAnalysis(job.analysis);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: job, error } = await loadJob(supabase, id, 'user_id, status');
  if (error || !job) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (job.user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return NextResponse.json({ analysis: readStoredAnalysis(job) });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // 전사 본문 + 라벨링에 필요한 컬럼 전부 (turns 라우트 select 미러).
  const baseColumns =
    'filename, markdown, clean_markdown, speaker_roles, provider, status, user_id';
  const { data: job, error } = await loadJob(supabase, id, baseColumns);
  if (error || !job) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (job.user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // 이미 생성돼 있으면 재생성 없이 반환(멱등 — 중복 클릭/비용 방지).
  const existing = readStoredAnalysis(job);
  if (existing) {
    return NextResponse.json({ analysis: existing });
  }

  const status = job.status as string | null;
  if (status !== 'done' || !job.markdown) {
    return NextResponse.json({ error: 'not_ready' }, { status: 409 });
  }

  // turns 라우트와 동일한 라벨링 파이프 — clean_markdown 우선, 화자 라벨 적용.
  const sourceMarkdown =
    (job.clean_markdown as string | null) ?? (job.markdown as string);
  const speakerRoles = (job.speaker_roles as SpeakerRolesMap | null) ?? null;
  const inferredSpeakers =
    (job.inferred_speakers as InferredSpeakersPayload | null) ?? null;
  const labelLang = job.provider === 'deepgram' ? 'en' : 'ko';
  const labeledMarkdown = inferredSpeakers
    ? applyInferredSpeakerLabels(sourceMarkdown, inferredSpeakers, labelLang)
    : applySpeakerLabels(sourceMarkdown, speakerRoles, labelLang);

  const { analysis } = await analyzeTranscript(
    labeledMarkdown,
    (job.filename as string | null) ?? 'transcript',
  );

  // 실패/근거부족/키부재 — analysis 는 null. 컬럼 안 건드리고 스텁 상태 유지.
  if (!analysis) {
    return NextResponse.json({ analysis: null });
  }

  // 저장(analysis 컬럼만). 컬럼 미적용(preview) 이면 update 헬퍼가 그 키를 빼고
  // no-op 로 성공 처리 → 생성 결과는 이번 응답으로만 표시되고 DB 저장은 마이그
  // 적용 후부터. (전사 본문 무영향.)
  const { error: updateError } = await updateWithInferredFallback(
    async (patch) => {
      const r = await supabase
        .from('transcript_jobs')
        .update(patch)
        .eq('id', id)
        .eq('user_id', user.id);
      return { error: r.error as { code?: string; message?: string } | null };
    },
    { analysis },
  );
  if (updateError) {
    // 저장 실패(비-컬럼 에러)여도 생성 결과는 이번 응답으로 돌려준다(무해).
    console.warn('[transcripts/analysis] store failed', updateError);
  }

  return NextResponse.json({ analysis });
}

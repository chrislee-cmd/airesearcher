import { NextResponse } from 'next/server';
import mammoth from 'mammoth';
import { createClient } from '@/lib/supabase/server';
import { markdownToDocx } from '@/lib/transcripts/docx';
import {
  applySpeakerLabels,
  type SpeakerRolesMap,
} from '@/lib/transcripts/speaker-roles';
import {
  applyInferredSpeakerLabels,
  type InferredSpeakersPayload,
} from '@/lib/transcripts/diarization';
import { selectWithInferredFallback } from '@/lib/transcripts/jobs-select';

// Same identifier-blob heuristics as the download route, so the preview header
// matches the eventual download filename instead of leaking the raw UUID.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_BLOB_RE = /^[0-9a-f]{24,}$/i;
const RANDOM_BLOB_RE = /^[A-Za-z0-9_-]{20,}$/;
function looksAnonymous(base: string): boolean {
  const trimmed = base.trim();
  if (!trimmed) return true;
  if (UUID_RE.test(trimmed)) return true;
  if (HEX_BLOB_RE.test(trimmed)) return true;
  if (RANDOM_BLOB_RE.test(trimmed) && !/[aeiouAEIOU][a-zA-Z]{2,}/.test(trimmed)) {
    return true;
  }
  return false;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  // `source=raw` forces the original Scribe output; default ('clean' or any
  // other value) keeps the existing "cleaned-preferred" behaviour. The toggle
  // UI in transcript-studio passes the explicit value when the user flips.
  const source = url.searchParams.get('source') === 'raw' ? 'raw' : 'clean';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // inferred_speakers 컬럼은 마이그 (#505) prod 적용 전엔 없어서 select 자체가
  // 깨짐. selectWithInferredFallback 가 try-then-fallback 으로 graceful degrade.
  const baseColumns =
    'filename, markdown, clean_markdown, speaker_roles, raw_result, status, user_id, created_at, provider';
  const { data: job, error } = await selectWithInferredFallback<Record<string, unknown>>(
    async (cols) => {
      const r = await supabase
        .from('transcript_jobs')
        .select(cols)
        .eq('id', id)
        .single();
      return {
        data: r.data as Record<string, unknown> | null,
        error: r.error as { code?: string; message?: string } | null,
      };
    },
    baseColumns,
  );
  if (error || !job) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const status = job.status as string | null;
  if (status !== 'done' || !job.markdown) {
    return NextResponse.json({ error: 'not_ready' }, { status: 409 });
  }
  // source=raw → original markdown. source=clean (default) → cleaned if it
  // landed, otherwise fall back to original. Short / low-confidence /
  // English-Deepgram jobs legitimately leave clean_markdown NULL.
  const sourceMarkdown =
    source === 'raw'
      ? (job.markdown as string)
      : ((job.clean_markdown as string | null) ?? (job.markdown as string));
  const hasCleanVersion = !!job.clean_markdown;
  const cleanupAudit =
    (job.raw_result as { _cleanup?: unknown } | null)?._cleanup ?? null;
  const speakerRoles = (job.speaker_roles as SpeakerRolesMap | null) ?? null;
  const inferredSpeakers =
    (job.inferred_speakers as InferredSpeakersPayload | null) ?? null;
  const rolesAudit =
    (job.raw_result as { _roles?: unknown } | null)?._roles ?? null;
  const diarizationAudit =
    (job.raw_result as { _diarization?: unknown } | null)?._diarization ?? null;

  const rawBase = ((job.filename as string | null) ?? '')
    .replace(/\.[^./]+$/, '')
    .trim();
  let base: string;
  if (rawBase && !looksAnonymous(rawBase)) {
    base = rawBase;
  } else {
    const { count } = await supabase
      .from('transcript_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', job.user_id as string)
      .eq('status', 'done')
      .lte('created_at', job.created_at as string);
    const n = Math.max(1, count ?? 1);
    base = `Interview Transcript #${n}`;
  }

  // Substitute "Speaker N:" with role labels — 질문자/응답자 for Korean
  // (ElevenLabs) jobs, Interviewer/Interviewee for English (Deepgram) jobs.
  // Done at render-time so the persisted markdown stays in the canonical
  // Speaker N format — keeps re-classification cheap if we ever rerun the
  // LLM pass.
  //
  // inferred_speakers (Q&A 문맥 diarization, speakers_count=1 잡) 가 있으면
  // turn 별 host/guest 가 더 구체적이라 우선 적용. 그 외 잡은 speaker_roles
  // (음향 화자별 분류) fallback.
  const labelLang = job.provider === 'deepgram' ? 'en' : 'ko';
  const labeledMarkdown = inferredSpeakers
    ? applyInferredSpeakerLabels(sourceMarkdown, inferredSpeakers, labelLang)
    : applySpeakerLabels(sourceMarkdown, speakerRoles, labelLang);
  const displayMarkdown = labeledMarkdown.replace(
    /^(file:\s*).*$/m,
    `$1${base}`,
  );

  // Pipeline: markdown → docx (same generator used for download) → HTML.
  // This guarantees the in-page preview shows the user the same content layout
  // the docx file will render, without shipping the raw docx to the browser.
  const buf = await markdownToDocx(displayMarkdown);
  const { value: html } = await mammoth.convertToHtml({ buffer: buf });

  return NextResponse.json({
    html,
    source,
    hasCleanVersion,
    cleanupAudit,
    hasSpeakerRoles: !!speakerRoles,
    rolesAudit,
    hasInferredSpeakers: !!inferredSpeakers,
    diarizationAudit,
  });
}

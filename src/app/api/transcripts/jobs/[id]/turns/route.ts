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
import { selectWithInferredFallback } from '@/lib/transcripts/jobs-select';
import { parseTranscriptTurns } from '@/lib/transcripts/turns';

// Structured transcript turns for the result fullview (좌 전사록 turn 스트림).
// Mirrors the preview route's select + label pipeline, but returns ordered
// {timestamp, speaker, role, text} turns (parsed from the labeled markdown) plus
// display meta instead of docx→HTML. Read-only; the job/전사 파이프는 불변.
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
  const source = url.searchParams.get('source') === 'raw' ? 'raw' : 'clean';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const baseColumns =
    'filename, markdown, clean_markdown, speaker_roles, provider, status, user_id, created_at, duration_seconds, speakers_count, language';
  const { data: job, error } = await selectWithInferredFallback<
    Record<string, unknown>
  >(
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

  const sourceMarkdown =
    source === 'raw'
      ? (job.markdown as string)
      : ((job.clean_markdown as string | null) ?? (job.markdown as string));
  const speakerRoles = (job.speaker_roles as SpeakerRolesMap | null) ?? null;
  const inferredSpeakers =
    (job.inferred_speakers as InferredSpeakersPayload | null) ?? null;
  const labelLang = job.provider === 'deepgram' ? 'en' : 'ko';
  const labeledMarkdown = inferredSpeakers
    ? applyInferredSpeakerLabels(sourceMarkdown, inferredSpeakers, labelLang)
    : applySpeakerLabels(sourceMarkdown, speakerRoles, labelLang);

  const rawBase = ((job.filename as string | null) ?? '')
    .replace(/\.[^./]+$/, '')
    .trim();
  let displayName: string;
  if (rawBase && !looksAnonymous(rawBase)) {
    displayName = rawBase;
  } else {
    const { count } = await supabase
      .from('transcript_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', job.user_id as string)
      .eq('status', 'done')
      .lte('created_at', job.created_at as string);
    const n = Math.max(1, count ?? 1);
    displayName = `Interview Transcript #${n}`;
  }

  const turns = parseTranscriptTurns(labeledMarkdown);

  return NextResponse.json({
    turns,
    meta: {
      name: displayName,
      durationSeconds: (job.duration_seconds as number | null) ?? null,
      speakers: (job.speakers_count as number | null) ?? null,
      language: (job.language as string | null) ?? null,
      provider: (job.provider as string | null) ?? null,
      createdAt: job.created_at as string,
    },
    source,
  });
}

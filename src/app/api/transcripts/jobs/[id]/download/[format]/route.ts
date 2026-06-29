import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { markdownToDocx } from '@/lib/transcripts/docx';
import {
  buildArtifactFilename,
  contentDispositionHeader,
} from '@/lib/filename';
import {
  applySpeakerLabels,
  type SpeakerRolesMap,
} from '@/lib/transcripts/speaker-roles';
import {
  applyInferredSpeakerLabels,
  type InferredSpeakersPayload,
} from '@/lib/transcripts/diarization';
import { selectWithInferredFallback } from '@/lib/transcripts/jobs-select';

export const maxDuration = 60;

function markdownToPlainText(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  let inFront = false;
  let frontDone = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line.trim() === '---') {
      inFront = true;
      continue;
    }
    if (inFront && !frontDone && line.trim() === '---') {
      frontDone = true;
      inFront = false;
      continue;
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// Names like `06482ba9-f750-494a-b643-419f075b64af` or 24+ char hex blobs are
// upload tokens, not human identifiers. Drop them in favour of a generic name.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_BLOB_RE = /^[0-9a-f]{24,}$/i;
const RANDOM_BLOB_RE = /^[A-Za-z0-9_-]{20,}$/; // base64url-ish
function looksAnonymous(base: string): boolean {
  const trimmed = base.trim();
  if (!trimmed) return true;
  if (UUID_RE.test(trimmed)) return true;
  if (HEX_BLOB_RE.test(trimmed)) return true;
  // Pure random base64url-ish strings with no readable letters/words
  if (RANDOM_BLOB_RE.test(trimmed) && !/[aeiouAEIOU][a-zA-Z]{2,}/.test(trimmed)) {
    return true;
  }
  return false;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; format: string }> },
) {
  const { id, format } = await params;
  if (format !== 'md' && format !== 'docx' && format !== 'txt') {
    return NextResponse.json({ error: 'unsupported_format' }, { status: 400 });
  }
  const url = new URL(req.url);
  // Mirrors the preview route's ?source query so download links from the
  // toggled view land the matching file (raw → original, clean → cleaned).
  const source = url.searchParams.get('source') === 'raw' ? 'raw' : 'clean';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // inferred_speakers 컬럼은 마이그 (#505) prod 적용 전엔 없어서 select 자체가
  // 깨짐. selectWithInferredFallback 가 try-then-fallback 으로 graceful degrade.
  const baseColumns =
    'filename, markdown, clean_markdown, speaker_roles, provider, status, user_id, created_at';
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
  const sourceMarkdown =
    source === 'raw'
      ? (job.markdown as string)
      : ((job.clean_markdown as string | null) ?? (job.markdown as string));
  const speakerRoles = (job.speaker_roles as SpeakerRolesMap | null) ?? null;
  const inferredSpeakers =
    (job.inferred_speakers as InferredSpeakersPayload | null) ?? null;
  // 라벨 언어는 잡의 provider 에서 추론 — deepgram=영어, elevenlabs=한국어.
  // 영어 잡은 "Interviewer 1/Interviewee 1", 한국어 잡은 "질문자 1/응답자 1".
  // inferred_speakers (Q&A 문맥 diarization) 있으면 turn 별 host/guest 우선.
  const labelLang = job.provider === 'deepgram' ? 'en' : 'ko';
  const labeledMarkdown = inferredSpeakers
    ? applyInferredSpeakerLabels(sourceMarkdown, inferredSpeakers, labelLang)
    : applySpeakerLabels(sourceMarkdown, speakerRoles, labelLang);

  // 1) Try the original filename. If it looks like a person/identifier, keep it.
  // 2) Otherwise fall back to a stable per-user index: "Interview Transcript #N",
  //    where N counts this user's prior `done` jobs (≤ this row's created_at).
  // `displayBase` is the human-friendly label that lands in the doc cover and
  // front-matter; `slug` is the kebab-safe token used in the filename so we
  // don't end up with "transcript-Interview-Transcript-#3-…".
  const rawBase = ((job.filename as string | null) ?? '')
    .replace(/\.[^./]+$/, '')
    .trim();
  let displayBase: string;
  let slug: string;
  if (rawBase && !looksAnonymous(rawBase)) {
    displayBase = rawBase;
    slug = rawBase;
  } else {
    const { count } = await supabase
      .from('transcript_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', job.user_id as string)
      .eq('status', 'done')
      .lte('created_at', job.created_at as string);
    const n = Math.max(1, count ?? 1);
    displayBase = `Interview Transcript #${n}`;
    slug = `session-${n}`;
  }

  // Mirror the resolved display name into the front-matter `file:` field so the
  // cover H1 and the meta grid show the human-friendly name, not the UUID.
  const displayMarkdown = labeledMarkdown.replace(
    /^(file:\s*).*$/m,
    `$1${displayBase}`,
  );

  // Hoist `job.created_at` into a local — the inner closure loses TS's
  // null-narrowing on `job` otherwise.
  const jobCreatedAt = job.created_at as string;
  function fileFor(ext: 'md' | 'txt' | 'docx'): string {
    return buildArtifactFilename({
      prefix: 'transcript',
      slug,
      createdAt: jobCreatedAt,
      ext,
    });
  }

  if (format === 'md') {
    return new Response(displayMarkdown, {
      status: 200,
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': contentDispositionHeader(fileFor('md')),
      },
    });
  }

  if (format === 'txt') {
    // Drop YAML front-matter fences, render `key: value` rows + body as plain
    // text so the download opens cleanly in any text editor.
    const plain = markdownToPlainText(displayMarkdown);
    return new Response(plain, {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': contentDispositionHeader(fileFor('txt')),
      },
    });
  }

  // docx
  const buf = await markdownToDocx(displayMarkdown);
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'content-type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'content-disposition': contentDispositionHeader(fileFor('docx')),
      'content-length': String(buf.length),
    },
  });
}

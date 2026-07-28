// Transcript export 렌더러 — 4포맷(docx/md/txt/srt) 변환의 단일 소스.
//
// 이 로직은 원래 `GET /api/transcripts/jobs/[id]/download/[format]/route.ts`
// 안에 인라인돼 있었다. Export 레지스트리 도입으로 **이동(move, not rewrite)**
// 했다 — 출력 바이트는 이동 전과 동일해야 한다(기존 다운로드 버튼 회귀 0).
// 기존 라우트와 신규 단일 진입점(/api/artifacts/[feature]/[id]/export/[format])
// 이 둘 다 이 함수를 호출해 로직을 단일화한다.

import { markdownToDocx } from '@/lib/transcripts/docx';
import { buildArtifactFilename } from '@/lib/filename';
import {
  applySpeakerLabels,
  type SpeakerRolesMap,
} from '@/lib/transcripts/speaker-roles';
import {
  applyInferredSpeakerLabels,
  type InferredSpeakersPayload,
} from '@/lib/transcripts/diarization';
import { selectWithInferredFallback } from '@/lib/transcripts/jobs-select';
import { parseTranscriptTurns, turnsToSrt } from '@/lib/transcripts/turns';
import type {
  ExportGate,
  ExportResult,
} from '@/lib/artifacts/export-registry';

type SupabaseServer = Awaited<
  ReturnType<typeof import('@/lib/supabase/server').createClient>
>;

export type TranscriptFormat = 'md' | 'docx' | 'txt' | 'srt';

export function isTranscriptFormat(v: string): v is TranscriptFormat {
  return v === 'md' || v === 'docx' || v === 'txt' || v === 'srt';
}

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// 회의록 요약 블록을 전사 마크다운의 front-matter 직후(본문 상단)에 삽입.
// docx 는 markdownToDocx 의 opts 로 별 챕터 렌더하지만, md/txt 는 순수 텍스트라
// 여기서 직접 끼워넣는다. front-matter 펜스(`---`)를 못 찾으면 맨 앞에 붙인다.
function insertSummary(markdown: string, summary: string): string {
  const lines = markdown.split(/\r?\n/);
  let insertAt = 0;
  if (lines[0]?.trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        insertAt = i + 1;
        break;
      }
    }
  }
  const head = lines.slice(0, insertAt).join('\n');
  const tail = lines.slice(insertAt).join('\n');
  return `${head}\n\n${summary.trim()}\n${tail}`;
}

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

// 전사 잡을 요청 포맷으로 렌더. 성공 시 ExportResult, 자원 미비 시 ExportGate.
// 반환 바이트는 이동 전 라우트와 동일(생성일 스탬프 등 무해 diff 제외).
export async function renderTranscriptExport(
  supabase: SupabaseServer,
  id: string,
  format: TranscriptFormat,
  source: 'raw' | 'clean',
): Promise<ExportResult | ExportGate> {
  // inferred_speakers 컬럼은 마이그 (#505) prod 적용 전엔 없어서 select 자체가
  // 깨짐. selectWithInferredFallback 가 try-then-fallback 으로 graceful degrade.
  const baseColumns =
    'filename, markdown, clean_markdown, speaker_roles, provider, status, user_id, created_at';
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
  if (error || !job) return { gate: 'not_found' };
  const status = job.status as string | null;
  if (status !== 'done' || !job.markdown) return { gate: 'not_ready' };

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

  // 회의록 모드 잡이면 요약 + Todo 블록. md/txt 는 본문 상단에 삽입, docx 는
  // markdownToDocx 가 별 챕터로 렌더. 리서치/실패 잡은 NULL → 현행 그대로.
  const summaryMarkdown = (job.meeting_summary as string | null) ?? undefined;
  const mdWithSummary = summaryMarkdown
    ? insertSummary(displayMarkdown, summaryMarkdown)
    : displayMarkdown;

  const jobCreatedAt = job.created_at as string;
  const fileFor = (ext: TranscriptFormat): string =>
    buildArtifactFilename({
      prefix: 'transcript',
      slug,
      createdAt: jobCreatedAt,
      ext,
    });

  if (format === 'md') {
    return {
      body: mdWithSummary,
      mime: 'text/markdown; charset=utf-8',
      filename: fileFor('md'),
    };
  }

  if (format === 'txt') {
    // Drop YAML front-matter fences, render `key: value` rows + body as plain
    // text so the download opens cleanly in any text editor.
    const plain = markdownToPlainText(mdWithSummary);
    return {
      body: plain,
      mime: 'text/plain; charset=utf-8',
      filename: fileFor('txt'),
    };
  }

  if (format === 'srt') {
    // 자막 — 라벨링된 turn(시점 + 화자 + 발화)을 SubRip 큐로. 요약 블록은
    // 자막에 무의미하므로 제외하고 순수 발화 turn 만 렌더한다.
    const srt = turnsToSrt(parseTranscriptTurns(labeledMarkdown));
    return {
      body: srt,
      mime: 'application/x-subrip; charset=utf-8',
      filename: fileFor('srt'),
    };
  }

  // docx — 요약은 splice 대신 별 챕터로(커버 다음, 본문 앞) 렌더.
  const buf = await markdownToDocx(displayMarkdown, { summaryMarkdown });
  return {
    body: new Uint8Array(buf),
    mime: DOCX_MIME,
    filename: fileFor('docx'),
  };
}

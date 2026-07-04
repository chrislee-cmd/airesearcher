import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

// Interview V2 — files belonging to one interview_project.
//
// Backs the file list in the V2 project-detail view. interview_documents
// has no per-row status column; the indexing state lives on the parent
// interview_jobs.index_status (pending / indexing / done / error). We embed
// it via the direct FK interview_documents.interview_job_id → interview_jobs.id
// so each file row can render an in-flight / done / error pill.
//
// Scope: org_id (matching the has_org_role RLS on interview_documents) +
// project_id. Documents are only attached to a project by the upload flow
// shipped in a later spec, so this list is expected to be empty for now.

type DocRow = {
  id: string;
  filename: string;
  mime: string | null;
  char_count: number;
  markdown: string | null;
  created_at: string;
  // Per-document indexing progress. total_chunks is null for documents
  // indexed before the progress migration (no backfill — card shows "완료").
  total_chunks: number | null;
  processed_chunks: number | null;
  interview_jobs: { index_status: string | null } | null;
};

// Whitespace-split word count. For Korean this counts 어절 (space-separated
// tokens) — a fair, language-agnostic proxy for "단어수" that lets a user
// confirm the whole document was captured (no truncation).
function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// Strip a leading timestamp, optionally bracketed: [00:12:34] (1:02) 00:12 …
function stripLeadingTimestamps(s: string): string {
  return s.replace(/^(?:[[(]?\s*\d{1,2}:\d{2}(?::\d{2})?\s*[\])]?\s*)+/, '');
}

// Exact speaker labels the transcript formatter recognizes (see
// src/lib/markdown-format.ts). Used to strip a leading "Moderator: …" style
// tag in the fallback path so only the plain question text remains.
const SPEAKER_PREFIX =
  /^(?:M|R|Q|A|I|P|진행자|응답자|면접관|참여자|인터뷰어|Moderator|Interviewer|Respondent|Participant|Interviewee)\s*[:：]\s*/i;

// Reduce a raw line to the plain question: drop markdown headings / list
// markers, the "Q." prefix, timestamps, and a speaker label (either order).
function cleanQuestion(s: string): string {
  let out = s.replace(/\s+/g, ' ').trim();
  out = out.replace(/^#+\s*/, ''); // markdown heading
  out = out.replace(/^Q\.\s*/i, ''); // "## Q." question prefix
  out = out.replace(/^[>\-*•\s]+/, ''); // list markers
  out = stripLeadingTimestamps(out);
  out = out.replace(SPEAKER_PREFIX, '');
  out = stripLeadingTimestamps(out);
  return out.trim();
}

// First / last question in the document. The structured transcript format
// emits every question as a "## Q. <text>" heading (no speaker/timestamp), so
// we read those directly. Falls back to "?"-terminated sentences (with
// timestamp + speaker stripped) only for un-structured docs. Surfacing both
// endpoints lets a user confirm the transcript was captured from its very
// first to its very last question — nothing truncated at either end. Null
// when the doc has no question form.
function extractQuestions(text: string): {
  first: string | null;
  last: string | null;
} {
  const fromHeadings = [...text.matchAll(/^##\s*Q\.\s*(.+?)\s*$/gm)]
    .map((m) => cleanQuestion(m[1]))
    .filter((q) => q.length > 1)
    .map((q) => q.slice(0, 140));
  if (fromHeadings.length > 0) {
    return {
      first: fromHeadings[0],
      last: fromHeadings[fromHeadings.length - 1],
    };
  }

  const matches = text.match(/[^.!?？。\n]*[?？]/g);
  if (!matches) return { first: null, last: null };
  const qs = matches
    .map((s) => cleanQuestion(s))
    .filter((s) => s.length > 1)
    .map((s) => s.slice(0, 140));
  if (qs.length === 0) return { first: null, last: null };
  return { first: qs[0], last: qs[qs.length - 1] };
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
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const org = await getActiveOrg();
  if (!org?.org_id) {
    return NextResponse.json({ documents: [] });
  }

  // markdown is the lossless normalized text; we pull it to derive byte size
  // + word count server-side (proving no truncation to the user) and drop it
  // from the response so the payload stays light.
  const { data, error } = await supabase
    .from('interview_documents')
    .select(
      'id, filename, mime, char_count, markdown, created_at, total_chunks, processed_chunks, interview_jobs(index_status)',
    )
    .eq('org_id', org.org_id)
    .eq('project_id', id)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('[interviews/v2/projects/:id/documents] list error', error);
    return NextResponse.json({ error: 'list_failed' }, { status: 500 });
  }

  const documents = ((data ?? []) as unknown as DocRow[]).map((d) => {
    const md = d.markdown ?? '';
    const q = extractQuestions(md);
    return {
      id: d.id,
      filename: d.filename,
      mime: d.mime,
      char_count: d.char_count,
      // UTF-8 byte size of the stored text = the file's "용량".
      byte_size: Buffer.byteLength(md, 'utf8'),
      word_count: wordCount(md),
      // Document's first / last question (or null when not Q&A shaped).
      first_question: q.first,
      last_question: q.last,
      created_at: d.created_at,
      // Chunk-level progress; null total means "no progress info" (old doc).
      total_chunks: d.total_chunks,
      processed_chunks: d.processed_chunks ?? 0,
      index_status: d.interview_jobs?.index_status ?? 'pending',
    };
  });

  return NextResponse.json({ documents });
}

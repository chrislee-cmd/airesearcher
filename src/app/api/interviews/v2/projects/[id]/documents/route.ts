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

// First / last question in the document. A "question" = a sentence ending in
// ? / ？ (the char class stops at the previous sentence boundary so each match
// is one sentence, not a whole paragraph). Surfacing both endpoints lets a
// user confirm the transcript was captured from its very first to its very
// last question — nothing truncated at either end. Null when the doc has no
// question form.
function extractQuestions(text: string): {
  first: string | null;
  last: string | null;
} {
  const matches = text.match(/[^.!?？。\n]*[?？]/g);
  if (!matches) return { first: null, last: null };
  const qs = matches
    .map((s) => s.replace(/\s+/g, ' ').trim())
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
      'id, filename, mime, char_count, markdown, created_at, interview_jobs(index_status)',
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
      index_status: d.interview_jobs?.index_status ?? 'pending',
    };
  });

  return NextResponse.json({ documents });
}

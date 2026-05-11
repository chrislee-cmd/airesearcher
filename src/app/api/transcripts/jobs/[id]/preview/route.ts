import { NextResponse } from 'next/server';
import mammoth from 'mammoth';
import { createClient } from '@/lib/supabase/server';
import { markdownToDocx } from '@/lib/transcripts/docx';

export const maxDuration = 60;

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
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: job, error } = await supabase
    .from('transcript_jobs')
    .select('filename, markdown, status, user_id, created_at')
    .eq('id', id)
    .single();
  if (error || !job) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (job.status !== 'done' || !job.markdown) {
    return NextResponse.json({ error: 'not_ready' }, { status: 409 });
  }

  const rawBase = (job.filename ?? '').replace(/\.[^./]+$/, '').trim();
  let base: string;
  if (rawBase && !looksAnonymous(rawBase)) {
    base = rawBase;
  } else {
    const { count } = await supabase
      .from('transcript_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', job.user_id)
      .eq('status', 'done')
      .lte('created_at', job.created_at);
    const n = Math.max(1, count ?? 1);
    base = `Interview Transcript #${n}`;
  }

  const displayMarkdown = (job.markdown as string).replace(
    /^(file:\s*).*$/m,
    `$1${base}`,
  );

  // Pipeline: markdown → docx (same generator used for download) → HTML.
  // This guarantees the in-page preview shows the user the same content layout
  // the docx file will render, without shipping the raw docx to the browser.
  const buf = await markdownToDocx(displayMarkdown);
  const { value: html } = await mammoth.convertToHtml({ buffer: buf });

  return NextResponse.json({ html });
}

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { markdownToDocx } from '@/lib/transcripts/docx';

export const maxDuration = 60;

function asciiSafe(name: string) {
  // Strip directory chars; keep dots and basic ascii
  return name.replace(/[/\\]/g, '_').replace(/[^A-Za-z0-9._-]+/g, '_');
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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; format: string }> },
) {
  const { id, format } = await params;
  if (format !== 'md' && format !== 'docx' && format !== 'txt') {
    return NextResponse.json({ error: 'unsupported_format' }, { status: 400 });
  }

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

  // 1) Try the original filename. If it looks like a person/identifier, keep it.
  // 2) Otherwise fall back to a stable per-user index: "Interview Transcript #N",
  //    where N counts this user's prior `done` jobs (≤ this row's created_at).
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

  const safeBase = asciiSafe(base) || 'transcript';
  const utf8Base = encodeURIComponent(base) || 'transcript';

  // Mirror the resolved display name into the front-matter `file:` field so the
  // cover H1 and the meta grid show the human-friendly name, not the UUID.
  const displayMarkdown = (job.markdown as string).replace(
    /^(file:\s*).*$/m,
    `$1${base}`,
  );

  if (format === 'md') {
    return new Response(displayMarkdown, {
      status: 200,
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${safeBase}.md"; filename*=UTF-8''${utf8Base}.md`,
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
        'content-disposition': `attachment; filename="${safeBase}.txt"; filename*=UTF-8''${utf8Base}.txt`,
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
      'content-disposition': `attachment; filename="${safeBase}.docx"; filename*=UTF-8''${utf8Base}.docx`,
      'content-length': String(buf.length),
    },
  });
}

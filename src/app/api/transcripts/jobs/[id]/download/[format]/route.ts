import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { markdownToDocx } from '@/lib/transcripts/docx';

export const maxDuration = 60;

function asciiSafe(name: string) {
  // Strip directory chars; keep dots and basic ascii
  return name.replace(/[/\\]/g, '_').replace(/[^A-Za-z0-9._-]+/g, '_');
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; format: string }> },
) {
  const { id, format } = await params;
  if (format !== 'md' && format !== 'docx') {
    return NextResponse.json({ error: 'unsupported_format' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: job, error } = await supabase
    .from('transcript_jobs')
    .select('filename, markdown, status')
    .eq('id', id)
    .single();
  if (error || !job) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (job.status !== 'done' || !job.markdown) {
    return NextResponse.json({ error: 'not_ready' }, { status: 409 });
  }

  // Strip extension off the original filename for the download name
  const base = (job.filename ?? 'transcript').replace(/\.[^./]+$/, '');
  const safeBase = asciiSafe(base) || 'transcript';
  const utf8Base = encodeURIComponent(base) || 'transcript';

  if (format === 'md') {
    return new Response(job.markdown, {
      status: 200,
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${safeBase}.md"; filename*=UTF-8''${utf8Base}.md`,
      },
    });
  }

  // docx
  const buf = await markdownToDocx(job.markdown);
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

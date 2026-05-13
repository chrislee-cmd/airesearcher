import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { classifyFile, extractDocText } from '@/lib/file-extract';

// Sidecar to the enhance route: turns a single uploaded context file into
// plain markdown/text so the client can stash it in a ContextPayload
// `file` input. We do NOT keep the binary anywhere — only the extracted
// text travels onward.

export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_OUTPUT_CHARS = 80_000;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'no_file' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'empty_file' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  }

  const kind = classifyFile(file);
  if (kind !== 'text' && kind !== 'docx' && kind !== 'xlsx') {
    return NextResponse.json({ error: 'unsupported_file_type' }, { status: 415 });
  }

  try {
    const raw = await extractDocText(file);
    const text = raw.length > MAX_OUTPUT_CHARS
      ? `${raw.slice(0, MAX_OUTPUT_CHARS)}\n\n[...truncated]`
      : raw;
    return NextResponse.json({
      filename: file.name,
      mime: file.type || undefined,
      size: file.size,
      normalized_md: text,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'extraction_failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

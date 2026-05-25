import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { deskMarkdownToDocx } from '@/lib/desk-docx';
import { contentDispositionHeader } from '@/lib/filename';

export const maxDuration = 60;

const Body = z.object({
  markdown: z.string().min(1).max(500_000),
  // Client passes the base name from `buildArtifactBaseName` (no extension).
  // We append `.docx` here so the workspace title and the downloaded file
  // resolve to the same string on disk.
  filename: z.string().min(1).max(120).optional(),
  title: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { markdown, filename, title } = parsed.data;

  const buffer = await deskMarkdownToDocx(markdown, title);
  const base = (filename ?? 'desk-research').replace(/\.docx$/i, '');
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'content-type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'content-disposition': contentDispositionHeader(`${base}.docx`),
      'cache-control': 'no-store',
    },
  });
}

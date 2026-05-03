import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { deskMarkdownToDocx } from '@/lib/desk-docx';

export const maxDuration = 60;

const Body = z.object({
  markdown: z.string().min(1).max(500_000),
  filename: z.string().min(1).max(120).optional(),
  title: z.string().max(200).optional(),
});

function safeFilename(name: string): string {
  // Strip control chars, slashes, and trim. Keep Korean/Latin/digits/dot/dash/underscore/space.
  const cleaned = name
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'desk-research';
}

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
  const safe = safeFilename(filename ?? 'desk-research');
  const encoded = encodeURIComponent(`${safe}.docx`);

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'content-type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'content-disposition': `attachment; filename="desk-research.docx"; filename*=UTF-8''${encoded}`,
      'cache-control': 'no-store',
    },
  });
}

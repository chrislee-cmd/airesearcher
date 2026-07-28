import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { deskMarkdownToDocx } from '@/lib/desk-docx';
import { contentDispositionHeader } from '@/lib/filename';

export const maxDuration = 60;

// @deprecated — 위젯은 아직 이 클라-마크다운 POST 라우트로 다운로드한다. docx
// 변환은 deskMarkdownToDocx 로 단일화돼 있고, 신규 단일 진입점
// `GET /api/artifacts/desk/[id]/export/docx` 은 desk_jobs.output 을 서버에서
// 읽어 같은 함수를 호출한다(출력 바이트 동일). 버튼 배선 전환은 후속 PR.

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

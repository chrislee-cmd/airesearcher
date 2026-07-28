import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { contentDispositionHeader } from '@/lib/filename';
import {
  isTranscriptFormat,
  renderTranscriptExport,
} from '@/lib/transcripts/export-render';

// @deprecated — 위젯 다운로드 버튼은 아직 이 라우트를 쓴다. 변환 로직은
// `@/lib/transcripts/export-render` 로 이동(move)했고 신규 단일 진입점
// `GET /api/artifacts/transcript/[id]/export/[format]` 이 같은 함수를 호출한다.
// 버튼 배선 전환은 후속(library-ui) PR. 출력 바이트는 이동 전과 동일.

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; format: string }> },
) {
  const { id, format } = await params;
  if (!isTranscriptFormat(format)) {
    return NextResponse.json({ error: 'unsupported_format' }, { status: 400 });
  }
  const url = new URL(req.url);
  // Mirrors the preview route's ?source query so download links from the
  // toggled view land the matching file (raw → original, clean → cleaned).
  const source = url.searchParams.get('source') === 'raw' ? 'raw' : 'clean';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const result = await renderTranscriptExport(supabase, id, format, source);
  if ('gate' in result) {
    return result.gate === 'not_found'
      ? NextResponse.json({ error: 'not_found' }, { status: 404 })
      : NextResponse.json({ error: 'not_ready' }, { status: 409 });
  }

  const body =
    typeof result.body === 'string' ? result.body : new Uint8Array(result.body);
  const contentLength =
    typeof result.body === 'string'
      ? Buffer.byteLength(result.body, 'utf8')
      : result.body.byteLength;
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': result.mime,
      'content-disposition': contentDispositionHeader(result.filename),
      'content-length': String(contentLength),
    },
  });
}

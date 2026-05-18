import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { refreshAccessToken, hasDriveFileScope } from '@/lib/google-oauth';
import { createGoogleDoc, createGoogleDocFromBytes } from '@/lib/share/google-docs';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: oauth } = await supabase
    .from('user_google_oauth')
    .select('refresh_token, scope')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!oauth) {
    return NextResponse.json({ error: 'not_connected' }, { status: 401 });
  }
  // We create the Doc by uploading source bytes (HTML or DOCX) to Drive
  // for on-the-fly conversion. drive.file scope is sufficient — gives
  // access only to files the app creates, not the user's whole Drive.
  if (!hasDriveFileScope(oauth.scope)) {
    return NextResponse.json({ error: 'missing_docs_scope' }, { status: 401 });
  }

  let accessToken: string;
  try {
    const refreshed = await refreshAccessToken(oauth.refresh_token);
    accessToken = refreshed.access_token;
  } catch {
    return NextResponse.json({ error: 'token_refresh_failed' }, { status: 500 });
  }

  const contentType = request.headers.get('content-type') ?? '';

  try {
    // Multipart path: client uploads pre-built DOCX / HTML bytes. Drive
    // converts them to a Google Doc with rich formatting preserved.
    if (contentType.startsWith('multipart/form-data')) {
      const form = await request.formData();
      const title = String(form.get('title') ?? '').trim() || '리서치 문서';
      const file = form.get('file');
      const sourceMime =
        String(form.get('mimeType') ?? '').trim() ||
        (file instanceof Blob ? file.type : '') ||
        'application/octet-stream';

      if (!(file instanceof Blob)) {
        return NextResponse.json({ error: 'missing_file' }, { status: 400 });
      }
      const bytes = await file.arrayBuffer();
      const result = await createGoogleDocFromBytes(
        accessToken,
        title,
        bytes,
        sourceMime,
      );
      return NextResponse.json(result);
    }

    // JSON path: legacy markdown source — converted to HTML server-side.
    const body = (await request.json()) as { title?: string; text?: string };
    const title = body.title?.trim() || '리서치 문서';
    const text = body.text?.trim() || '';
    const result = await createGoogleDoc(accessToken, title, text);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

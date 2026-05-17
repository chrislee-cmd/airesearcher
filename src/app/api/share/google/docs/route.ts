import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { refreshAccessToken, hasDocsScope } from '@/lib/google-oauth';
import { createGoogleDoc } from '@/lib/share/google-docs';

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
  if (!hasDocsScope(oauth.scope)) {
    return NextResponse.json({ error: 'missing_docs_scope' }, { status: 401 });
  }

  const body = (await request.json()) as { title?: string; text?: string };
  const title = body.title?.trim() || '리서치 문서';
  const text = body.text?.trim() || '';

  let accessToken: string;
  try {
    const refreshed = await refreshAccessToken(oauth.refresh_token);
    accessToken = refreshed.access_token;
  } catch {
    return NextResponse.json({ error: 'token_refresh_failed' }, { status: 500 });
  }

  try {
    const result = await createGoogleDoc(accessToken, title, text);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { refreshAccessToken, hasSheetsScope } from '@/lib/google-oauth';
import { createGoogleSheet } from '@/lib/share/google-sheets';

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
  if (!hasSheetsScope(oauth.scope)) {
    return NextResponse.json({ error: 'missing_sheets_scope' }, { status: 401 });
  }

  const body = (await request.json()) as { title?: string; rows?: string[][] };
  const title = body.title?.trim() || '리서치 데이터';
  const rows = body.rows ?? [];

  if (rows.length === 0) {
    return NextResponse.json({ error: 'empty_rows' }, { status: 400 });
  }

  let accessToken: string;
  try {
    const refreshed = await refreshAccessToken(oauth.refresh_token);
    accessToken = refreshed.access_token;
  } catch {
    return NextResponse.json({ error: 'token_refresh_failed' }, { status: 500 });
  }

  try {
    const result = await createGoogleSheet(accessToken, title, rows);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

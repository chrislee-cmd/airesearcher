// AI 동시통역 — re-issue a Gemini Live Translate auth token.
//
// Each token is single-use; the host client calls this whenever it needs
// a fresh session token (e.g. to reopen a dropped WebSocket without
// re-creating the translate_sessions row).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { issueLiveTranslateSession, liveTranslateModel } from '@/lib/gemini-live';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: row, error } = await supabase
    .from('translate_sessions')
    .select('id, host_user_id, source_lang, target_lang, status')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (row.host_user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (row.status === 'ended') {
    return NextResponse.json({ error: 'session_ended' }, { status: 410 });
  }

  let s;
  try {
    s = await issueLiveTranslateSession({
      sourceLang: row.source_lang,
      targetLang: row.target_lang,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'gemini_failed' },
      { status: 502 },
    );
  }
  return NextResponse.json({
    gemini: { model: liveTranslateModel(), client_secret: s.client_secret },
  });
}

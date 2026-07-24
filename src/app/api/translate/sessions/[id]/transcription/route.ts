// AI 동시통역 — issue an ephemeral client_secret for the SOURCE transcription
// lane (fix A).
//
// Companion to ../ephemeral (which re-issues the TRANSLATION session secret).
// The source lane is a second, transcription-only Realtime session that pins
// the session's source language so a ko interview is recognised as Korean
// instead of drifting to Japanese kana / English hallucinations — the
// translations endpoint rejects the language hint, so the source captions must
// come from a dedicated transcription session (see openai-realtime.ts).
//
// No credit charge here: the translate session's start-lump + heartbeat
// already meter the whole session on the translation lane. This route only
// mints an OpenAI ephemeral for the parallel STT connection over the same
// captured audio. Same owner/ownership guard as ../ephemeral.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  issueSourceTranscriptionSession,
  sourceTranscriptionModel,
} from '@/lib/openai-realtime';

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
    .select('id, host_user_id, source_lang, status')
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

  // Source language is server-authoritative (from the session row), never
  // client-supplied — the client can't spoof the recognised language.
  let s;
  try {
    s = await issueSourceTranscriptionSession({ sourceLang: row.source_lang });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'openai_failed' },
      { status: 502 },
    );
  }
  return NextResponse.json({
    openai: { model: sourceTranscriptionModel(), client_secret: s.client_secret },
  });
}

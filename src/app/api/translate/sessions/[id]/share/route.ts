// AI 동시통역 — share link CRUD.
//
// POST   issues (or rotates) the share_token + expires_at for a session.
// DELETE revokes the share link (sets share_token = NULL).
//
// share_token = URL-safe random, 21 chars. crypto.randomBytes is used
// directly to avoid pulling nanoid as a top-level dep just for this.

import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const TOKEN_LEN = 21;
const DEFAULT_TTL_HOURS = 4;
const URL_SAFE =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

function makeToken(): string {
  const bytes = randomBytes(TOKEN_LEN);
  let out = '';
  for (let i = 0; i < TOKEN_LEN; i++) out += URL_SAFE[bytes[i] & 63];
  return out;
}

async function requireHost(sessionId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'unauthorized' as const, status: 401 };
  const { data: row, error } = await supabase
    .from('translate_sessions')
    .select('id, host_user_id, status')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!row) return { error: 'not_found' as const, status: 404 };
  if (row.host_user_id !== user.id) return { error: 'forbidden' as const, status: 403 };
  return { supabase, user, row } as const;
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const gate = await requireHost(id);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { supabase } = gate;

  const token = makeToken();
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_HOURS * 3600 * 1000);
  const { data, error } = await supabase
    .from('translate_sessions')
    .update({ share_token: token, expires_at: expiresAt.toISOString() })
    .eq('id', id)
    .select('share_token, expires_at')
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'share_failed' },
      { status: 500 },
    );
  }
  return NextResponse.json({
    share_token: data.share_token,
    expires_at: data.expires_at,
  });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const gate = await requireHost(id);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { supabase } = gate;
  const { error } = await supabase
    .from('translate_sessions')
    .update({ share_token: null, expires_at: null })
    .eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

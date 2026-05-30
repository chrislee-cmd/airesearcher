// AI 동시통역 — public session metadata for a share token.
//
// Anon viewers hit this first to discover lang pair / status / room
// name. We use the dedicated RPC (created in migration 0022) instead of
// a raw SELECT so the table schema stays private and the token check is
// centralized.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  if (!token || token.length < 16 || token.length > 32) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  }
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('get_translate_session_by_token', {
    p_token: token,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({
    session: {
      id: row.id,
      source_lang: row.source_lang,
      target_lang: row.target_lang,
      status: row.status,
      livekit_room: row.livekit_room,
      record_enabled: row.record_enabled,
      started_at: row.started_at,
      expires_at: row.expires_at,
    },
  });
}

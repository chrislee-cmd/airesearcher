// AI 동시통역 — late-join viewer transcript backfill.
//
// When a viewer opens the share link partway through a session we hand
// them whatever has already been captioned so the page isn't empty.
// Uses the public RPC `get_translate_transcript` which gates on
// record_enabled — when the host opted out of recording, this returns
// nothing and the viewer just sees live deltas from the broadcast
// channel.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  if (!token || token.length < 16 || token.length > 32) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  }
  const url = new URL(request.url);
  const sinceParam = url.searchParams.get('since');
  const limitParam = url.searchParams.get('limit');
  const since = sinceParam ? new Date(sinceParam) : new Date(0);
  if (Number.isNaN(since.getTime())) {
    return NextResponse.json({ error: 'invalid_since' }, { status: 400 });
  }
  const limit = limitParam ? Math.max(1, Math.min(500, Number(limitParam) || 500)) : 500;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('get_translate_transcript', {
    p_token: token,
    p_since: since.toISOString(),
    p_limit: limit,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: Array.isArray(data) ? data : [] });
}

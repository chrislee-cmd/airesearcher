// GET /api/ut/sessions/[id]/clips/[clipId]/play[?disposition=inline]
//   → { url, expires_in }
//
// Short-lived signed URL for a single insight clip in the private ut-clips
// bucket. ⚠ PRIVACY: clips are cut from the screen recording (can contain
// login/checkout frames) so the bytes never leave via a public bucket — only
// through this route, owner OR super-admin only (gate in loadUtSession), 5-min
// TTL. disposition=inline plays it in the gallery <video>; default downloads.
import { NextResponse } from 'next/server';
import { loadUtSession } from '@/lib/ut/auth';

export const runtime = 'nodejs';

const SIGNED_URL_TTL_SECONDS = 300;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; clipId: string }> },
) {
  const { id, clipId } = await ctx.params;

  const gate = await loadUtSession(id);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { admin } = gate;

  // Clip must belong to THIS session (defence-in-depth beyond the session gate).
  const { data: clip } = await admin
    .from('ut_clips')
    .select('storage_key, session_id')
    .eq('id', clipId)
    .maybeSingle<{ storage_key: string | null; session_id: string }>();
  if (!clip || clip.session_id !== id || !clip.storage_key) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const inline = new URL(req.url).searchParams.get('disposition') === 'inline';
  const { data, error } = await admin.storage
    .from('ut-clips')
    .createSignedUrl(clip.storage_key, SIGNED_URL_TTL_SECONDS, inline ? {} : { download: true });
  if (error || !data) {
    return NextResponse.json(
      { error: 'sign_failed', detail: error?.message ?? 'no signed url' },
      { status: 500 },
    );
  }

  return NextResponse.json({ url: data.signedUrl, expires_in: SIGNED_URL_TTL_SECONDS });
}

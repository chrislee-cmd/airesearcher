// GET /api/ut/sessions/[id]/download?kind=recording|audio → { url, kind, expires_in }
//
// Returns a SHORT-LIVED signed URL for the private recording / audio object.
// ⚠ PRIVACY: the screen recording can contain login passwords / card numbers,
// so the bytes never leave via a public bucket — only through this route, and
// only for the session owner OR a super-admin (gate in loadUtSession). URL TTL
// is deliberately short (5 min) and forces a download disposition.
import { NextResponse } from 'next/server';
import { loadUtSession } from '@/lib/ut/auth';

export const runtime = 'nodejs';

const SIGNED_URL_TTL_SECONDS = 300; // 5 min — short-lived (privacy)

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const kind = new URL(req.url).searchParams.get('kind');
  if (kind !== 'recording' && kind !== 'audio') {
    return NextResponse.json({ error: 'invalid_kind' }, { status: 400 });
  }

  const gate = await loadUtSession(id);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { admin, session } = gate;

  const bucket = kind === 'audio' ? 'ut-audio' : 'ut-recording';
  const key = kind === 'audio' ? session.audio_storage_key : session.recording_storage_key;
  if (!key) {
    return NextResponse.json({ error: 'not_uploaded' }, { status: 404 });
  }

  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(key, SIGNED_URL_TTL_SECONDS, { download: true });
  if (error || !data) {
    return NextResponse.json(
      { error: 'sign_failed', detail: error?.message ?? 'no signed url returned' },
      { status: 500 },
    );
  }

  return NextResponse.json({ url: data.signedUrl, kind, expires_in: SIGNED_URL_TTL_SECONDS });
}

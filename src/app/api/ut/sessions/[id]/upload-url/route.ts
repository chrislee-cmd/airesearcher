// POST /api/ut/sessions/[id]/upload-url { kind: 'audio' | 'recording' }
//   → { storage_key, upload_url, token, bucket }
//
// Mints a Supabase Storage signed upload URL so the browser streams the large
// webm blob straight to storage (spec §제약 — 업로드는 클라→스토리지 직접,
// DB엔 key만). The server stamps the resulting key onto the row and flips
// status to 'uploading'. Only the session OWNER may upload — a super-admin can
// read (download) but never writes into someone's session.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loadUtSession } from '@/lib/ut/auth';

export const runtime = 'nodejs';

const Body = z.object({
  kind: z.enum(['audio', 'recording']),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const { kind } = parsed.data;

  const gate = await loadUtSession(id);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  if (!gate.isOwner) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const { user, admin, session } = gate;

  const bucket = kind === 'audio' ? 'ut-audio' : 'ut-recording';
  // {user_id}/{session_id}/{kind}-{ts}.webm — leading {user_id} satisfies the
  // per-user storage RLS; timestamp avoids a collision if the client retries.
  const ts = Date.now();
  const storageKey = `${user.id}/${session.id}/${kind}-${ts}.webm`;

  const { data: signed, error: signedErr } = await admin.storage
    .from(bucket)
    .createSignedUploadUrl(storageKey);
  if (signedErr || !signed) {
    return NextResponse.json(
      { error: 'storage_unavailable', detail: signedErr?.message ?? 'no signed url returned' },
      { status: 500 },
    );
  }

  const patch =
    kind === 'audio'
      ? { audio_storage_key: storageKey }
      : { recording_storage_key: storageKey };
  const { error: updErr } = await admin
    .from('ut_sessions')
    .update({ ...patch, status: 'uploading' })
    .eq('id', session.id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({
    storage_key: storageKey,
    upload_url: signed.signedUrl,
    token: signed.token,
    bucket,
  });
}

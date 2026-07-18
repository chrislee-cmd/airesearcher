// POST /api/ut/public/[token]/upload-url { kind:'audio'|'recording', ext? }
//   → { storage_key, upload_url, token, bucket }
//
// Token-scoped counterpart of /api/ut/sessions/[id]/upload-url for the anon
// participant. participant_token IS the authorization (the participant is not
// authenticated). The server validates the token, then mints a signed upload
// URL so the participant streams their recorded webm straight to storage — the
// same 614 pattern the local flow uses, reused verbatim.
//
// ⚠ PRIVACY: objects land under the OWNER's (researcher's) {user_id} prefix in
// the private ut-audio / ut-recording buckets, so recording/transcript
// ownership stays with the researcher and the existing owner/super-admin read
// policies apply. The participant only ever holds a short-lived signed upload
// URL, never bucket access.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUtToken } from '@/lib/ut/public';

export const runtime = 'nodejs';

const Body = z.object({
  kind: z.enum(['audio', 'recording']),
  ext: z.enum(['webm', 'mp4', 'm4a']).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const { kind } = parsed.data;
  const allowed = kind === 'recording' ? ['mp4', 'webm'] : ['m4a', 'webm'];
  const ext = parsed.data.ext && allowed.includes(parsed.data.ext) ? parsed.data.ext : 'webm';

  const gate = await resolveUtToken(token);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { admin, session } = gate;
  if (session.status === 'done' || session.status === 'error') {
    return NextResponse.json({ error: 'session_ended' }, { status: 410 });
  }

  // Owner user_id → storage prefix. Fetched via the service role (the RPC keeps
  // owner private); the key stays under the researcher's prefix.
  const { data: owner, error: ownerErr } = await admin
    .from('ut_sessions')
    .select('user_id')
    .eq('id', session.id)
    .single();
  if (ownerErr || !owner) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const bucket = kind === 'audio' ? 'ut-audio' : 'ut-recording';
  const ts = Date.now();
  const storageKey = `${owner.user_id}/${session.id}/${kind}-${ts}.${ext}`;

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
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({
    storage_key: storageKey,
    upload_url: signed.signedUrl,
    token: signed.token,
    bucket,
  });
}

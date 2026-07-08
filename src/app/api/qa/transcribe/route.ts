import { NextResponse } from 'next/server';
import { z } from 'zod';
import { env } from '@/env';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { ELEVENLABS_API_MODEL } from '@/lib/transcripts/models';
import type { ElevenLabsScribeResult } from '@/lib/transcripts/elevenlabs';

// POST /api/qa/transcribe { feedback_id }
//
// Async transcription for a QA voice-feedback row. The browser has already
// uploaded the audio and inserted a `qa_feedbacks` row (status 'pending');
// this endpoint is fired-and-forgotten from the client. It walks the row
// through 'transcribing' → 'done' (or 'error'), filling `transcript`.
//
// QA recordings are short (seconds to a couple of minutes), so — unlike the
// long-interview transcripts pipeline which uses ElevenLabs' async webhook
// mode + a polling endpoint — we call Scribe **synchronously** and store the
// result inline. That keeps the whole feature to one round trip and stays
// well inside the function timeout.
export const maxDuration = 60;

const Body = z.object({
  feedback_id: z.string().uuid(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { feedback_id } = parsed.data;

  // ── Gate 1: authentication ───────────────────────────────────────────────
  // The only legitimate caller is the logged-in QA tester whose browser just
  // inserted the row and fired this off. No session → no transcription.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // ── Gate 2: rate limit (per user) ────────────────────────────────────────
  // This route triggers a paid ElevenLabs Scribe call, so cap it per user to
  // stop a single account from running up STT cost. Fail-open while Upstash is
  // unprovisioned is a known limitation tracked separately (#497).
  const limit = await rateLimit(user.id, 'qa-transcribe', 10, '1 m');
  if (!limit.success) {
    return rateLimitResponse(limit);
  }

  // ── Gate 3: ownership ────────────────────────────────────────────────────
  // Read through the caller's RLS-scoped client and pin the row to their own
  // user_id. A non-existent OR non-owned id both come back empty → 404, so we
  // never reveal that someone else's feedback row exists. Only after this gate
  // passes do we escalate to the service role for the privileged work below.
  const { data: owned, error: ownErr } = await supabase
    .from('qa_feedbacks')
    .select('id')
    .eq('id', feedback_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (ownErr || !owned) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const apiKey = env.ELEVENLABS_API_KEY;
  // Service role: transcription must read the private audio object and write
  // back the transcript (RLS has no user UPDATE policy — transcription writes
  // go through service role). Safe to use now that the ownership gate passed.
  const admin = createAdminClient();

  const { data: row, error: rowErr } = await admin
    .from('qa_feedbacks')
    .select('id, audio_storage_key, status, meta')
    .eq('id', feedback_id)
    .single();
  if (rowErr || !row) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Preserve the client-captured meta (user_agent, …) — error detail is
  // merged in, never clobbered, since the table has no dedicated error column.
  const baseMeta =
    row.meta && typeof row.meta === 'object' ? (row.meta as Record<string, unknown>) : {};
  const failWith = async (error: string) => {
    await admin
      .from('qa_feedbacks')
      .update({ status: 'error', meta: { ...baseMeta, error } })
      .eq('id', feedback_id);
  };

  if (!apiKey) {
    await failWith('missing_elevenlabs_key');
    return NextResponse.json({ error: 'missing_elevenlabs_key' }, { status: 500 });
  }

  await admin.from('qa_feedbacks').update({ status: 'transcribing' }).eq('id', feedback_id);

  // Pull the audio bytes down (private bucket) and hand them to Scribe as a
  // multipart file — no signed-URL round trip needed for a small blob.
  const { data: audio, error: dlErr } = await admin.storage
    .from('qa-feedback-audio')
    .download(row.audio_storage_key);
  if (dlErr || !audio) {
    await failWith(`download_failed: ${dlErr?.message ?? 'no_data'}`);
    return NextResponse.json({ error: 'download_failed' }, { status: 502 });
  }

  const form = new FormData();
  form.append('model_id', ELEVENLABS_API_MODEL);
  form.append('file', audio, 'feedback.webm');
  // No webhook flag → the POST blocks until the transcript is ready and
  // returns the full result body (fine for short clips).

  let resp: Response;
  try {
    resp = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'elevenlabs_fetch_failed';
    await failWith(msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    await failWith(`elevenlabs_${resp.status}: ${txt.slice(0, 200)}`);
    return NextResponse.json({ error: 'elevenlabs_rejected' }, { status: 502 });
  }

  const result = (await resp.json().catch(() => ({}))) as ElevenLabsScribeResult;
  const transcript = (result.data?.text ?? result.text ?? '').trim();

  await admin
    .from('qa_feedbacks')
    .update({ transcript, status: 'done' })
    .eq('id', feedback_id);

  // The client fires this off fire-and-forget and never reads the body, so we
  // return only an ack — the transcript lives in the row (read back via the
  // RLS-scoped admin viewer), never echoed over HTTP.
  return NextResponse.json({ ok: true, feedback_id });
}

// AI 동시통역 — recording lifecycle for a session.
//
// GET    — read the most recent recording for a session (so the host UI
//          can render the locked/unlocked CTA on page reload).
// POST   — create a `translate_recordings` row + return a Supabase Storage
//          signed upload URL. Called by the host the moment recording
//          starts (right after MediaRecorder enters the recording state).
// PATCH  — finalize: the host PATCHes once MediaRecorder.stop has run and
//          the upload has flushed. We stamp size_bytes / duration_sec and
//          flip status to 'uploaded' so the UI can show the locked CTA.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

export const runtime = 'nodejs';
export const maxDuration = 30;

const CreateBody = z.object({}).optional();

const FinalizeBody = z.object({
  recording_id: z.string().uuid(),
  size_bytes: z.number().int().nonnegative(),
  duration_sec: z.number().int().nonnegative(),
});

type SafeFnSession = {
  id: string;
  host_user_id: string;
  org_id: string;
};

async function loadHostSession(sessionId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'unauthorized' as const, status: 401 } as const;

  const { data, error } = await supabase
    .from('translate_sessions')
    .select('id, host_user_id, org_id')
    .eq('id', sessionId)
    .maybeSingle<SafeFnSession>();
  if (error) return { error: error.message, status: 500 } as const;
  if (!data) return { error: 'not_found' as const, status: 404 } as const;
  if (data.host_user_id !== user.id) {
    return { error: 'forbidden' as const, status: 403 } as const;
  }
  return { supabase, user, session: data } as const;
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await ctx.params;

  // Reads `body` defensively so the route still works when the host posts
  // an empty body (current console behaviour). Reserved for future
  // recorder hints (e.g. mime preference).
  await CreateBody.safeParse(undefined);

  const gate = await loadHostSession(sessionId);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { supabase, user, session } = gate;

  const org = await getActiveOrg();
  if (!org || org.org_id !== session.org_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Storage path under the host's prefix so the existing per-user RLS on
  // storage.objects (audio-uploads bucket) covers the upload + read.
  const ts = Date.now();
  const storageKey = `${user.id}/translate-recordings/${sessionId}-${ts}.webm`;

  // Insert metadata first so we can return the recording_id alongside the
  // upload URL. Storage write failures will leave a 'recording' row that
  // gets swept in a follow-up cron.
  const insert = await supabase
    .from('translate_recordings')
    .insert({
      session_id: sessionId,
      org_id: session.org_id,
      host_user_id: user.id,
      storage_key: storageKey,
      mime_type: 'audio/webm',
      status: 'recording',
    })
    .select('id, storage_key')
    .single();
  if (insert.error || !insert.data) {
    return NextResponse.json(
      { error: insert.error?.message ?? 'recording_create_failed' },
      { status: 500 },
    );
  }

  const { data: signed, error: signedErr } = await supabase.storage
    .from('audio-uploads')
    .createSignedUploadUrl(storageKey);
  if (signedErr || !signed) {
    return NextResponse.json(
      { error: signedErr?.message ?? 'signed_url_failed' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    recording_id: insert.data.id,
    storage_key: storageKey,
    upload_url: signed.signedUrl,
    token: signed.token,
  });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await ctx.params;
  const parsed = FinalizeBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { recording_id, size_bytes, duration_sec } = parsed.data;

  const gate = await loadHostSession(sessionId);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { supabase, user } = gate;

  // Defensive: only allow finalize on the host's own row, attached to
  // this session.
  const { data: row, error: readErr } = await supabase
    .from('translate_recordings')
    .select('id, status, host_user_id, session_id')
    .eq('id', recording_id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (row.host_user_id !== user.id || row.session_id !== sessionId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (row.status === 'unlocked') {
    // Already paid — don't let a stale finalize overwrite the paid state.
    return NextResponse.json({ ok: true });
  }

  const { error } = await supabase
    .from('translate_recordings')
    .update({
      size_bytes,
      duration_sec,
      status: 'uploaded',
    })
    .eq('id', recording_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await ctx.params;

  const gate = await loadHostSession(sessionId);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { supabase } = gate;

  const { data, error } = await supabase
    .from('translate_recordings')
    .select('id, status, size_bytes, duration_sec, credits_spent, unlocked_at, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ recording: data?.[0] ?? null });
}

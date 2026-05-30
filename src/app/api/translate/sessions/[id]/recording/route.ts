// AI 동시통역 — recording lifecycle for a session.
//
// GET    — read the most recent recording for a session (so the host UI
//          can render the locked/unlocked CTA on page reload).
// POST   — create / extend a `translate_recordings` row + return a
//          Supabase Storage signed upload URL. Two tracks are recorded:
//            kind=output  (default, legacy) → host's translated TTS,
//                          stored in `storage_key`
//            kind=input                     → host's source mic/tab audio,
//                          stored in `input_storage_key`
//          The first POST for a session inserts a fresh row; a follow-up
//          POST for the OTHER kind on the same session UPDATEs that row
//          rather than creating a new one. Net: one row per session with
//          both keys populated.
// PATCH  — finalize: the host PATCHes once both MediaRecorders have
//          stopped and both uploads have flushed. We stamp size_bytes
//          (sum of both) / duration_sec (longer of the two) and flip
//          status to 'uploaded' so the UI can show the locked CTA.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

export const runtime = 'nodejs';
export const maxDuration = 30;

// `kind` defaults to 'output' so legacy clients (and the PR-B unit-test
// surface that still POSTs without a body) keep landing on `storage_key`.
const CreateBody = z
  .object({
    kind: z.enum(['input', 'output']).optional(),
  })
  .optional();

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
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await ctx.params;

  // Parse body (or query string) for `kind`. Tolerates empty bodies and
  // legacy `?kind=` callers. Default = 'output' to preserve back-compat
  // with the pre-split single-file recorder code path.
  let kind: 'input' | 'output' = 'output';
  try {
    const url = new URL(req.url);
    const fromQuery = url.searchParams.get('kind');
    if (fromQuery === 'input' || fromQuery === 'output') {
      kind = fromQuery;
    }
  } catch {}
  try {
    const body = await req.json().catch(() => undefined);
    const parsed = CreateBody.safeParse(body);
    if (parsed.success && parsed.data?.kind) kind = parsed.data.kind;
  } catch {}

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
  // storage.objects (audio-uploads bucket) covers the upload + read. We
  // tag the kind into the filename so the two webm files for one session
  // are visually distinguishable in the bucket.
  const ts = Date.now();
  const storageKey = `${user.id}/translate-recordings/${sessionId}-${ts}-${kind}.webm`;

  // Look for an existing in-flight or finalized row for this session.
  // If one exists, we attach this second track to it rather than
  // creating a parallel row.
  const existing = await supabase
    .from('translate_recordings')
    .select('id, status, storage_key, input_storage_key')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error) {
    return NextResponse.json({ error: existing.error.message }, { status: 500 });
  }

  // Only attach to a row that's still mid-flight (status='recording').
  // An already-uploaded or unlocked row belongs to a previous recording
  // attempt — start fresh.
  let recordingId: string;
  if (existing.data && existing.data.status === 'recording') {
    const patch: Record<string, string> = {};
    if (kind === 'output') patch.storage_key = storageKey;
    else patch.input_storage_key = storageKey;
    const upd = await supabase
      .from('translate_recordings')
      .update(patch)
      .eq('id', existing.data.id)
      .select('id')
      .single();
    if (upd.error || !upd.data) {
      return NextResponse.json(
        { error: upd.error?.message ?? 'recording_update_failed' },
        { status: 500 },
      );
    }
    recordingId = upd.data.id;
  } else {
    const insertPayload: Record<string, string> = {
      session_id: sessionId,
      org_id: session.org_id,
      host_user_id: user.id,
      mime_type: 'audio/webm',
      status: 'recording',
      // storage_key is NOT NULL in the schema. For an input-first POST
      // (rare — current console POSTs output first), seed the column
      // with a placeholder under the host's prefix; the follow-up
      // output POST will overwrite it.
      storage_key:
        kind === 'output'
          ? storageKey
          : `${user.id}/translate-recordings/${sessionId}-${ts}-output-pending.webm`,
    };
    if (kind === 'input') insertPayload.input_storage_key = storageKey;

    const insert = await supabase
      .from('translate_recordings')
      .insert(insertPayload)
      .select('id')
      .single();
    if (insert.error || !insert.data) {
      return NextResponse.json(
        { error: insert.error?.message ?? 'recording_create_failed' },
        { status: 500 },
      );
    }
    recordingId = insert.data.id;
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
    recording_id: recordingId,
    kind,
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

  // Aggregate finalize: PATCH is called once per track with that track's
  // own size + duration. We keep the row's stored fields equal to the
  // SUM of sizes and the MAX (longest) of durations so the row is
  // self-describing without joining a per-track table.
  // Fetch current values to merge.
  const current = await supabase
    .from('translate_recordings')
    .select('size_bytes, duration_sec')
    .eq('id', recording_id)
    .maybeSingle<{ size_bytes: number | null; duration_sec: number | null }>();
  const prevSize = current.data?.size_bytes ?? 0;
  const prevDur = current.data?.duration_sec ?? 0;
  const nextSize = prevSize + size_bytes;
  const nextDur = Math.max(prevDur, duration_sec);

  const { error } = await supabase
    .from('translate_recordings')
    .update({
      size_bytes: nextSize,
      duration_sec: nextDur,
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

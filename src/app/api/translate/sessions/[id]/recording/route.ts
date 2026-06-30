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
import { createAdminClient } from '@/lib/supabase/admin';
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
  const { user, session } = gate;

  const org = await getActiveOrg();
  if (!org || org.org_id !== session.org_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // The host ownership + org gates above (loadHostSession + getActiveOrg)
  // are the authorization boundary. The actual row write + signed-URL
  // mint go through the service role so a prod RLS drift on
  // translate_recordings (PROJECT.md §7.5 — migrations don't auto-apply)
  // can't silently turn every reserve into `reserve_failed`. This mirrors
  // the /messages + /download routes, which already write via admin for
  // exactly this resilience reason.
  const admin = createAdminClient();

  // Storage path under the host's prefix so the existing per-user RLS on
  // storage.objects (audio-uploads bucket) covers the upload + read. We
  // tag the kind into the filename so the two webm files for one session
  // are visually distinguishable in the bucket.
  const ts = Date.now();
  const storageKey = `${user.id}/translate-recordings/${sessionId}-${ts}-${kind}.webm`;

  // Look for an existing in-flight or finalized row for this session.
  // If one exists, we attach this second track to it rather than
  // creating a parallel row.
  const existing = await admin
    .from('translate_recordings')
    .select('id, status, storage_key, input_storage_key')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error) {
    console.error('[translate/recording] existing-row lookup failed', {
      session_id: sessionId,
      error: existing.error.message,
    });
    return NextResponse.json(
      { error: 'recording_lookup_failed', detail: existing.error.message },
      { status: 500 },
    );
  }

  // Only attach to a row that's still mid-flight (status='recording').
  // An already-uploaded or unlocked row belongs to a previous recording
  // attempt — start fresh.
  let recordingId: string;
  if (existing.data && existing.data.status === 'recording') {
    const patch: Record<string, string> = {};
    if (kind === 'output') patch.storage_key = storageKey;
    else patch.input_storage_key = storageKey;
    const upd = await admin
      .from('translate_recordings')
      .update(patch)
      .eq('id', existing.data.id)
      .select('id')
      .single();
    if (upd.error || !upd.data) {
      console.error('[translate/recording] row update failed', {
        session_id: sessionId,
        kind,
        error: upd.error?.message,
      });
      return NextResponse.json(
        {
          error: 'recording_update_failed',
          detail: upd.error?.message ?? 'no row returned',
        },
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

    const insert = await admin
      .from('translate_recordings')
      .insert(insertPayload)
      .select('id')
      .single();
    if (insert.error || !insert.data) {
      console.error('[translate/recording] row insert failed', {
        session_id: sessionId,
        kind,
        error: insert.error?.message,
      });
      return NextResponse.json(
        {
          error: 'recording_create_failed',
          detail: insert.error?.message ?? 'no row returned',
        },
        { status: 500 },
      );
    }
    recordingId = insert.data.id;
  }

  const { data: signed, error: signedErr } = await admin.storage
    .from('audio-uploads')
    .createSignedUploadUrl(storageKey);
  if (signedErr || !signed) {
    console.error('[translate/recording] signed upload URL mint failed', {
      session_id: sessionId,
      kind,
      bucket: 'audio-uploads',
      error: signedErr?.message,
    });
    return NextResponse.json(
      {
        error: 'storage_unavailable',
        detail: signedErr?.message ?? 'no signed url returned',
      },
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
  const { user } = gate;
  // Service-role finalize for the same §7.5 RLS-drift resilience as POST.
  // The host ownership check below (row.host_user_id === user.id) is the
  // authorization boundary, not the table RLS.
  const admin = createAdminClient();

  // Defensive: only allow finalize on the host's own row, attached to
  // this session.
  const { data: row, error: readErr } = await admin
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
  const current = await admin
    .from('translate_recordings')
    .select('size_bytes, duration_sec')
    .eq('id', recording_id)
    .maybeSingle<{ size_bytes: number | null; duration_sec: number | null }>();
  const prevSize = current.data?.size_bytes ?? 0;
  const prevDur = current.data?.duration_sec ?? 0;
  const nextSize = prevSize + size_bytes;
  const nextDur = Math.max(prevDur, duration_sec);

  const { error } = await admin
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
  // Read via service role so a translate_recordings RLS drift can't make
  // a real recording read back as "이 세션에는 녹음이 없습니다". The gate
  // above already verified the caller hosts this session.
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('translate_recordings')
    .select('id, status, size_bytes, duration_sec, credits_spent, unlocked_at, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ recording: data?.[0] ?? null });
}

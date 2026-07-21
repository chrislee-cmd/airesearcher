import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import {
  isMessageScope,
  MAX_MESSAGE_LENGTH,
  SCHED_MESSAGE_COLUMNS,
  type MessageScope,
} from '@/lib/scheduling/messages';

// Recruiting-scheduling chat (PR3), admin side. Same gate as the other
// /api/scheduling/* routes: non-admins get 404 (route stays unobservable) and
// all reads/writes go through the service-role client after isSuperAdminEmail.
// Participant send/read is PR4 — this route only ever creates admin rows.

// GET — list messages for the admin chat panel.
//   ?batch=<id>          → broadcast + every private thread for that batch's
//                          candidates (the panel's default load)
//   ?candidate_id=<id>   → one private thread
//   (neither)            → broadcast only
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const url = new URL(request.url);
  const batchId = url.searchParams.get('batch');
  const candidateId = url.searchParams.get('candidate_id');

  const admin = createAdminClient();

  // Single private thread.
  if (candidateId) {
    const { data, error } = await admin
      .from('sched_messages')
      .select(SCHED_MESSAGE_COLUMNS)
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: true })
      .limit(5000);
    if (error) {
      return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
    }
    return NextResponse.json(
      { messages: data ?? [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Whole batch: broadcast (candidate_id null) + private threads for this
  // batch's candidates. Two-step .in() rather than a PostgREST embed —
  // sched_messages and sched_batches have no direct FK (§7.10).
  if (batchId) {
    const { data: candRows, error: candErr } = await admin
      .from('sched_candidates')
      .select('id')
      .eq('batch_id', batchId)
      .limit(2000);
    if (candErr) {
      return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
    }
    const candidateIds = (candRows ?? []).map((c) => c.id as string);

    // PostgREST `.or()` with a dynamic id list; when the batch has no
    // candidates yet, fall back to broadcast-only.
    const query = admin
      .from('sched_messages')
      .select(SCHED_MESSAGE_COLUMNS)
      .order('created_at', { ascending: true })
      .limit(10000);
    const { data, error } =
      candidateIds.length > 0
        ? await query.or(
            `candidate_id.is.null,candidate_id.in.(${candidateIds.join(',')})`,
          )
        : await query.is('candidate_id', null);
    if (error) {
      return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
    }
    return NextResponse.json(
      { messages: data ?? [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Broadcast only.
  const { data, error } = await admin
    .from('sched_messages')
    .select(SCHED_MESSAGE_COLUMNS)
    .is('candidate_id', null)
    .order('created_at', { ascending: true })
    .limit(5000);
  if (error) {
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
  }
  return NextResponse.json(
    { messages: data ?? [] },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

// POST — admin sends a message.
//   { scope: 'broadcast', body }                → candidate_id null
//   { scope: 'private', candidate_id, body }    → 1:1 thread
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const scope: MessageScope = isMessageScope(b.scope) ? b.scope : 'broadcast';
  const text = typeof b.body === 'string' ? b.body.trim() : '';
  if (!text) {
    return NextResponse.json({ error: 'empty_body' }, { status: 400 });
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: 'body_too_long' }, { status: 400 });
  }

  // Enforce the scope↔candidate_id invariant in code (the DB CHECK backstops).
  let candidateId: string | null = null;
  if (scope === 'private') {
    candidateId = typeof b.candidate_id === 'string' ? b.candidate_id : '';
    if (!candidateId) {
      return NextResponse.json({ error: 'candidate_required' }, { status: 400 });
    }
  }

  const admin = createAdminClient();

  // For private, confirm the candidate exists (clean 404 vs. FK error).
  if (scope === 'private') {
    const { data: candidate } = await admin
      .from('sched_candidates')
      .select('id')
      .eq('id', candidateId)
      .maybeSingle();
    if (!candidate) {
      return NextResponse.json(
        { error: 'candidate_not_found' },
        { status: 404 },
      );
    }
  }

  const { data, error } = await admin
    .from('sched_messages')
    .insert({
      candidate_id: candidateId,
      scope,
      // PR3 is admin-only; participant send is PR4.
      sender_role: 'admin',
      sender_user_id: user!.id,
      body: text,
    })
    .select(SCHED_MESSAGE_COLUMNS)
    .single();

  if (error) {
    return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  }
  return NextResponse.json(
    { message: data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

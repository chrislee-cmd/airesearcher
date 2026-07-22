import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import {
  isMessageScope,
  MAX_MESSAGE_LENGTH,
  SCHED_MESSAGE_COLUMNS,
  SCHED_MESSAGE_COLUMNS_NARROW,
  widenNarrowMessage,
  type MessageScope,
  type SchedMessage,
} from '@/lib/scheduling/messages';

// Recruiting-scheduling chat (PR3), admin side. Same gate as the other
// /api/scheduling/* routes: non-admins get 404 (route stays unobservable) and
// all reads/writes go through the service-role client after isSuperAdminEmail.
// Participant send/read is PR4 — this route only ever creates admin rows.

// Wide→narrow fallback for a `.or()`-filtered read: run the wide select, and if
// the broadcast-mode columns aren't present yet (preview DB predating the
// migration), retry with the narrow set and widen the rows. `narrowOrFilter`
// omits any batch_id predicate (which can't exist without the column). Returns
// the normalized messages or null on a genuine error.
async function readMessages(
  admin: ReturnType<typeof createAdminClient>,
  wideOrFilter: string,
  narrowOrFilter: string,
  limit: number,
): Promise<SchedMessage[] | null> {
  const wide = await admin
    .from('sched_messages')
    .select(SCHED_MESSAGE_COLUMNS)
    .or(wideOrFilter)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (!wide.error) return (wide.data ?? []) as unknown as SchedMessage[];

  const narrow = await admin
    .from('sched_messages')
    .select(SCHED_MESSAGE_COLUMNS_NARROW)
    .or(narrowOrFilter)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (narrow.error) return null;
  return (narrow.data ?? []).map((r) => widenNarrowMessage(r));
}

// GET — list messages for the admin chat panel.
//   ?batch=<id>          → global broadcast + this batch's group broadcast +
//                          every private thread for that batch's candidates
//   ?candidate_id=<id>   → one private thread
//   (neither)            → broadcast only (global + every group)
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

  // Single private thread. No batch_id predicate, so wide and narrow filters
  // match; readMessages still handles the column-absent select fallback.
  if (candidateId) {
    const filter = `candidate_id.eq.${candidateId}`;
    const messages = await readMessages(admin, filter, filter, 5000);
    if (!messages) {
      return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
    }
    return NextResponse.json(
      { messages },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Whole batch: global broadcast (batch_id null) + THIS batch's group broadcast
  // (batch_id = batchId) + private threads for this batch's candidates. The batch
  // filter keeps other groups' announcements out of this scope. Two-step .in()
  // rather than a PostgREST embed — sched_messages and sched_batches have no
  // direct FK (§7.10).
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
    const privateClause =
      candidateIds.length > 0
        ? `,candidate_id.in.(${candidateIds.join(',')})`
        : '';

    // Wide: global + this-group broadcasts + private threads. Narrow (preview DB
    // without batch_id): every broadcast + private — group scoping simply can't
    // apply until the column exists, which is acceptable for the preview.
    const wideFilter =
      `and(candidate_id.is.null,batch_id.is.null),` +
      `and(candidate_id.is.null,batch_id.eq.${batchId})` +
      privateClause;
    const narrowFilter = `candidate_id.is.null${privateClause}`;
    const messages = await readMessages(admin, wideFilter, narrowFilter, 10000);
    if (!messages) {
      return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
    }
    return NextResponse.json(
      { messages },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Broadcast only (global + every group).
  const filter = 'candidate_id.is.null';
  const messages = await readMessages(admin, filter, filter, 5000);
  if (!messages) {
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
  }
  return NextResponse.json(
    { messages },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

// POST — admin sends a message.
//   { scope: 'broadcast', body, is_announcement?, batch_id? }
//        → candidate_id null. is_announcement (default true) picks banner vs
//          bubble; batch_id (default null) picks 전체 vs 그룹별 reach.
//   { scope: 'private', candidate_id, body }
//        → 1:1 thread (is_announcement/batch_id ignored — always announcement/global).
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

  // Broadcast axes. Private always renders as an announcement to its one
  // candidate (batch is meaningless there), so only read them for broadcast.
  const isAnnouncement =
    scope === 'broadcast' ? b.is_announcement !== false : true;
  const batchId =
    scope === 'broadcast' && typeof b.batch_id === 'string' && b.batch_id
      ? b.batch_id
      : null;

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

  // For a group send, confirm the batch exists (clean 400 vs. FK error).
  if (batchId) {
    const { data: batch } = await admin
      .from('sched_batches')
      .select('id')
      .eq('id', batchId)
      .maybeSingle();
    if (!batch) {
      return NextResponse.json({ error: 'batch_not_found' }, { status: 400 });
    }
  }

  const baseRow = {
    candidate_id: candidateId,
    scope,
    // PR3 is admin-only; participant send is PR4.
    sender_role: 'admin' as const,
    sender_user_id: user!.id,
    body: text,
  };

  const wide = await admin
    .from('sched_messages')
    .insert({ ...baseRow, is_announcement: isAnnouncement, batch_id: batchId })
    .select(SCHED_MESSAGE_COLUMNS)
    .single();

  let data = wide.data;
  let error = wide.error;

  // Preview DB predating the broadcast-mode columns — retry with the pre-modes
  // row. The message degrades to a global announcement (banner, everyone); the
  // migration restores full mode fidelity once applied.
  if (error) {
    const narrow = await admin
      .from('sched_messages')
      .insert(baseRow)
      .select(SCHED_MESSAGE_COLUMNS_NARROW)
      .single();
    data = narrow.data
      ? (widenNarrowMessage(narrow.data) as unknown as typeof data)
      : null;
    error = narrow.error;
  }

  if (error) {
    return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  }
  return NextResponse.json(
    { message: data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

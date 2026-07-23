import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getSchedulingAccess,
  ownerOfMessage,
  ownerAllowed,
} from '@/lib/scheduling/access';
import {
  MAX_MESSAGE_LENGTH,
  SCHED_MESSAGE_COLUMNS,
  SCHED_MESSAGE_COLUMNS_NARROW,
  widenNarrowMessage,
  type SchedMessage,
} from '@/lib/scheduling/messages';

// Edit / delete a recruiting-scheduling message (super-admin only). Mirrors the
// slots [id] route + the messages collection route gate: non-admins get 404 so
// the route stays unobservable, and every write goes through the service-role
// client after isSuperAdminEmail.
//
// SCOPE — broadcast only. Round-3 edit/delete targets announcements the admin
// mis-sent to a group/everyone; private 1:1 threads are out of scope, so every
// mutation filters `.eq('scope', 'broadcast')`. A private id therefore matches no
// row and returns 404 (never touched), enforcing the invariant in code on top of
// the RLS super-admin `for all` policy.

// PATCH — edit a broadcast message's body. { body } only; scope / candidate_id /
// sender_role are immutable. Stamps updated_at=now() (round-3 additive column)
// with a narrow retry so a preview DB predating the migration still saves the body.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const access = await getSchedulingAccess();
  if (!access) {
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

  const text = typeof b.body === 'string' ? b.body.trim() : '';
  if (!text) {
    return NextResponse.json({ error: 'empty_body' }, { status: 400 });
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: 'body_too_long' }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!access.superadmin) {
    const owner = await ownerOfMessage(admin, id);
    if (!ownerAllowed(access, owner)) {
      return NextResponse.json({ error: 'message_not_found' }, { status: 404 });
    }
  }

  // Wide update — set body + edit stamp, broadcast-only. Returns the wide row.
  const wide = await admin
    .from('sched_messages')
    .update({ body: text, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('scope', 'broadcast')
    .select(SCHED_MESSAGE_COLUMNS)
    .maybeSingle();

  let data = wide.data as SchedMessage | null;
  let error = wide.error;

  // Preview DB predating the updated_at column — retry the body-only edit so the
  // correction still lands (the "수정됨" marker just won't show until the migration
  // applies). Read back with the narrow set and widen.
  if (error) {
    const narrow = await admin
      .from('sched_messages')
      .update({ body: text })
      .eq('id', id)
      .eq('scope', 'broadcast')
      .select(SCHED_MESSAGE_COLUMNS_NARROW)
      .maybeSingle();
    data = narrow.data ? widenNarrowMessage(narrow.data) : null;
    error = narrow.error;
  }

  if (error) {
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
  if (!data) {
    // No broadcast row with this id — either absent or a private message (out of
    // scope). Both surface as not-found.
    return NextResponse.json({ error: 'message_not_found' }, { status: 404 });
  }
  return NextResponse.json(
    { message: data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

// DELETE — hard-remove a broadcast message. Broadcast-only (private is out of
// scope); .select() confirms a row actually matched so a private / missing id
// returns 404 rather than a silent 200.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const access = await getSchedulingAccess();
  if (!access) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const admin = createAdminClient();
  if (!access.superadmin) {
    const owner = await ownerOfMessage(admin, id);
    if (!ownerAllowed(access, owner)) {
      return NextResponse.json({ error: 'message_not_found' }, { status: 404 });
    }
  }
  const { data, error } = await admin
    .from('sched_messages')
    .delete()
    .eq('id', id)
    .eq('scope', 'broadcast')
    .select('id');
  if (error) {
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'message_not_found' }, { status: 404 });
  }
  return NextResponse.json(
    { ok: true },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

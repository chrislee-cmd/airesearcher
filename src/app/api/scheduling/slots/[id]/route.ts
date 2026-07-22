import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { isSlotStatus } from '@/lib/scheduling/slots';

// Edit an interview slot (super-admin only). Any subset of
// start_at/end_at/status/location/note may be sent; omitted keys are left
// untouched. Used for both drag/edit and the proposed↔confirmed status toggle.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

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

  const patch: Record<string, string | null> = {};
  if ('title' in b) {
    patch.title =
      typeof b.title === 'string' && b.title.trim() ? b.title.trim() : null;
  }
  if ('start_at' in b) {
    const d = new Date(typeof b.start_at === 'string' ? b.start_at : '');
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: 'invalid_time' }, { status: 400 });
    }
    patch.start_at = d.toISOString();
  }
  if ('end_at' in b) {
    const d = new Date(typeof b.end_at === 'string' ? b.end_at : '');
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: 'invalid_time' }, { status: 400 });
    }
    patch.end_at = d.toISOString();
  }
  if (
    patch.start_at != null &&
    patch.end_at != null &&
    new Date(patch.end_at).getTime() <= new Date(patch.start_at).getTime()
  ) {
    return NextResponse.json({ error: 'end_before_start' }, { status: 400 });
  }
  if ('status' in b) {
    if (!isSlotStatus(b.status)) {
      return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
    }
    patch.status = b.status;
  }
  if ('location' in b) {
    patch.location =
      typeof b.location === 'string' && b.location.trim()
        ? b.location.trim()
        : null;
  }
  if ('note' in b) {
    patch.note =
      typeof b.note === 'string' && b.note.trim() ? b.note.trim() : null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no_fields' }, { status: 400 });
  }

  const admin = createAdminClient();
  let { data, error } = await admin
    .from('sched_slots')
    .update(patch)
    .eq('id', id)
    .select('id, candidate_id, start_at, end_at, status, location, note')
    .maybeSingle();

  // Preview DB without the title column yet — retry the edit without title so
  // time/status/location/note edits still land (title is PR-B additive).
  if (error && 'title' in patch) {
    const { title: _title, ...rest } = patch;
    void _title;
    if (Object.keys(rest).length > 0) {
      const retry = await admin
        .from('sched_slots')
        .update(rest)
        .eq('id', id)
        .select('id, candidate_id, start_at, end_at, status, location, note')
        .maybeSingle();
      data = retry.data;
      error = retry.error;
    }
  }

  if (error) {
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'slot_not_found' }, { status: 404 });
  }
  return NextResponse.json(
    { slot: data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

// Delete a slot outright (super-admin only). The UI's "취소" status toggle
// keeps a cancelled record; this hard-removes it.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from('sched_slots').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 });
  }
  return NextResponse.json(
    { ok: true },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

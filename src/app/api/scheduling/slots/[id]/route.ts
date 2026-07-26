import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getSchedulingAccess,
  ownerOfSlot,
  ownerOfCandidate,
  ownerAllowed,
} from '@/lib/scheduling/access';
import { isSlotStatus } from '@/lib/scheduling/slots';

// Edit an interview slot. Open to super-admin OR org member; non-members get
// 404. Org members may only edit a slot whose owner shares an org with them
// (tenancy scoping). Any subset of
// title/start_at/end_at/status/location/note/candidate_id may be sent; omitted
// keys are left untouched. Reassigning candidate_id is constrained to the slot's
// own batch (blocks cross-group / cross-owner moves — card #580).
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

  // Target reassignment (card #580) — a uuid attaches that candidate, '' / null
  // detaches to a candidate-less titled event. Validated below against the
  // slot's own batch so a slot can never be moved to another group/owner. The
  // patch value itself is set only after that check passes.
  const hasCandidate = 'candidate_id' in b;
  const candidateIdValue: string | null =
    typeof b.candidate_id === 'string' && b.candidate_id.trim()
      ? b.candidate_id.trim()
      : null;

  if (!hasCandidate && Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no_fields' }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!access.superadmin) {
    const owner = await ownerOfSlot(admin, id);
    if (!ownerAllowed(access, owner)) {
      return NextResponse.json({ error: 'slot_not_found' }, { status: 404 });
    }
  }

  if (hasCandidate) {
    if (candidateIdValue) {
      // Fetch the slot's batch to scope the reassignment. A group-created slot
      // carries a batch_id; the new candidate must sit in that SAME batch —
      // this single check enforces both same-group and same-owner (batch owner
      // is fixed), keeping the slot = 1인 계약 intact.
      const { data: slotRow } = await admin
        .from('sched_slots')
        .select('batch_id')
        .eq('id', id)
        .maybeSingle();
      if (!slotRow) {
        return NextResponse.json({ error: 'slot_not_found' }, { status: 404 });
      }
      const { data: cand } = await admin
        .from('sched_candidates')
        .select('id, batch_id')
        .eq('id', candidateIdValue)
        .maybeSingle();
      if (!cand) {
        return NextResponse.json(
          { error: 'candidate_not_found' },
          { status: 404 },
        );
      }
      const slotBatch = (slotRow.batch_id as string | null) ?? null;
      const candBatch = (cand.batch_id as string | null) ?? null;
      if (slotBatch) {
        if (candBatch !== slotBatch) {
          return NextResponse.json(
            { error: 'candidate_batch_mismatch' },
            { status: 403 },
          );
        }
      } else if (!access.superadmin) {
        // Standalone slot (no batch to match) — still guard tenancy so a foreign
        // candidate can't be attached across orgs.
        const candOwner = await ownerOfCandidate(admin, candidateIdValue);
        if (!ownerAllowed(access, candOwner)) {
          return NextResponse.json(
            { error: 'candidate_not_found' },
            { status: 404 },
          );
        }
      }
    }
    patch.candidate_id = candidateIdValue;
  }
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

  const access = await getSchedulingAccess();
  if (!access) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const admin = createAdminClient();
  if (!access.superadmin) {
    const owner = await ownerOfSlot(admin, id);
    if (!ownerAllowed(access, owner)) {
      return NextResponse.json({ error: 'slot_not_found' }, { status: 404 });
    }
  }
  const { error } = await admin.from('sched_slots').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 });
  }
  return NextResponse.json(
    { ok: true },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

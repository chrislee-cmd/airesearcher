import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getSchedulingAccess,
  ownerOfBatch,
  ownerOfCandidate,
  ownerAllowed,
} from '@/lib/scheduling/access';
import { isSlotStatus, type SlotStatus } from '@/lib/scheduling/slots';

// Create an interview slot for a candidate. Open to super-admin OR org member;
// non-members get 404 (route stays unobservable). Org members are tenancy-
// scoped: the target batch/candidate must belong to an owner they may touch.
export async function POST(request: Request) {
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

  // PR-B: a slot needs a title OR a candidate. candidate_id is now optional
  // (standalone titled events), batch_id scopes the slot to its batch.
  // Group mode fans out one slot per candidate in the batch (this PR).
  const isGroup = b.mode === 'group';
  const candidateId = typeof b.candidate_id === 'string' ? b.candidate_id : '';
  const batchId = typeof b.batch_id === 'string' ? b.batch_id : '';
  const title =
    typeof b.title === 'string' && b.title.trim() ? b.title.trim() : '';
  const startAt = typeof b.start_at === 'string' ? b.start_at : '';
  const endAt = typeof b.end_at === 'string' ? b.end_at : '';
  // Group mode needs a batch to fan out over; individual mode needs a title or a
  // candidate. Both need valid times (validated below).
  if (isGroup ? !batchId : !title && !candidateId) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }
  if (!startAt || !endAt) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return NextResponse.json({ error: 'invalid_time' }, { status: 400 });
  }
  if (end.getTime() <= start.getTime()) {
    return NextResponse.json({ error: 'end_before_start' }, { status: 400 });
  }

  const status: SlotStatus = isSlotStatus(b.status) ? b.status : 'proposed';
  const location =
    typeof b.location === 'string' && b.location.trim()
      ? b.location.trim()
      : null;
  const note =
    typeof b.note === 'string' && b.note.trim() ? b.note.trim() : null;

  const admin = createAdminClient();

  // Tenancy scoping — the slot's batch (or candidate) must belong to an owner
  // the caller may touch (super-admin bypasses).
  if (!access.superadmin) {
    const owner = batchId
      ? await ownerOfBatch(admin, batchId)
      : candidateId
        ? await ownerOfCandidate(admin, candidateId)
        : null;
    if (!ownerAllowed(access, owner)) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
  }

  const wideCols =
    'id, candidate_id, batch_id, title, start_at, end_at, status, location, note';

  // Group fan-out: create one slot per candidate in the batch, all sharing the
  // same title/time/status/location/note. Individual rows keep every existing
  // read path (per-candidate "next slot", public participant view, overlap
  // warning) unchanged — no shared "group slot" row.
  if (isGroup) {
    const { data: batchCandidates, error: candErr } = await admin
      .from('sched_candidates')
      .select('id, status')
      .eq('batch_id', batchId);
    if (candErr) {
      return NextResponse.json({ error: 'create_failed' }, { status: 500 });
    }
    // Active roster only — a cancelled candidate shouldn't get a new slot.
    const targets = (batchCandidates ?? []).filter(
      (c) => c.status !== 'cancelled',
    );
    if (targets.length === 0) {
      return NextResponse.json({ error: 'no_candidates' }, { status: 400 });
    }
    const startIso = start.toISOString();
    const endIso = end.toISOString();
    const rows = targets.map((c) => ({
      candidate_id: c.id,
      batch_id: batchId || null,
      title: title || null,
      start_at: startIso,
      end_at: endIso,
      status,
      location,
      note,
    }));
    const { data: inserted, error: insertErr } = await admin
      .from('sched_slots')
      .insert(rows)
      .select(wideCols);
    if (insertErr) {
      return NextResponse.json({ error: 'create_failed' }, { status: 500 });
    }
    return NextResponse.json(
      { slots: inserted ?? [], count: inserted?.length ?? 0 },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Verify the candidate exists when one is attached (FK would reject a bogus id
  // anyway, but this returns a clean 404).
  if (candidateId) {
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

  let { data, error } = await admin
    .from('sched_slots')
    .insert({
      candidate_id: candidateId || null,
      batch_id: batchId || null,
      title: title || null,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      status,
      location,
      note,
    })
    .select(wideCols)
    .single();

  // Preview DB without the title/batch_id columns yet — keep candidate-slot
  // creation working by retrying with the pre-PR-B column set. A candidate-less
  // titled event genuinely can't be created until the migration applies.
  if (error && candidateId) {
    const narrow = await admin
      .from('sched_slots')
      .insert({
        candidate_id: candidateId,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        status,
        location,
        note,
      })
      .select('id, candidate_id, start_at, end_at, status, location, note')
      .single();
    data = narrow.data
      ? { ...narrow.data, batch_id: null, title: null }
      : null;
    error = narrow.error;
  }

  if (error) {
    return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  }
  return NextResponse.json(
    { slot: data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { isSlotStatus, type SlotStatus } from '@/lib/scheduling/slots';

// Create an interview slot for a candidate (super-admin only). Mirrors the
// /api/scheduling/batches gate: non-admins get 404 (route stays unobservable)
// and writes go through the service-role client after isSuperAdminEmail.
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

  const candidateId = typeof b.candidate_id === 'string' ? b.candidate_id : '';
  const startAt = typeof b.start_at === 'string' ? b.start_at : '';
  const endAt = typeof b.end_at === 'string' ? b.end_at : '';
  if (!candidateId || !startAt || !endAt) {
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

  // Verify the candidate exists (also confirms it's a real scheduling row —
  // the FK would reject a bogus id anyway, but this returns a clean 404).
  const { data: candidate } = await admin
    .from('sched_candidates')
    .select('id')
    .eq('id', candidateId)
    .maybeSingle();
  if (!candidate) {
    return NextResponse.json({ error: 'candidate_not_found' }, { status: 404 });
  }

  const { data, error } = await admin
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

  if (error) {
    return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  }
  return NextResponse.json(
    { slot: data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

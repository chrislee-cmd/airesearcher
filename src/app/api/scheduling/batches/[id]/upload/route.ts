import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSchedulingAccess, ownerAllowed } from '@/lib/scheduling/access';
import { parseCandidateFile } from '@/lib/scheduling/candidates-parse';
import { upsertCandidatesIntoBatch } from '@/lib/scheduling/candidates-upsert';

// Bulk-upload candidates into a batch from a CSV or XLSX file. Open to
// super-admin OR org member; non-members get 404. Org members may only upload
// into a batch whose owner shares an org with them (tenancy scoping). email is
// optional — candidates merge by best-available identity (email > phone >
// name); anonymous rows are appended. Merge is done in code: each parsed row
// resolves to an UPDATE (carries the matching existing row's id) or an INSERT
// (omits id). A single upsert on the `id` primary key applies both.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: batchId } = await params;

  const access = await getSchedulingAccess();
  if (!access) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: batch } = await admin
    .from('sched_batches')
    .select('id, owner_user_id')
    .eq('id', batchId)
    .maybeSingle();
  if (!batch) {
    return NextResponse.json({ error: 'batch_not_found' }, { status: 404 });
  }
  if (!ownerAllowed(access, (batch as { owner_user_id?: string }).owner_user_id)) {
    return NextResponse.json({ error: 'batch_not_found' }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'invalid_form' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file_required' }, { status: 400 });
  }
  const isSupported =
    /\.(csv|xlsx)$/i.test(file.name) ||
    file.type === 'text/csv' ||
    file.type ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (!isSupported) {
    return NextResponse.json({ error: 'unsupported_file' }, { status: 400 });
  }

  let parsed;
  try {
    parsed = await parseCandidateFile(file);
  } catch {
    return NextResponse.json({ error: 'parse_failed' }, { status: 400 });
  }
  if (parsed.candidates.length === 0) {
    return NextResponse.json({ error: 'no_candidates' }, { status: 400 });
  }

  const result = await upsertCandidatesIntoBatch(
    admin,
    batchId,
    parsed.candidates,
  );
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json(
    { upserted: result.upserted },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

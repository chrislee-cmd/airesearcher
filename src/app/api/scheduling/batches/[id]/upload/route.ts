import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { parseCandidateFile } from '@/lib/scheduling/candidates-parse';

// Bulk-upload candidates into a batch from a CSV or XLSX file (super-admin
// only; non-admins get 404). Candidates are merged by email — the
// unique(batch_id,email) constraint plus an upsert means re-uploading the same
// sheet updates existing rows in place instead of creating duplicates.
// participant_token is intentionally omitted from the upsert payload so the DB
// default mints it once on insert and existing rows keep their token.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: batchId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: batch } = await admin
    .from('sched_batches')
    .select('id')
    .eq('id', batchId)
    .maybeSingle();
  if (!batch) {
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
    return NextResponse.json(
      { error: 'no_candidates', skippedNoEmail: parsed.skippedNoEmail },
      { status: 400 },
    );
  }

  const rows = parsed.candidates.map((c) => ({
    batch_id: batchId,
    email: c.email,
    name: c.name,
    phone: c.phone,
    fields: c.fields,
  }));

  const { data, error } = await admin
    .from('sched_candidates')
    .upsert(rows, { onConflict: 'batch_id,email' })
    .select('id');
  if (error) {
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }

  return NextResponse.json(
    { upserted: data?.length ?? 0, skippedNoEmail: parsed.skippedNoEmail },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

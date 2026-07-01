import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { getAdminUsageReport } from '@/lib/admin/providers';
import { saveSnapshot } from '@/lib/admin/snapshots';

// Shared implementation for "저장" and "리셋". Both persist the current
// cumulative usage as a new baseline — the only difference is the label
// the user clicked, so we let the caller stamp a distinguishing `note`.
// Non-admins get 404 (not 403) so the route isn't probeable, matching
// the GET aggregator's behaviour.
export async function handleSnapshotSave(
  req: Request,
  defaultNote?: string,
): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Body is optional — an empty POST is a valid "save with no note".
  let note: string | undefined = defaultNote;
  try {
    const body = (await req.json()) as { note?: unknown };
    if (typeof body?.note === 'string' && body.note.trim()) {
      note = body.note.trim();
    }
  } catch {
    // No/invalid JSON body — keep defaultNote.
  }

  const report = await getAdminUsageReport();
  // user.email is non-null here — isSuperAdminEmail rejects null/undefined.
  const snapshot = await saveSnapshot({ report, email: user!.email!, note });
  return NextResponse.json(snapshot, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

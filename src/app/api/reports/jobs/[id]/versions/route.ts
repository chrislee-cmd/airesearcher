import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { listVersions } from '@/lib/reports/versions';

// Lists the version tree for a single report. RLS on report_versions does
// the org-access check via the parent report_jobs row.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const versions = await listVersions(supabase, id);
    return NextResponse.json({ versions });
  } catch (e) {
    console.error('[reports/versions] list error', e);
    return NextResponse.json({ error: 'list_failed' }, { status: 500 });
  }
}

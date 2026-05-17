import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getVersion } from '@/lib/reports/versions';

// Move the "head" pointer to a specific version. Also materializes
// markdown/html on report_jobs so legacy readers see the chosen version.

const Body = z.object({
  version: z.number().int().nonnegative(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { version } = parsed.data;

  const target = await getVersion(supabase, id, version);
  if (!target) {
    return NextResponse.json({ error: 'version_not_found' }, { status: 404 });
  }

  const { error } = await supabase
    .from('report_jobs')
    .update({
      markdown: target.markdown,
      html: target.html,
      head_version: version,
    })
    .eq('id', id);
  if (error) {
    console.error('[reports/head] update failed', error);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, version });
}

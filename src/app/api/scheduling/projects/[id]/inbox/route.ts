import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';

// Resolve (create if missing) a project's inbox batch — the flat pool uploads
// land in (PR-C follow-up). Groups are made later by assigning list-checked
// candidates; the inbox is not one of them. Super-admin only; non-admins 404.
//
// is_inbox may be absent on a preview DB without the additive migration — the
// insert-with-is_inbox then errors and we retry without it (wide/narrow).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const admin = createAdminClient();

  const { data: project } = await admin
    .from('sched_projects')
    .select('id, title')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) {
    return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
  }

  // Existing inbox for this project?
  const existing = await admin
    .from('sched_batches')
    .select('id, title, created_at')
    .eq('project_id', projectId)
    .eq('is_inbox', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!existing.error && existing.data) {
    return NextResponse.json(
      { batch: existing.data },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // None yet — create it, titled after the project so the calendar heading
  // reads sensibly.
  const wide = await admin
    .from('sched_batches')
    .insert({
      owner_user_id: user!.id,
      title: project.title,
      project_id: projectId,
      is_inbox: true,
    })
    .select('id, title, created_at')
    .single();

  let data = wide.data;
  if (wide.error) {
    // is_inbox / project_id column may be missing on a preview DB — fall back.
    const narrow = await admin
      .from('sched_batches')
      .insert({ owner_user_id: user!.id, title: project.title })
      .select('id, title, created_at')
      .single();
    if (narrow.error) {
      return NextResponse.json({ error: 'create_failed' }, { status: 500 });
    }
    data = narrow.data;
  }

  return NextResponse.json(
    { batch: data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

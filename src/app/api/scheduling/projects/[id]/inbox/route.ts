import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSchedulingAccess, ownerAllowed } from '@/lib/scheduling/access';

// Resolve (create if missing) a project's inbox batch — the flat pool uploads
// land in (PR-C follow-up). Open to super-admin OR org member; non-members 404.
// Org members may only touch a project whose owner shares an org with them.
//
// is_inbox may be absent on a preview DB without the additive migration — the
// insert-with-is_inbox then errors and we retry without it (wide/narrow).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;

  const access = await getSchedulingAccess();
  if (!access) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const admin = createAdminClient();

  const { data: project } = await admin
    .from('sched_projects')
    .select('id, title, owner_user_id')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) {
    return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
  }
  if (!ownerAllowed(access, (project as { owner_user_id?: string }).owner_user_id)) {
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
      owner_user_id: access.userId,
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
      .insert({ owner_user_id: access.userId, title: project.title })
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

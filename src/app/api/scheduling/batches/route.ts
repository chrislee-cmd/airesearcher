import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getSchedulingAccess,
  ownerOfProject,
  ownerAllowed,
} from '@/lib/scheduling/access';

// Create a scheduling batch (=group). Open to super-admin OR org member;
// non-members get 404 (route stays unobservable). The batch is owned by the
// caller, and when scoped under a project the caller must be allowed to touch
// that project's owner (tenancy scoping).
//
// A batch may be scoped under a project (PR-C) via optional `projectId`. When
// the project_id column isn't present yet (preview DB, additive migration not
// auto-applied) the insert-with-project errors, so we retry without it —
// wide/narrow degrade keeps group creation working on preview.
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
  const obj = (body ?? {}) as { title?: unknown; projectId?: unknown };
  const title = typeof obj.title === 'string' ? obj.title.trim() : '';
  if (!title) {
    return NextResponse.json({ error: 'title_required' }, { status: 400 });
  }
  const projectId =
    typeof obj.projectId === 'string' && obj.projectId ? obj.projectId : null;

  const admin = createAdminClient();

  // Tenancy scoping — a batch under a project must belong to an owner the
  // caller may touch (super-admin bypasses).
  if (projectId) {
    const owner = await ownerOfProject(admin, projectId);
    if (!ownerAllowed(access, owner)) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
  }

  const wide = await admin
    .from('sched_batches')
    .insert(
      projectId
        ? { owner_user_id: access.userId, title, project_id: projectId }
        : { owner_user_id: access.userId, title },
    )
    .select('id, title, created_at')
    .single();

  let data = wide.data;
  if (wide.error) {
    // project_id column may not exist on a preview DB yet — fall back to a
    // project-less insert so the group still gets created.
    if (projectId) {
      const narrow = await admin
        .from('sched_batches')
        .insert({ owner_user_id: access.userId, title })
        .select('id, title, created_at')
        .single();
      if (narrow.error) {
        return NextResponse.json({ error: 'create_failed' }, { status: 500 });
      }
      data = narrow.data;
    } else {
      return NextResponse.json({ error: 'create_failed' }, { status: 500 });
    }
  }
  return NextResponse.json(
    { batch: data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

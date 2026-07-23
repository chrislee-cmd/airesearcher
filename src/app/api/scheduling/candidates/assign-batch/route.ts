import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getSchedulingAccess,
  accessibleCandidateIds,
  ownerOfProject,
  ownerOfBatch,
  ownerAllowed,
} from '@/lib/scheduling/access';

export const runtime = 'nodejs';

// Move checked candidates into a scheduling batch/group (super-admin only) —
// the "그룹(배치)으로 보내기" bulk action. Target is either an existing batch
// (batchId) or a freshly-created one (newBatchTitle). That batch is what PR-B's
// unified calendar + share-link view is scoped to.
//
// Move = reassign batch_id. The (batch_id,email) partial unique index means an
// emailed candidate can collide with an identically-emailed row already in the
// target; we surface that as `duplicate_in_target` rather than a raw 500. A new
// batch can never collide.
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
  const obj = (body ?? {}) as {
    candidateIds?: unknown;
    batchId?: unknown;
    newBatchTitle?: unknown;
    projectId?: unknown;
  };
  const candidateIds = Array.isArray(obj.candidateIds)
    ? obj.candidateIds.filter((v): v is string => typeof v === 'string')
    : [];
  if (candidateIds.length === 0) {
    return NextResponse.json({ error: 'no_candidates' }, { status: 400 });
  }
  const existingBatchId =
    typeof obj.batchId === 'string' && obj.batchId ? obj.batchId : null;
  const newBatchTitle =
    typeof obj.newBatchTitle === 'string' ? obj.newBatchTitle.trim() : '';
  // Keep a freshly-created target group inside the current project (PR-C).
  const projectId =
    typeof obj.projectId === 'string' && obj.projectId ? obj.projectId : null;

  const admin = createAdminClient();

  // Tenancy scoping — the moved candidates and the destination must all belong
  // to owners the caller may touch (super-admin bypasses).
  const allowedIds = await accessibleCandidateIds(admin, access, candidateIds);
  if (allowedIds.length === 0) {
    return NextResponse.json({ error: 'no_candidates' }, { status: 400 });
  }

  // Resolve the destination batch: create when a title is given, else validate
  // the supplied existing id.
  let targetBatchId: string;
  if (newBatchTitle) {
    if (projectId) {
      const owner = await ownerOfProject(admin, projectId);
      if (!ownerAllowed(access, owner)) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
    }
    // project_id may be absent on a preview DB — retry without it (wide/narrow).
    const wide = await admin
      .from('sched_batches')
      .insert(
        projectId
          ? { owner_user_id: access.userId, title: newBatchTitle, project_id: projectId }
          : { owner_user_id: access.userId, title: newBatchTitle },
      )
      .select('id')
      .single();
    let created = wide.data;
    if (wide.error) {
      if (projectId) {
        const narrow = await admin
          .from('sched_batches')
          .insert({ owner_user_id: access.userId, title: newBatchTitle })
          .select('id')
          .single();
        if (narrow.error || !narrow.data) {
          return NextResponse.json({ error: 'create_failed' }, { status: 500 });
        }
        created = narrow.data;
      } else {
        return NextResponse.json({ error: 'create_failed' }, { status: 500 });
      }
    }
    if (!created) {
      return NextResponse.json({ error: 'create_failed' }, { status: 500 });
    }
    targetBatchId = created.id;
  } else if (existingBatchId) {
    const { data: batch } = await admin
      .from('sched_batches')
      .select('id')
      .eq('id', existingBatchId)
      .maybeSingle();
    if (!batch) {
      return NextResponse.json({ error: 'batch_not_found' }, { status: 404 });
    }
    if (!access.superadmin) {
      const owner = await ownerOfBatch(admin, existingBatchId);
      if (!ownerAllowed(access, owner)) {
        return NextResponse.json({ error: 'batch_not_found' }, { status: 404 });
      }
    }
    targetBatchId = batch.id;
  } else {
    return NextResponse.json({ error: 'no_target' }, { status: 400 });
  }

  const { data, error } = await admin
    .from('sched_candidates')
    .update({ batch_id: targetBatchId })
    .in('id', allowedIds)
    .select('id');
  if (error) {
    // 23505 = unique_violation (an emailed candidate already in the target).
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json(
        { error: 'duplicate_in_target' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  return NextResponse.json(
    { moved: data?.length ?? 0, batchId: targetBatchId },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

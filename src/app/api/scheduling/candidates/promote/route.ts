import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSchedulingAccess, ownerAllowed } from '@/lib/scheduling/access';

export const runtime = 'nodejs';

// POST /api/scheduling/candidates/promote (card 588)
// Promote selected intake rows to the ②일정 roster: flip stage 'intake' →
// 'roster' (and optionally re-home into a target batch). This is the CSV/Sheets
// analogue of the form-response bridge — uploads land in ①응답 as intake and
// only cross into ②일정 through this explicit selection step.
//
// authz reuses the scheduling tenancy wall (getSchedulingAccess + ownerAllowed
// on each candidate's owning batch) — same guard the upload/import-sheet routes
// use. No new authz is invented.
//
// body: { candidate_ids: string[], target_batch_id?: string }
//   - target_batch_id omitted → keep each row in its current batch (the project
//     inbox, where uploads land) and only flip stage. No (batch_id,email) unique
//     conflict is possible on this path (the row is already there).
//   - target_batch_id set → move the rows into that batch. If it already holds a
//     roster row with the same email, the partial unique index
//     `(batch_id,email) where email is not null` would 500 the UPDATE — so we
//     MERGE into the existing row (union fields, fill empty name/phone/email)
//     and delete the intake row instead. Match priority email > phone > name
//     mirrors upsertCandidatesIntoBatch.
//
// response: { promoted: number, merged: number }

const phoneDigits = (p: string): string => p.replace(/\D/g, '');

type CandRow = {
  id: string;
  batch_id: string | null;
  email: string | null;
  name: string | null;
  phone: string | null;
  fields: Record<string, string> | null;
};

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
  const candidateIds =
    body && typeof body === 'object' && Array.isArray((body as { candidate_ids?: unknown }).candidate_ids)
      ? ((body as { candidate_ids: unknown[] }).candidate_ids.filter(
          (v): v is string => typeof v === 'string' && v.length > 0,
        ))
      : [];
  const targetBatchId =
    body && typeof body === 'object' && typeof (body as { target_batch_id?: unknown }).target_batch_id === 'string'
      ? (body as { target_batch_id: string }).target_batch_id
      : null;
  if (candidateIds.length === 0) {
    return NextResponse.json({ error: 'no_candidates' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Load the candidates to promote.
  const { data: candData, error: candErr } = await admin
    .from('sched_candidates')
    .select('id, batch_id, email, name, phone, fields')
    .in('id', candidateIds);
  if (candErr) {
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
  const cands = (candData ?? []) as CandRow[];
  if (cands.length === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Tenancy: resolve each source batch's owner (+ the target batch if given) and
  // drop any candidate whose batch the caller may not touch. Same ownerAllowed
  // wall the upload route enforces.
  const sourceBatchIds = [
    ...new Set(cands.map((c) => c.batch_id).filter((v): v is string => !!v)),
  ];
  const batchIdsToCheck = [
    ...new Set([...sourceBatchIds, ...(targetBatchId ? [targetBatchId] : [])]),
  ];
  const { data: batchData } = await admin
    .from('sched_batches')
    .select('id, owner_user_id, project_id')
    .in('id', batchIdsToCheck);
  const batchById = new Map(
    ((batchData ?? []) as { id: string; owner_user_id: string | null; project_id: string | null }[]).map(
      (b) => [b.id, b],
    ),
  );

  // Target batch validation (when a move is requested).
  if (targetBatchId) {
    const target = batchById.get(targetBatchId);
    if (!target || !ownerAllowed(access, target.owner_user_id)) {
      return NextResponse.json({ error: 'target_not_allowed' }, { status: 404 });
    }
  }

  const allowed = cands.filter((c) => {
    const b = c.batch_id ? batchById.get(c.batch_id) : null;
    return b ? ownerAllowed(access, b.owner_user_id) : false;
  });
  if (allowed.length === 0) {
    return NextResponse.json({ error: 'not_allowed' }, { status: 404 });
  }

  // For the move-into-a-different-batch path, preload the target batch's rows so
  // we can detect an email/phone/name collision and merge instead of colliding.
  let targetRows: CandRow[] = [];
  if (targetBatchId) {
    const { data: tRows } = await admin
      .from('sched_candidates')
      .select('id, batch_id, email, name, phone, fields')
      .eq('batch_id', targetBatchId);
    targetRows = (tRows ?? []) as CandRow[];
  }
  const byEmail = new Map<string, CandRow>();
  const byPhone = new Map<string, CandRow>();
  const byName = new Map<string, CandRow>();
  for (const r of targetRows) {
    if (r.email) byEmail.set(r.email.trim().toLowerCase(), r);
    if (r.phone) {
      const d = phoneDigits(r.phone);
      if (d) byPhone.set(d, r);
    }
    if (r.name) byName.set(r.name.trim().toLowerCase(), r);
  }
  function matchTarget(c: CandRow): CandRow | null {
    if (c.email) {
      const hit = byEmail.get(c.email.trim().toLowerCase());
      if (hit) return hit;
    }
    if (c.phone) {
      const d = phoneDigits(c.phone);
      if (d) {
        const hit = byPhone.get(d);
        if (hit) return hit;
      }
    }
    if (c.name) {
      const hit = byName.get(c.name.trim().toLowerCase());
      if (hit) return hit;
    }
    return null;
  }

  let promoted = 0;
  let merged = 0;
  for (const c of allowed) {
    const moving = targetBatchId != null && targetBatchId !== c.batch_id;
    if (!moving) {
      // Same batch → just flip stage. No unique conflict is possible.
      const { error } = await admin
        .from('sched_candidates')
        .update({ stage: 'roster' })
        .eq('id', c.id);
      if (!error) promoted += 1;
      continue;
    }

    const existing = matchTarget(c);
    if (existing && existing.id !== c.id) {
      // Merge into the existing roster row (avoids the (batch_id,email) unique
      // violation): union fields, fill only empty scalars, then remove intake row.
      const mergedFields = { ...(existing.fields ?? {}), ...(c.fields ?? {}) };
      const { error: upErr } = await admin
        .from('sched_candidates')
        .update({
          fields: mergedFields,
          email: existing.email ?? c.email,
          name: existing.name ?? c.name,
          phone: existing.phone ?? c.phone,
          stage: 'roster',
        })
        .eq('id', existing.id);
      if (!upErr) {
        await admin.from('sched_candidates').delete().eq('id', c.id);
        merged += 1;
      }
    } else {
      const { error } = await admin
        .from('sched_candidates')
        .update({ batch_id: targetBatchId, stage: 'roster' })
        .eq('id', c.id);
      if (!error) promoted += 1;
    }
  }

  return NextResponse.json(
    { promoted, merged },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

import type { SupabaseClient } from '@supabase/supabase-js';

// Project 1:1 lazy provisioning (decision D5, generalized for form-free intake,
// card 583). The fused recruiting journey is anchored on EITHER a Google form
// (form_id) OR the recruiting pill project (interview_project_id) — a user who
// already has a participant list from another channel can intake it with no form
// published. Opening the journey (or its intake band / 일정 tab) resolve-or-creates
// exactly one sched_projects row, and the bridge approval hook uses the same
// helper so a first-ever bridge still lands.
//
// CONVERGENCE (the whole point of two anchors): the form path and the pill path
// must land on the SAME sched_projects row so the roster never splits. Resolve
// order is form_id → interview_project_id → create; when we find a row via one
// anchor and the OTHER anchor is provided but still null on the row, we stamp it.
// So: intake form-free (pill-anchored, projX) → later publish a form A + open →
// form_id=A misses (projX has no form_id) → interview_project_id fallback finds
// projX → stamp form_id=A → CONVERGES on projX (roster preserved).
//
// Why form_id FIRST when present (a considered deviation from a literal
// "interview_project_id → form_id" reading): a pill project can feed MULTIPLE
// forms, each of which may already have its own form-anchored project + roster.
// Resolving interview_project_id-first would route every form under that pill to
// whichever project grabbed the pill's unique anchor first, hiding the others'
// existing rosters — a regression the spec forbids ("기존 유저 로스터가 그대로 …
// 회귀 0"). form_id-first keeps each existing form on its own project exactly as
// before; the pill anchor is used only to (a) resolve the truly form-free path and
// (b) stamp for convergence, never to override an existing form anchor.
//
// Race-safe: unique partial indexes on both form_id and interview_project_id mean
// a concurrent create loses with a 23505, on which we re-select the winner.
//
// Preview-DB degrade: form_id / interview_project_id / org_id are additive
// columns. On a DB that hasn't had the migration applied, the wide select/insert
// errors and we fall back to a deterministic (owner, title) create so repeated
// resolves still converge (the anchor links just don't persist there).

export type JourneyProject = {
  id: string;
  title: string;
  form_id: string | null;
  interview_project_id: string | null;
  share_token?: string | null;
  created_at: string;
};

type ResolveArgs = {
  // At least one anchor should be present. Both optional so form-anchored callers
  // (bridge/slots/resolve) pass only formId and the form-free intake path passes
  // only interviewProjectId; a form-anchored surface that also knows its pill
  // project passes both so the two axes converge (stamp).
  formId?: string | null;
  interviewProjectId?: string | null;
  ownerUserId: string;
  title: string;
  orgId: string | null;
};

// RETURNING cols kept to the pre-583 set (no interview_project_id) so inserts /
// stamps never fail on a preview DB missing that column — we reconstruct the
// interview_project_id field from what we know we wrote. Reads use selectByForm /
// selectByInterviewProject which degrade the extra column on their own.
const RETURN_COLS = 'id, title, form_id, share_token, created_at';

export async function resolveOrCreateProjectForForm(
  admin: SupabaseClient,
  args: ResolveArgs,
): Promise<{ project: JourneyProject } | { error: string }> {
  const { ownerUserId, title, orgId } = args;
  const formId = args.formId || null;
  const interviewProjectId = args.interviewProjectId || null;

  // Neither anchor (shouldn't happen — routes 400 first) → deterministic
  // (owner, title) fallback so we never mint a fresh row per call.
  if (!formId && !interviewProjectId) {
    const anchored = await selectByOwnerTitle(admin, ownerUserId, title);
    if (anchored) return { project: anchored };
    return createNarrow(admin, ownerUserId, title);
  }

  // 1) form_id anchor (specific — an existing form keeps its own project exactly
  //    as before → regression 0). Stamp the pill axis when provided + still null.
  if (formId) {
    const byForm = await selectByForm(admin, formId);
    if (byForm.project) {
      const project = await stampMissingAnchors(admin, byForm.project, {
        formId,
        interviewProjectId,
      });
      return { project };
    }
    // form_id column absent (pre-ship DB) → deterministic (owner, title) anchor
    // so repeated resolves converge on one row rather than a fresh create each
    // call (round-2 feedback #2b). Only fires when the column is truly missing.
    if (byForm.degraded) {
      const anchored = await selectByOwnerTitle(admin, ownerUserId, title);
      if (anchored) return { project: anchored };
      return createNarrow(admin, ownerUserId, title);
    }
    // present column, no match → fall through: a form-free project (pill-anchored)
    // may already exist for this pill; the interview_project_id lookup below finds
    // and CONVERGES on it (stamping form_id) rather than minting a second project.
  }

  // 2) interview_project_id anchor. Resolves the truly form-free path AND catches
  //    the "form-free project, now getting its first form" convergence case above.
  if (interviewProjectId) {
    const byIP = await selectByInterviewProject(admin, interviewProjectId);
    if (byIP.project) {
      const project = await stampMissingAnchors(admin, byIP.project, {
        formId,
        interviewProjectId,
      });
      return { project };
    }
    // byIP.degraded (column absent) with no formId → deterministic degrade.
    if (byIP.degraded && !formId) {
      const anchored = await selectByOwnerTitle(admin, ownerUserId, title);
      if (anchored) return { project: anchored };
      return createNarrow(admin, ownerUserId, title);
    }
  }

  // 3) Create it, filling whichever anchors we have. Title is seeded on FIRST
  //    create only — never overwritten later so a user-renamed project stands.
  return createProject(admin, {
    formId,
    interviewProjectId,
    ownerUserId,
    title,
    orgId,
  });
}

async function createProject(
  admin: SupabaseClient,
  {
    formId,
    interviewProjectId,
    ownerUserId,
    title,
    orgId,
  }: {
    formId: string | null;
    interviewProjectId: string | null;
    ownerUserId: string;
    title: string;
    orgId: string | null;
  },
): Promise<{ project: JourneyProject } | { error: string }> {
  const insert: Record<string, unknown> = {
    owner_user_id: ownerUserId,
    title: title || 'Untitled',
    org_id: orgId,
  };
  if (formId) insert.form_id = formId;
  if (interviewProjectId) insert.interview_project_id = interviewProjectId;

  const wide = await admin
    .from('sched_projects')
    .insert(insert)
    .select(RETURN_COLS)
    .single();
  if (!wide.error && wide.data) {
    return {
      project: {
        ...(wide.data as Omit<JourneyProject, 'interview_project_id'>),
        interview_project_id: interviewProjectId,
      },
    };
  }

  // 3a) Lost a create race → the winner exists now; re-select by whichever anchor
  //     is unique (form_id first to match resolve priority).
  if (wide.error?.code === '23505') {
    if (formId) {
      const winner = await selectByForm(admin, formId);
      if (winner.project) return { project: winner.project };
    }
    if (interviewProjectId) {
      const winner = await selectByInterviewProject(admin, interviewProjectId);
      if (winner.project) return { project: winner.project };
    }
    return { error: 'provision_failed' };
  }

  // 3b) form_id / interview_project_id / org_id column missing on this DB (42703 /
  //     PGRST204) — degrade to a deterministic (owner, title) project so the
  //     surface still works (anchor links just don't persist on this preview). We
  //     re-check the (owner, title) anchor first so a schema race never spawns a
  //     duplicate. Any OTHER error is a real failure.
  const code = wide.error?.code;
  const msg = wide.error?.message ?? '';
  const isMissingColumn =
    code === '42703' ||
    (code === 'PGRST204' &&
      /(form_id|org_id|interview_project_id)/.test(msg));
  if (!isMissingColumn) {
    return { error: 'provision_failed' };
  }
  const anchored = await selectByOwnerTitle(admin, ownerUserId, title);
  if (anchored) return { project: anchored };
  return createNarrow(admin, ownerUserId, title);
}

// Convergence glue: when a project was found via one anchor but the other anchor
// is provided yet still null on the row, stamp it so both axes point here.
// Best-effort — a unique violation (the other anchor already claimed by a
// DIFFERENT project = a pre-existing split we don't auto-merge) or a missing
// column on a preview DB just returns the row unstamped. The `.is(null)` guards
// avoid clobbering a value a concurrent request stamped between our read and here.
async function stampMissingAnchors(
  admin: SupabaseClient,
  project: JourneyProject,
  { formId, interviewProjectId }: { formId: string | null; interviewProjectId: string | null },
): Promise<JourneyProject> {
  const patch: Record<string, string> = {};
  if (formId && !project.form_id) patch.form_id = formId;
  if (interviewProjectId && !project.interview_project_id) {
    patch.interview_project_id = interviewProjectId;
  }
  if (Object.keys(patch).length === 0) return project;

  let q = admin.from('sched_projects').update(patch).eq('id', project.id);
  if ('form_id' in patch) q = q.is('form_id', null);
  if ('interview_project_id' in patch) q = q.is('interview_project_id', null);
  const res = await q.select(RETURN_COLS).single();
  if (res.error || !res.data) return project;
  return {
    ...(res.data as Omit<JourneyProject, 'interview_project_id'>),
    interview_project_id:
      patch.interview_project_id ?? project.interview_project_id ?? null,
  };
}

// Title-only create for the degraded (no form_id column) path. The link simply
// doesn't persist on a preview DB; the (owner, title) anchor above keeps repeat
// resolves deterministic even across the create race.
async function createNarrow(
  admin: SupabaseClient,
  ownerUserId: string,
  title: string,
): Promise<{ project: JourneyProject } | { error: string }> {
  const narrow = await admin
    .from('sched_projects')
    .insert({ owner_user_id: ownerUserId, title: title || 'Untitled' })
    .select('id, title, share_token, created_at')
    .single();
  if (narrow.error || !narrow.data) {
    return { error: 'provision_failed' };
  }
  return {
    project: {
      ...(narrow.data as Omit<JourneyProject, 'form_id' | 'interview_project_id'>),
      form_id: null,
      interview_project_id: null,
    },
  };
}

// Returns { project, degraded }: `degraded` is true only when the form_id column
// is genuinely absent (missing-column error), which is the signal to fall back
// to the (owner, title) anchor rather than a fresh create. A present column with
// no matching row → { project: null, degraded: false } (healthy DB, create wide).
//
// interview_project_id (583) is read via a tolerant wide→narrow retry: on a DB
// that has form_id but not yet interview_project_id, the wide select errors and
// we retry without it (interview_project_id → null) so form-anchored resolves are
// never wrongly flagged degraded by the newer column.
async function selectByForm(
  admin: SupabaseClient,
  formId: string,
): Promise<{ project: JourneyProject | null; degraded: boolean }> {
  const wide = await admin
    .from('sched_projects')
    .select('id, title, form_id, interview_project_id, share_token, created_at')
    .eq('form_id', formId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!wide.error) {
    return { project: (wide.data as JourneyProject | null) ?? null, degraded: false };
  }
  // interview_project_id column may be absent — retry narrow to isolate whether
  // form_id itself is the missing (degrade) column.
  const res = await admin
    .from('sched_projects')
    .select('id, title, form_id, share_token, created_at')
    .eq('form_id', formId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (res.error) {
    const code = res.error.code;
    const degraded =
      code === '42703' ||
      (code === 'PGRST204' && /form_id/.test(res.error.message ?? ''));
    return { project: null, degraded };
  }
  const row = res.data as Omit<JourneyProject, 'interview_project_id'> | null;
  return {
    project: row ? { ...row, interview_project_id: null } : null,
    degraded: false,
  };
}

// interview_project_id anchor read (583). `degraded` true only when the column is
// genuinely absent → the caller falls through to the form_id / (owner, title)
// path rather than treating it as "no project yet".
async function selectByInterviewProject(
  admin: SupabaseClient,
  interviewProjectId: string,
): Promise<{ project: JourneyProject | null; degraded: boolean }> {
  const res = await admin
    .from('sched_projects')
    .select('id, title, form_id, interview_project_id, share_token, created_at')
    .eq('interview_project_id', interviewProjectId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (res.error) {
    const code = res.error.code;
    const degraded =
      code === '42703' ||
      (code === 'PGRST204' &&
        /interview_project_id/.test(res.error.message ?? ''));
    return { project: null, degraded };
  }
  return { project: (res.data as JourneyProject | null) ?? null, degraded: false };
}

// Deterministic degrade anchor: the earliest project owned by this user with a
// matching title. On a DB without the anchor columns this is the stable identity
// a form/pill resolves to across calls (title = form/project title, stable).
// `order asc` makes even a duplicated race converge on one winner.
async function selectByOwnerTitle(
  admin: SupabaseClient,
  ownerUserId: string,
  title: string,
): Promise<JourneyProject | null> {
  const res = await admin
    .from('sched_projects')
    .select('id, title, share_token, created_at')
    .eq('owner_user_id', ownerUserId)
    .eq('title', title || 'Untitled')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (res.error || !res.data) return null;
  return {
    ...(res.data as Omit<JourneyProject, 'form_id' | 'interview_project_id'>),
    form_id: null,
    interview_project_id: null,
  };
}

// Resolve (create if missing) a project's inbox batch — the flat pool bridged /
// uploaded candidates land in when no explicit group is chosen. Mirrors the
// inbox route's wide/narrow degrade for the additive is_inbox / project_id /
// org_id columns.
export async function resolveInboxBatch(
  admin: SupabaseClient,
  project: { id: string; title: string; org_id?: string | null },
  ownerUserId: string,
): Promise<{ batchId: string } | { error: string }> {
  const existing = await admin
    .from('sched_batches')
    .select('id')
    .eq('project_id', project.id)
    .eq('is_inbox', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!existing.error && existing.data) {
    return { batchId: (existing.data as { id: string }).id };
  }

  // DEGRADE (is_inbox column absent): there's no distinct inbox flag on a
  // pre-ship DB, so reuse the project's FIRST batch as the pool. Without this the
  // old code created a NEW empty batch on every resolve, so an upload's target
  // batch drifted between calls — same class of bug as the project drift above.
  if (existing.error) {
    // Partial narrow (is_inbox missing but project_id present): the first batch
    // under this project is the pool.
    const first = await admin
      .from('sched_batches')
      .select('id')
      .eq('project_id', project.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!first.error && first.data) {
      return { batchId: (first.data as { id: string }).id };
    }
    // Full narrow (project_id ALSO missing → the query above errors): fall back
    // to the same deterministic (owner_user_id, title) anchor the project resolve
    // uses. Without this the narrow insert below ran on every call and minted a
    // fresh batch, so an upload's target still drifted between calls even after
    // R2 fixed the project drift — the residual half of journey R3 #2 ("upload
    // still fails / lands nowhere"). title = project.title (= form title), stable
    // per form, so repeat resolves converge on one batch.
    const anchored = await selectBatchByOwnerTitle(admin, ownerUserId, project.title);
    if (anchored) return { batchId: anchored };
  }

  const wide = await admin
    .from('sched_batches')
    .insert({
      owner_user_id: ownerUserId,
      title: project.title,
      project_id: project.id,
      is_inbox: true,
      org_id: project.org_id ?? null,
    })
    .select('id')
    .single();
  if (!wide.error && wide.data) {
    return { batchId: (wide.data as { id: string }).id };
  }

  const narrow = await admin
    .from('sched_batches')
    .insert({ owner_user_id: ownerUserId, title: project.title })
    .select('id')
    .single();
  if (narrow.error || !narrow.data) return { error: 'inbox_failed' };
  return { batchId: (narrow.data as { id: string }).id };
}

// Deterministic degrade anchor for the inbox batch on a DB missing project_id /
// is_inbox: the earliest batch owned by this user with the project's title. This
// is the batch-level twin of selectByOwnerTitle above — it keeps repeated inbox
// resolves converging on one row so an upload target never drifts on a pre-ship
// preview.
async function selectBatchByOwnerTitle(
  admin: SupabaseClient,
  ownerUserId: string,
  title: string,
): Promise<string | null> {
  const res = await admin
    .from('sched_batches')
    .select('id')
    .eq('owner_user_id', ownerUserId)
    .eq('title', title || 'Untitled')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (res.error || !res.data) return null;
  return (res.data as { id: string }).id;
}

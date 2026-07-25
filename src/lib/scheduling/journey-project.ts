import type { SupabaseClient } from '@supabase/supabase-js';

// Form↔project 1:1 lazy provisioning (decision D5). The recruiting fullview is
// form-anchored: opening it (or its 명단 tab) resolve-or-creates exactly one
// sched_projects row for the form, and the bridge approval hook uses the same
// helper so a first-ever bridge into a form with no project still lands.
//
// Race-safe: a unique partial index on sched_projects(form_id) means a
// concurrent create loses with a 23505, on which we simply re-select the winner.
//
// Preview-DB degrade: form_id / org_id are additive columns. On a DB that hasn't
// had the migration applied, the wide select/insert errors and we fall back to a
// title-only create (the form link + org anchor simply don't persist there).

export type JourneyProject = {
  id: string;
  title: string;
  form_id: string | null;
  share_token?: string | null;
  created_at: string;
};

type ResolveArgs = {
  formId: string;
  ownerUserId: string;
  title: string;
  orgId: string | null;
};

export async function resolveOrCreateProjectForForm(
  admin: SupabaseClient,
  { formId, ownerUserId, title, orgId }: ResolveArgs,
): Promise<{ project: JourneyProject } | { error: string }> {
  // 1) Existing project for this form?
  const existing = await selectByForm(admin, formId);
  if (existing.project) return { project: existing.project };

  // 1b) DETERMINISTIC DEGRADE (pre-ship shared DB). When the form_id column is
  //     absent, selectByForm can never match a project → the old code created a
  //     FRESH title-only project on every call, so an upload landed in project A
  //     while the very next read created project B and returned 0 candidates
  //     ("uploaded but list shows 0" — round-2 feedback #2b). Anchor by
  //     (owner_user_id, title) instead so repeated resolves converge on the same
  //     row (form title is stable per form). Only runs when the column is truly
  //     missing — on a healthy DB step 1 already returns the form-linked project,
  //     so a same-titled project from a DIFFERENT form is never falsely matched.
  if (existing.degraded) {
    const anchored = await selectByOwnerTitle(admin, ownerUserId, title);
    if (anchored) return { project: anchored };
    return createNarrow(admin, ownerUserId, title);
  }

  // 2) Create it. Title is seeded from the form title on FIRST create only — we
  //    never overwrite it later so a user-renamed project isn't clobbered.
  const wide = await admin
    .from('sched_projects')
    .insert({
      owner_user_id: ownerUserId,
      title: title || 'Untitled',
      form_id: formId,
      org_id: orgId,
    })
    .select('id, title, form_id, share_token, created_at')
    .single();
  if (!wide.error && wide.data) {
    return { project: wide.data as JourneyProject };
  }

  // 3a) Lost a create race → the winner exists now; re-select it.
  if (wide.error?.code === '23505') {
    const winner = await selectByForm(admin, formId);
    if (winner.project) return { project: winner.project };
    return { error: 'provision_failed' };
  }

  // 3b) form_id / org_id column missing on this DB (42703 / PGRST204) — degrade
  //     to a title-only project so the surface still works (link just doesn't
  //     persist on this preview). But first re-check the deterministic
  //     (owner, title) anchor: the wide insert can fail with a missing-column
  //     error even after step 1 said the column existed (schema races), and we
  //     must never spawn a duplicate. Any OTHER error is a real failure.
  const code = wide.error?.code;
  const msg = wide.error?.message ?? '';
  const isMissingColumn =
    code === '42703' ||
    (code === 'PGRST204' && /(form_id|org_id)/.test(msg));
  if (!isMissingColumn) {
    return { error: 'provision_failed' };
  }
  const anchored = await selectByOwnerTitle(admin, ownerUserId, title);
  if (anchored) return { project: anchored };
  return createNarrow(admin, ownerUserId, title);
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
  return { project: { ...(narrow.data as Omit<JourneyProject, 'form_id'>), form_id: null } };
}

// Returns { project, degraded }: `degraded` is true only when the form_id column
// is genuinely absent (missing-column error), which is the signal to fall back
// to the (owner, title) anchor rather than a fresh create. A present column with
// no matching row → { project: null, degraded: false } (healthy DB, create wide).
async function selectByForm(
  admin: SupabaseClient,
  formId: string,
): Promise<{ project: JourneyProject | null; degraded: boolean }> {
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
  return { project: (res.data as JourneyProject | null) ?? null, degraded: false };
}

// Deterministic degrade anchor: the earliest project owned by this user with a
// matching title. On a DB without form_id this is the stable identity a form
// resolves to across calls (title = form title, stable per form). `order asc`
// makes even a duplicated race converge on one winner.
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
  return { ...(res.data as Omit<JourneyProject, 'form_id'>), form_id: null };
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

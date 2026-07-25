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
  if (existing) return { project: existing };

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
    if (winner) return { project: winner };
    return { error: 'provision_failed' };
  }

  // 3b) form_id / org_id column missing on this DB (42703 / PGRST204) — degrade
  //     to a title-only project so the surface still works (link just doesn't
  //     persist on this preview). Any OTHER error is a real failure — never
  //     silently create an unlinked duplicate.
  const code = wide.error?.code;
  const msg = wide.error?.message ?? '';
  const isMissingColumn =
    code === '42703' ||
    (code === 'PGRST204' && /(form_id|org_id)/.test(msg));
  if (!isMissingColumn) {
    return { error: 'provision_failed' };
  }
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

async function selectByForm(
  admin: SupabaseClient,
  formId: string,
): Promise<JourneyProject | null> {
  const res = await admin
    .from('sched_projects')
    .select('id, title, form_id, share_token, created_at')
    .eq('form_id', formId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  // form_id column absent (preview) → treat as "no linked project".
  if (res.error) return null;
  return (res.data as JourneyProject | null) ?? null;
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

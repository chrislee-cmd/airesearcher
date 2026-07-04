import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/supabase/user';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import {
  InvitationsList,
  type InvitationRow,
} from '@/components/admin/invitations-list';

// Super-admin-only viewer for the "request an invitation" flow. Non-admins get
// notFound() so the route isn't observable to other accounts — the canonical
// /admin/* gate here is getCurrentUser + isSuperAdminEmail + notFound (the spec
// suggested redirect('/'), but notFound matches qa-feedback / payments / etc.).
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!isSuperAdminEmail(user?.email)) notFound();

  // The invitations_super_admin_all RLS policy lets chris.lee@ read every row.
  const supabase = await createClient();
  const { data: invitations } = await supabase
    .from('recruiting_invitations')
    .select(
      'id, requester_user_id, project_id, form_id, response_ids, status, admin_note, created_at, processed_at',
    )
    .order('created_at', { ascending: false })
    .limit(500);

  const rows = invitations ?? [];
  const userIds = [...new Set(rows.map((r) => r.requester_user_id))];
  const formIds = [...new Set(rows.map((r) => r.form_id))];

  // Enrich with .in() batches on the service-role client rather than a
  // PostgREST embed. recruiting_invitations has no direct FK to profiles /
  // recruiting_forms, and a transitive-FK embed silently returns 0 rows
  // (PROJECT.md §7.10). The admin client also bypasses RLS so profiles/forms
  // owned by other users actually resolve.
  const admin = createAdminClient();
  const [profilesRes, formsRes] = await Promise.all([
    userIds.length
      ? admin.from('profiles').select('id, email, full_name').in('id', userIds)
      : Promise.resolve({
          data: [] as { id: string; email: string | null; full_name: string | null }[],
        }),
    formIds.length
      ? admin.from('recruiting_forms').select('form_id, title').in('form_id', formIds)
      : Promise.resolve({ data: [] as { form_id: string; title: string }[] }),
  ]);
  const profileMap = new Map((profilesRes.data ?? []).map((p) => [p.id, p]));
  const formTitleMap = new Map(
    (formsRes.data ?? []).map((f) => [f.form_id, f.title]),
  );

  // auth.users is the source of truth for email — accounts whose profiles row
  // is missing (pre-trigger / failed insert) would otherwise render as
  // "(unknown)". profiles is only a name fallback (qa-feedback pattern).
  const identities = new Map<string, { email: string; name: string | null }>();
  await Promise.all(
    userIds.map(async (uid) => {
      const prof = profileMap.get(uid);
      const { data: authData } = await admin.auth.admin.getUserById(uid);
      const authUser = authData?.user;
      const metaName =
        typeof authUser?.user_metadata?.full_name === 'string'
          ? authUser.user_metadata.full_name
          : null;
      identities.set(uid, {
        email: authUser?.email ?? prof?.email ?? '(unknown)',
        name: prof?.full_name ?? metaName,
      });
    }),
  );

  const enriched: InvitationRow[] = rows.map((r) => ({
    ...r,
    requester_email: identities.get(r.requester_user_id)?.email ?? '(unknown)',
    requester_name: identities.get(r.requester_user_id)?.name ?? null,
    form_title: formTitleMap.get(r.form_id) ?? '(unknown form)',
  }));

  return <InvitationsList invitations={enriched} />;
}

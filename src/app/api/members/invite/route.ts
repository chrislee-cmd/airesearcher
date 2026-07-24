import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendOrgInviteEmail } from '@/lib/org/invite-email';

const Body = z.object({
  org_id: z.string().uuid(),
  email: z.string().email(),
  // 'viewer' stays in the schema for the legacy members page, but the
  // collaborator-share UI only ever sends 'member' (full access) — no viewer
  // tier is enforced yet, so exposing it would mislead (readonly assumed, full
  // access granted). See pr-recsched-collab-access.
  role: z.enum(['admin', 'member', 'viewer']),
  locale: z.string().optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const { org_id, role, locale } = parsed.data;
  const email = parsed.data.email.trim().toLowerCase();

  const admin = createAdminClient();

  // Authz — only an owner/admin of the target org may invite (prevents an
  // arbitrary authenticated user from adding themselves/others to any org).
  const { data: caller } = await admin
    .from('organization_members')
    .select('role')
    .eq('org_id', org_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!caller || (caller.role !== 'owner' && caller.role !== 'admin')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let alreadyInvited = false;

  // Never pre-link the row to an existing profile's user_id. Pre-linking
  // (user_id set, invited_email null) strands invitees who sign in with a
  // different auth identity than their existing profile: claimPendingInvites
  // filters on `user_id is null`, so a pre-linked row never matches and the
  // invitee lands on a 0-membership 404. Instead always insert a pending
  // invited_email row so the claim path links whichever identity signs in.
  //
  // Exception — the email already belongs to a *full member of this org*: a
  // pending invited_email row would be a redundant duplicate (it does not
  // collide with unique(org_id, user_id), so the 23505 swallow below wouldn't
  // catch it). Detect that case explicitly and treat it as already-invited.
  const { data: existing } = await admin
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (existing) {
    const { data: existingMember } = await admin
      .from('organization_members')
      .select('user_id')
      .eq('org_id', org_id)
      .eq('user_id', existing.id)
      .maybeSingle();
    if (existingMember) alreadyInvited = true;
  }

  if (!alreadyInvited) {
    const { error } = await supabase.from('organization_members').insert({
      org_id,
      user_id: null,
      invited_email: email,
      role,
    });
    if (error) {
      // 23505 = unique_violation — a pending invite row for that email is
      // already on file (unique on org_id + invited_email). The inviter's
      // intent — "this person should be in the org" — is already satisfied, so
      // we treat it as success and (re)send the invite email.
      const pgCode = (error as { code?: string }).code;
      if (pgCode !== '23505') {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      alreadyInvited = true;
    }
  }

  // Send the real invite email (new — the old flow only ever created the
  // pending row). Failure is surfaced so the UI can offer a resend; the invite
  // row is kept regardless.
  const { data: org } = await admin
    .from('organizations')
    .select('name')
    .eq('id', org_id)
    .maybeSingle();
  const origin = new URL(req.url).origin;
  const acceptLocale = ['ko', 'en', 'ja', 'th'].includes(locale ?? '')
    ? (locale as string)
    : 'ko';
  const acceptUrl = `${origin}/${acceptLocale}/invite/accept`;

  // Localized copy via next-intl (WRITING.md SSOT) — no inline strings.
  const t = await getTranslations({
    locale: acceptLocale,
    namespace: 'CollabShare',
  });
  const inviter = user.email ?? '';
  const orgName = org?.name ?? '';
  const mail = await sendOrgInviteEmail({
    toEmail: email,
    replyTo: inviter,
    subject: t('emailSubject', { inviter, org: orgName }),
    text: t('emailBody', { inviter, org: orgName, url: acceptUrl }),
  });

  return NextResponse.json({
    ok: true,
    already_invited: alreadyInvited,
    email_sent: mail.ok,
    ...(mail.ok ? {} : { email_error: mail.error }),
  });
}

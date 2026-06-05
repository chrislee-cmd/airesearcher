import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Body = z.object({
  org_id: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'viewer']),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const { org_id, email, role } = parsed.data;

  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  const { error } = await supabase.from('organization_members').insert({
    org_id,
    user_id: existing?.id ?? null,
    invited_email: existing ? null : email,
    role,
  });

  if (error) {
    // 23505 = unique_violation. Either the invitee already accepted into
    // this org (unique on org_id + user_id) or a pending invite row for
    // that email is still on file (unique on org_id + invited_email). In
    // both cases the inviter's intent — "this person should be in the
    // org" — is already satisfied, so a 400 with the raw Postgres
    // message ("duplicate key value violates unique constraint…") is
    // worse than just returning ok. A "resend invite email" affordance
    // lives in a future pending-invites panel.
    const pgCode = (error as { code?: string }).code;
    if (pgCode === '23505') {
      return NextResponse.json({ ok: true, already_invited: true });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

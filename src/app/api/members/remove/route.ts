import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Body = z.object({
  org_id: z.string().uuid(),
  user_id: z.string().uuid().nullable().optional(),
  email: z.string().email().optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const { org_id, user_id, email } = parsed.data;

  let query = supabase.from('organization_members').delete().eq('org_id', org_id);
  query = user_id ? query.eq('user_id', user_id) : query.eq('invited_email', email!);

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

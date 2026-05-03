import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

const Body = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const { data, error } = await supabase
    .from('projects')
    .insert({
      org_id: org.org_id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      created_by: user.id,
    })
    .select('id, name, description, created_at')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'db_error' }, { status: 400 });
  }
  return NextResponse.json(data);
}

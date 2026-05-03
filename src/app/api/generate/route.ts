import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { spendCredits } from '@/lib/credits';
import { FEATURE_COSTS } from '@/lib/features';

const Body = z.object({
  feature: z.enum(['quotes', 'transcripts', 'interviews', 'reports']),
  input: z.string().min(1),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { feature, input } = parsed.data;

  const org = await getActiveOrg();
  if (!org) {
    return NextResponse.json({ error: 'no_organization' }, { status: 403 });
  }

  const { data: generation, error: insertError } = await supabase
    .from('generations')
    .insert({
      org_id: org.org_id,
      user_id: user.id,
      feature,
      input,
      output: null,
      credits_spent: FEATURE_COSTS[feature],
    })
    .select('id')
    .single();
  if (insertError || !generation) {
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  const result = await spendCredits(org.org_id, feature, generation.id);
  if (!result.ok) {
    await supabase.from('generations').delete().eq('id', generation.id);
    return NextResponse.json({ error: result.reason }, { status: 402 });
  }

  // Placeholder generation — replace with real model call later.
  const output = `[${feature}] generated output for input length ${input.length}.\n\n${input.slice(0, 200)}...`;

  await supabase
    .from('generations')
    .update({ output })
    .eq('id', generation.id);

  return NextResponse.json({ output, generation_id: generation.id });
}

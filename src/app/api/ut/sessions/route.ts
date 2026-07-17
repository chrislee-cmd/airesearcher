// POST /api/ut/sessions { target_url? } → { id }
//
// Creates one AI-UT session for the authenticated user. The row is written via
// the service role: ut_sessions RLS has NO self-insert policy, so the browser
// cannot create rows directly (spec §제약 — 클라 직접 insert 금지). status
// starts at 'recording'; the browser then mints signed upload URLs, uploads the
// mic-audio + screen recording, and calls finalize.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const Body = z
  .object({
    target_url: z.string().url().max(2000).optional(),
  })
  .optional();

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const limit = await rateLimit(user.id, 'ut-session-create', 20, '1 m');
  if (!limit.success) return rateLimitResponse(limit);

  const parsed = Body.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const target_url = parsed.data?.target_url ?? null;

  // Best-effort org attribution (nullable column) — the active org at creation.
  const org = await getActiveOrg();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('ut_sessions')
    .insert({
      user_id: user.id,
      org_id: org?.org_id || null,
      target_url,
      status: 'recording',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'create_failed' }, { status: 500 });
  }

  return NextResponse.json({ id: data.id });
}

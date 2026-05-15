import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { getArtifactContent } from '@/lib/workspace-server';

const Body = z.object({
  feature: z.enum([
    'transcript',
    'desk',
    'interview',
    'report',
    'scheduler',
    'recruiting',
    'generation',
  ]),
  id: z.string().min(1),
});

// POST /api/workspace/content
// Returns { content, kind } for one artifact. kind = 'html' for reports,
// 'markdown' otherwise. Called lazily by the workspace panel only when the
// user actually needs the body (view/copy/send/download).

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const org = await getActiveOrg();
  if (!org?.org_id) return NextResponse.json({ error: 'no_org' }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const result = await getArtifactContent(org.org_id, parsed.data.feature, parsed.data.id);
  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(result);
}

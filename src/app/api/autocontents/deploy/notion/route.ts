// autocontents — Notion deploy route shell.
//
// PR-N1 (이 PR): auth gate. 501.
// PR-N3: enko 의 Notion 배포 route 를 포팅. NOTION_API_TOKEN 사용.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

export const runtime = 'nodejs';

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  return NextResponse.json(
    { error: 'not_implemented', migration_phase: 'foundation' },
    { status: 501 },
  );
}

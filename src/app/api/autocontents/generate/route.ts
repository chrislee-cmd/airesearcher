// autocontents — generate route shell.
//
// PR-N1 (이 PR): auth gate 만 박힌 shell. body 무시, 501 응답.
// PR-N3: enko 의 generate route (Anthropic streaming + 본문 생성) 를
//   여기에 포팅. body schema (report, topic, instructions, …) 는 PR-N3
//   에서 확정.

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

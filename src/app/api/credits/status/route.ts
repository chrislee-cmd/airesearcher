import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { getCreditsStatus } from '@/lib/credits';

// Lightweight status endpoint the client polls / fetches on mount to drive
// the trial badge and paywall gating. Authoritative data lives on the org
// row — keep this read-only.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const status = await getCreditsStatus(org.org_id);
  return NextResponse.json(status);
}

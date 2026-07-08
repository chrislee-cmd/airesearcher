import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasDocsScope, hasSheetsScope } from '@/lib/google-oauth';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Read via the service role: user_google_oauth is deny-all to the browser
  // session now (self-select policy dropped), so the RLS-bound user client
  // would see 0 rows. Auth is already enforced by getUser() above.
  const admin = createAdminClient();
  const { data } = await admin
    .from('user_google_oauth')
    .select('scope, email')
    .eq('user_id', user.id)
    .maybeSingle();

  return NextResponse.json({
    connected: !!data,
    hasDocs: hasDocsScope(data?.scope),
    hasSheets: hasSheetsScope(data?.scope),
    email: data?.email ?? null,
  });
}

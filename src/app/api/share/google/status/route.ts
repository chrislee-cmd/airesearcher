import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasDocsScope, hasSheetsScope } from '@/lib/google-oauth';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data } = await supabase
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

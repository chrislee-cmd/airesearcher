import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Lightweight check the UI calls to render "Google 연결됨 (email)" or a
// "연결하기" button. Returns 200 either way.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data } = await admin
    .from('user_google_oauth')
    .select('email,scope,updated_at')
    .eq('user_id', user.id)
    .maybeSingle();

  return NextResponse.json({
    connected: !!data,
    email: data?.email ?? null,
    scope: data?.scope ?? null,
    updatedAt: data?.updated_at ?? null,
  });
}

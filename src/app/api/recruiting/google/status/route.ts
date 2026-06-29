import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasResponsesScope, hasDriveFileScope } from '@/lib/google-oauth';
import {
  getAdminEmail,
  isAdminProxyConfigured,
} from '@/lib/google-oauth-admin';

// Lightweight check the UI calls to render "Google 연결됨 (email)" or a
// "연결하기" button. Returns 200 either way.
//
// When admin-proxy mode is active (GOOGLE_ADMIN_* env populated) we
// short-circuit the per-user OAuth lookup and report "connected" so the
// wizard treats publish as instantly available. The user never sees a
// connect-Google button in that mode — every publish goes through the
// admin's refresh token server-side.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (isAdminProxyConfigured()) {
    const adminEmail = getAdminEmail();
    return NextResponse.json({
      connected: true,
      email: adminEmail,
      scope: null,
      updatedAt: null,
      hasResponses: true,
      hasDrive: true,
      adminProxy: true,
    });
  }

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
    hasResponses: hasResponsesScope(data?.scope),
    hasDrive: hasDriveFileScope(data?.scope),
    adminProxy: false,
  });
}

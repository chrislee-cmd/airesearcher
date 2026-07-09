import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { decryptToken } from '@/lib/crypto/token-cipher';

// Removes the stored Google OAuth tokens for the current user so they
// can reconnect with a different account (e.g. switching from a
// Workspace account to a personal Gmail to escape per-form domain
// restrictions on published forms).
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from('user_google_oauth')
    .select('refresh_token')
    .eq('user_id', user.id)
    .maybeSingle();

  if (row?.refresh_token) {
    // Best-effort revoke at Google so the user is presented with the
    // consent screen again on reconnect (and so we don't leak a still-
    // valid token if the row resurfaces).
    try {
      // Row is deleted right after, so decrypt in place (no re-encrypt needed).
      const refreshToken = decryptToken(row.refresh_token);
      await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`,
        { method: 'POST' },
      );
    } catch {
      // Non-fatal — proceed with the local row delete.
    }
  }

  await admin.from('user_google_oauth').delete().eq('user_id', user.id);
  return NextResponse.json({ ok: true });
}

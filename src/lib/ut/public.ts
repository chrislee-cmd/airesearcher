// Token → session resolve for the anon AI-UT participant path.
//
// The participant is NOT an authenticated user, so participant_token IS the
// authorization. We resolve it through the security-definer RPC
// get_ut_session_by_token (migration 20260718073700_ut_sessions_remote) — the
// same "narrow function to anon" pattern translate uses — so the table schema
// stays private and the token check lives in one place. Every token-scoped
// public route (resolve / publisher-token / upload-url / finalize) starts here.
import { createAdminClient } from '@/lib/supabase/admin';

export type UtPublicSession = {
  id: string;
  task_goal: string | null;
  target_url: string | null;
  livekit_room: string | null;
  session_kind: string;
  mode: string;
  status: string;
};

export type UtTokenResolve =
  | { error: string; status: number }
  | { admin: ReturnType<typeof createAdminClient>; session: UtPublicSession };

export async function resolveUtToken(token: string): Promise<UtTokenResolve> {
  // The token is a 21-char URL-safe string; bound the length defensively so a
  // junk value never reaches the DB.
  if (!token || token.length < 16 || token.length > 32) {
    return { error: 'invalid_token', status: 400 };
  }
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('get_ut_session_by_token', { p_token: token });
  if (error) return { error: error.message, status: 500 };
  const row = (Array.isArray(data) ? data[0] : data) as UtPublicSession | undefined;
  if (!row) return { error: 'not_found', status: 404 };
  return { admin, session: row };
}

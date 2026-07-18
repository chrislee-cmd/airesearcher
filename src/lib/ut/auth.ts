// Auth + ownership gate for a single AI-UT session, shared by every
// /api/ut/sessions/[id]/… route. The row is read through the service role so a
// prod RLS drift (PROJECT.md §7.5 — migrations don't auto-apply for
// destructive changes, and additive ones land a few minutes after merge) can't
// make a real session read back empty. Authorization is enforced HERE, in code:
// only the owner OR a super-admin may proceed — a non-owner non-admin gets a
// 404 so we never reveal that someone else's session exists.
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';

export type UtSessionRow = {
  id: string;
  user_id: string;
  org_id: string | null;
  target_url: string | null;
  status: string;
  audio_storage_key: string | null;
  recording_storage_key: string | null;
  transcript: string | null;
  duration_ms: number | null;
  meta: Record<string, unknown> | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  // Remote participant model (migration 20260718073700_ut_sessions_remote).
  // Present on every row; 'local' self-capture sessions leave the token/room
  // NULL and mode = 'local'.
  mode: string;
  task_goal: string | null;
  participant_token: string | null;
  livekit_room: string | null;
  participant_joined_at: string | null;
  session_kind: string;
};

export type UtAccess =
  | { error: string; status: number }
  | {
      user: { id: string; email: string | null };
      admin: ReturnType<typeof createAdminClient>;
      session: UtSessionRow;
      isSuperAdmin: boolean;
      isOwner: boolean;
    };

export async function loadUtSession(sessionId: string): Promise<UtAccess> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'unauthorized', status: 401 };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('ut_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle<UtSessionRow>();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: 'not_found', status: 404 };

  const isSuperAdmin = isSuperAdminEmail(user.email);
  const isOwner = data.user_id === user.id;
  if (!isOwner && !isSuperAdmin) {
    // Don't reveal existence to a non-owner non-admin.
    return { error: 'not_found', status: 404 };
  }

  return {
    user: { id: user.id, email: user.email ?? null },
    admin,
    session: data,
    isSuperAdmin,
    isOwner,
  };
}

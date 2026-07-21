// Token → candidate resolve for the anon recruiting-scheduling participant path
// (PR4). Mirrors resolveUtToken (@/lib/ut/public): the participant is NOT an
// authenticated user, so `participant_token` (minted in PR1's sched_candidates)
// IS the authorization.
//
// Unlike the UT path we do NOT expose an anon SELECT policy or a security-
// definer RPC — opening sched_candidates/sched_messages to the (public) anon
// key would leak every candidate's data. Instead every public route resolves
// the token here through the service-role client and then scopes ALL follow-up
// queries to exactly this candidate id. The token check + scope live in one
// place so a route can never accidentally widen the scope.
import { createAdminClient } from '@/lib/supabase/admin';

export type SchedPublicCandidate = {
  id: string;
  batch_id: string;
  name: string | null;
  email: string | null;
};

export type SchedTokenResolve =
  | { error: string; status: number }
  | {
      admin: ReturnType<typeof createAdminClient>;
      candidate: SchedPublicCandidate;
    };

export async function resolveSchedToken(
  token: string,
): Promise<SchedTokenResolve> {
  // participant_token defaults to a uuid text (36 chars); bound the length
  // defensively so a junk value never reaches the DB.
  if (!token || token.length < 16 || token.length > 64) {
    return { error: 'invalid_token', status: 400 };
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('sched_candidates')
    .select('id, batch_id, name, email')
    .eq('participant_token', token)
    .maybeSingle();
  if (error) return { error: 'resolve_failed', status: 500 };
  if (!data) return { error: 'not_found', status: 404 };
  return { admin, candidate: data as SchedPublicCandidate };
}

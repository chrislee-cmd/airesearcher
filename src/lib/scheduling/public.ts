// shareToken → project resolve + phone-tail candidate matching for the anon
// recruiting-scheduling participant path.
//
// The link is now ONE common URL per project (/schedule/<share_token>), not a
// per-candidate token (BUILD-SPEC §5.1). share_token identifies the project
// only (unguessable uuid); it grants NO one person's data. Identity is resolved
// server-side by matching the visitor's phone tail against the candidates in
// that project, then bound into a signed cookie (participant-gate).
//
// We do NOT expose an anon SELECT policy or a security-definer RPC — opening
// sched_* to the (public) anon key would leak every candidate's data. Every
// public route resolves the share_token here through the service-role client and
// then scopes ALL follow-up queries to the ONE candidate the cookie proved. The
// resolve + scope live in one place so a route can never accidentally widen it.
import { createAdminClient } from '@/lib/supabase/admin';
import { phoneTail, normalizeTailInput } from '@/lib/scheduling/participant-gate';

export type SchedPublicCandidate = {
  id: string;
  batch_id: string;
  name: string | null;
  // phone is resolved for the server-side entry gate (phone-tail match) only.
  // It MUST never be returned to the client — every public route projects only
  // `candidate.name` outward.
  phone: string | null;
};

export type SchedProjectResolve =
  | { error: string; status: number }
  | {
      admin: ReturnType<typeof createAdminClient>;
      project: { id: string };
    };

/**
 * share_token → project. Bounds the token length defensively so a junk value
 * never reaches the DB. share_token defaults to a uuid text (36 chars).
 */
export async function resolveShareToken(
  shareToken: string,
): Promise<SchedProjectResolve> {
  if (!shareToken || shareToken.length < 16 || shareToken.length > 64) {
    return { error: 'invalid_token', status: 400 };
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('sched_projects')
    .select('id')
    .eq('share_token', shareToken)
    .maybeSingle();
  if (error) return { error: 'resolve_failed', status: 500 };
  if (!data) return { error: 'not_found', status: 404 };
  return { admin, project: { id: data.id as string } };
}

/**
 * Every candidate in a project. Resolved in two steps (batch ids → candidates
 * via `.in()`) rather than a PostgREST embed: sched_candidates → sched_batches
 * has a direct FK, but the 2-step read is immune to the embed-returns-0-rows
 * trap (PROJECT.md §7.10) and lets us scope cheaply.
 */
export async function listProjectCandidates(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
): Promise<SchedPublicCandidate[]> {
  const { data: batches, error: bErr } = await admin
    .from('sched_batches')
    .select('id')
    .eq('project_id', projectId)
    .limit(2000);
  if (bErr || !batches || batches.length === 0) return [];
  const batchIds = batches.map((b) => b.id as string);

  const { data: candidates, error: cErr } = await admin
    .from('sched_candidates')
    .select('id, batch_id, name, phone')
    .in('batch_id', batchIds)
    .limit(10000);
  if (cErr || !candidates) return [];
  return candidates as SchedPublicCandidate[];
}

/**
 * Candidates in the project whose phone tail (last 6 digits) matches the input.
 * Candidates without a phone on file have a null tail → never match (no-phone
 * = no entry, per policy). Returns the full matched candidates so the caller can
 * disambiguate by name / pick one.
 */
export function matchCandidatesByTail(
  candidates: SchedPublicCandidate[],
  tailInput: string,
): SchedPublicCandidate[] {
  const given = normalizeTailInput(tailInput);
  if (!given) return [];
  return candidates.filter((c) => phoneTail(c.phone) === given);
}

/**
 * Candidates in the project whose FULL phone digits equal the input — the
 * disambiguation fallback when several tail-matches share the same name (an
 * edge case where the name list can't tell them apart).
 */
export function matchCandidatesByFullPhone(
  candidates: SchedPublicCandidate[],
  fullPhoneInput: string,
): SchedPublicCandidate[] {
  const given = fullPhoneInput.replace(/\D/g, '');
  if (!given) return [];
  return candidates.filter((c) => {
    const digits = (c.phone ?? '').replace(/\D/g, '');
    return digits.length > 0 && digits === given;
  });
}

/**
 * Resolve a single candidate BY ID but scoped to the project — used by the data
 * routes after the cookie yields a candidateId. Confirms the candidate still
 * belongs to this project (defense in depth: the signed cookie already vouches
 * for the id, but a candidate could have been moved/removed). Returns null if
 * the candidate is missing or not in this project.
 */
export async function resolveCandidateInProject(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  candidateId: string,
): Promise<SchedPublicCandidate | null> {
  if (!candidateId || candidateId.length > 64) return null;
  const { data: cand, error: cErr } = await admin
    .from('sched_candidates')
    .select('id, batch_id, name, phone')
    .eq('id', candidateId)
    .maybeSingle();
  if (cErr || !cand) return null;

  const { data: batch, error: bErr } = await admin
    .from('sched_batches')
    .select('project_id')
    .eq('id', (cand as SchedPublicCandidate).batch_id)
    .maybeSingle();
  if (bErr || !batch || (batch.project_id as string | null) !== projectId) {
    return null;
  }
  return cand as SchedPublicCandidate;
}

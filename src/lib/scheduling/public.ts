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
import {
  phoneTail,
  normalizeTailInput,
  phoneIdentityKey,
} from '@/lib/scheduling/participant-gate';

export type SchedPublicCandidate = {
  id: string;
  batch_id: string;
  name: string | null;
  // phone is resolved for the server-side entry gate (phone-tail match) only.
  // It MUST never be returned to the client — every public route projects only
  // `candidate.name` outward.
  phone: string | null;
  // Row creation time + owning-batch inbox flag — only the entry gate's
  // identity-collapse (duplicate inbox+group rows of one person) reads these to
  // pick a deterministic primary row. Optional: selects that don't need them
  // leave them undefined.
  created_at?: string | null;
  is_inbox?: boolean | null;
  // Coarse per-candidate status — only the broadcast read gate needs it (공지는
  // 확정자에게만 보인다). Optional: the entry-gate helpers (tail/full-phone match)
  // don't select it, so it stays undefined there.
  status?: string | null;
  // Last-seen throttle source for the public read route. Present only where the
  // select includes it (resolveCandidateInProject).
  last_seen_at?: string | null;
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
  // Fetch batches WITH is_inbox so the gate can prefer the active group
  // (non-inbox) row when collapsing a person's duplicate inbox+group records.
  // Older preview DBs predating is_inbox → fall back to id-only (is_inbox stays
  // null → identity collapse falls back to created_at/id ordering).
  type BatchRow = { id: string; is_inbox?: boolean | null };
  let batches: BatchRow[];
  const wide = await admin
    .from('sched_batches')
    .select('id, is_inbox')
    .eq('project_id', projectId)
    .limit(2000);
  if (wide.error) {
    const narrow = await admin
      .from('sched_batches')
      .select('id')
      .eq('project_id', projectId)
      .limit(2000);
    if (narrow.error || !narrow.data || narrow.data.length === 0) return [];
    batches = narrow.data as BatchRow[];
  } else if (!wide.data || wide.data.length === 0) {
    return [];
  } else {
    batches = wide.data as BatchRow[];
  }
  const inboxByBatch = new Map(batches.map((b) => [b.id, b.is_inbox ?? null]));
  const batchIds = batches.map((b) => b.id);

  const { data: candidates, error: cErr } = await admin
    .from('sched_candidates')
    .select('id, batch_id, name, phone, created_at')
    .in('batch_id', batchIds)
    .limit(10000);
  if (cErr || !candidates) return [];
  return (candidates as SchedPublicCandidate[]).map((c) => ({
    ...c,
    is_inbox: inboxByBatch.get(c.batch_id) ?? null,
  }));
}

/**
 * Group tail/phone matches by identity (full normalized phone digits) so the
 * gate treats a person's duplicate inbox+group rows as ONE. Rows with no phone
 * digits are skipped (they can't be a resolvable identity — and never match a
 * tail anyway). Key = full digits, value = every row for that person.
 */
export function groupByPhoneIdentity(
  candidates: SchedPublicCandidate[],
): Map<string, SchedPublicCandidate[]> {
  const groups = new Map<string, SchedPublicCandidate[]>();
  for (const c of candidates) {
    const key = phoneIdentityKey(c.phone);
    if (!key) continue;
    const arr = groups.get(key);
    if (arr) arr.push(c);
    else groups.set(key, [c]);
  }
  return groups;
}

/**
 * Deterministically pick the primary row among a person's duplicate rows — the
 * id bound into the gate cookie. Preference:
 *   1. the active group (non-inbox) row — downstream slots/messages are scoped
 *      to the cookie's candidate_id, and admins schedule candidates in group
 *      (non-inbox) batches, so binding there lets the participant actually
 *      see/book their schedule;
 *   2. oldest created_at (the original record);
 *   3. lowest id — total determinism when the above tie (or columns absent).
 */
export function pickPrimaryCandidate(
  rows: SchedPublicCandidate[],
): SchedPublicCandidate {
  return [...rows].sort((a, b) => {
    const r = inboxRank(a) - inboxRank(b);
    if (r !== 0) return r;
    const ca = a.created_at ?? '';
    const cb = b.created_at ?? '';
    if (ca !== cb) return ca < cb ? -1 : 1; // oldest first
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0];
}

// Lower rank = preferred. Non-inbox (active group) wins; unknown (column
// absent) in the middle; inbox (raw intake pool) last.
function inboxRank(c: SchedPublicCandidate): number {
  if (c.is_inbox === false) return 0;
  if (c.is_inbox === true) return 2;
  return 1;
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
  // Wide select carries status (broadcast gate) + last_seen_at (touch throttle).
  // Preview DBs predating the joined_at/last_seen_at migration lack last_seen_at,
  // so fall back to the pre-columns select — otherwise the participant read would
  // 401 for everyone until the migration lands (regression guard).
  let cand: Record<string, unknown> | null = null;
  const wide = await admin
    .from('sched_candidates')
    .select('id, batch_id, name, phone, status, last_seen_at')
    .eq('id', candidateId)
    .maybeSingle();
  if (wide.error) {
    const narrow = await admin
      .from('sched_candidates')
      .select('id, batch_id, name, phone, status')
      .eq('id', candidateId)
      .maybeSingle();
    if (narrow.error || !narrow.data) return null;
    cand = narrow.data as Record<string, unknown>;
  } else if (!wide.data) {
    return null;
  } else {
    cand = wide.data as Record<string, unknown>;
  }

  const { data: batch, error: bErr } = await admin
    .from('sched_batches')
    .select('project_id')
    .eq('id', (cand as unknown as SchedPublicCandidate).batch_id)
    .maybeSingle();
  if (bErr || !batch || (batch.project_id as string | null) !== projectId) {
    return null;
  }
  return cand as unknown as SchedPublicCandidate;
}

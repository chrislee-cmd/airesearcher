import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParsedCandidate } from './candidates-parse';
import { applyCanonicalPhone, canonicalizeMobile } from './phone';

// Identity key for a phone: prefer the canonical `10########` (card 604) so
// `010…`(11 digits) and `10…`(10 digits, leading 0 dropped) collapse to the same
// person; fall back to raw digits for un-canonicalizable values so a flagged
// landline still self-matches on re-import. Empty → '' (never a match key).
const phoneKey = (p: string | null | undefined): string =>
  canonicalizeMobile(p).canonical ?? (p ?? '').replace(/\D/g, '');

// Merge + upsert parsed candidates into a batch. Shared by the CSV/XLSX file
// upload route and the Google Sheets import route so both use identical
// identity-merge semantics.
//
// Matching is MULTI-KEY and PROJECT-WIDE (card 605): a parsed row is matched to
// an existing candidate anywhere in the SAME PROJECT (all sibling batches, not
// just the target batch) if ANY of its phone / email / name equals the
// corresponding field on that row (priority PHONE > email > name — canonical
// phone is the most trustworthy identity, card 604). This keeps re-imports
// idempotent even when a header-mapping fix changes a candidate's *best*
// identity between imports (e.g. a row that first landed name-only later gains a
// phone — name still links it to the same row, which then absorbs the phone).
//
// Why project-wide, not batch-local: someone already in the inbox batch who is
// re-uploaded onto a GROUP batch used to miss the batch-local dedup (the group
// had no copy of them) → a fresh INSERT → the same person duplicated across two
// batches. Matching across the whole project instead MOVEs their existing row
// into the target batch (reassign batch_id) + merges fields — never a new row.
// When a matched row lives in another batch, its interview slots follow it
// (sched_slots.batch_id is realigned after the upsert) so the group calendar
// keeps showing them. Preference on ties goes to a row already IN the target
// batch (a plain in-batch UPDATE, no move). Each existing row is claimed at most
// once so two parsed rows can't both update it (PostgREST rejects a second
// update to the same id in one statement).
//
// A match becomes an UPDATE (carries the existing id, unions fields so a partial
// re-import never drops earlier columns; a cross-batch match additionally
// rewrites batch_id = the target, i.e. a MOVE); a miss becomes an INSERT (omits
// id so the DB default mints a fresh uuid + participant_token). Anonymous rows
// (no email/phone/name) always insert. The old `(batch_id,email)` collision that
// surfaced as a duplicate is now absorbed: the colliding identity matches its
// existing project row and updates it rather than inserting a rival.
//
// `source` (optional) stamps the provenance column ('bridge' | 'upload' |
// 'sheet') so downstream reads can mask response-derived contacts. To avoid ever
// downgrading masking, an UPDATE keeps the existing row's source unless it was
// null (a re-import of the same identity never flips 'bridge' → 'upload'). The
// column is additive: on a preview DB that lacks it the upsert transparently
// retries without `source` (wide/narrow degrade).
//
// `stage` (optional, default 'roster', card 588) marks whether a NEW row lands
// as intake (awaiting selection in ①응답) or roster (visible in ②일정). It is
// stamped on INSERTs only — an UPDATE never rewrites stage, so a re-upload that
// matches an already-promoted ('roster') row can't demote it back to 'intake'
// (promotion is not undone by a re-import). Like `source` it is additive: a
// preview DB without the column transparently degrades (wide/narrow) so the
// upsert still succeeds, treating every row as roster (current behaviour).
export async function upsertCandidatesIntoBatch(
  admin: SupabaseClient,
  batchId: string,
  candidates: ParsedCandidate[],
  source?: 'bridge' | 'upload' | 'sheet',
  stage: 'intake' | 'roster' = 'roster',
): Promise<
  { upserted: number } | { error: string; code?: string | null; detail?: string | null }
> {
  // Canonicalize phones to `10########` at the single write chokepoint so EVERY
  // ingest path (file upload, sheet import, bridge form-response) stores the same
  // canonical form — keeping dedup (phoneDigits below) and the participant gate
  // consistent (card 604, see phoneKey). The file/sheet parser already canonicalizes, so this
  // is idempotent for those; it's the only canonicalization the bridge path gets.
  // Flagged (un-canonicalizable) phones are left untouched — never mangled.
  const canonicalCandidates = candidates.map((c) => {
    const applied = applyCanonicalPhone(c.phone, c.fields);
    return { ...c, phone: applied.phone, fields: applied.fields };
  });
  // Resolve the set of batches to dedup against = every batch in the target's
  // PROJECT (card 605 cross-batch identity). If the target batch has no project
  // (preview DB without project_id, or a legacy standalone batch) we degrade to
  // the target batch alone — exactly the pre-605 batch-local behaviour.
  let siblingBatchIds: string[] = [batchId];
  const batchRow = await admin
    .from('sched_batches')
    .select('project_id')
    .eq('id', batchId)
    .maybeSingle();
  const projectId =
    !batchRow.error && batchRow.data
      ? ((batchRow.data as { project_id?: string | null }).project_id ?? null)
      : null;
  if (projectId) {
    const siblings = await admin
      .from('sched_batches')
      .select('id')
      .eq('project_id', projectId);
    if (!siblings.error && siblings.data && siblings.data.length > 0) {
      siblingBatchIds = (siblings.data as { id: string }[]).map((b) => b.id);
      if (!siblingBatchIds.includes(batchId)) siblingBatchIds.push(batchId);
    }
  }

  // Wide select (with source) so an UPDATE can preserve a stronger existing
  // source; fall back to the pre-source column set on a preview DB. `batch_id`
  // is selected so cross-batch matches (batch_id !== target) can be detected and
  // their slots realigned after the upsert.
  let existingRows: {
    id: string;
    batch_id: string;
    email: string | null;
    phone: string | null;
    name: string | null;
    fields: Record<string, string> | null;
    source?: string | null;
  }[] = [];
  const wideExisting = await admin
    .from('sched_candidates')
    .select('id, batch_id, email, name, phone, fields, source')
    .in('batch_id', siblingBatchIds);
  let hasSourceColumn = true;
  if (wideExisting.error) {
    hasSourceColumn = false;
    const narrow = await admin
      .from('sched_candidates')
      .select('id, batch_id, email, name, phone, fields')
      .in('batch_id', siblingBatchIds);
    existingRows = (narrow.data ?? []) as typeof existingRows;
  } else {
    existingRows = (wideExisting.data ?? []) as typeof existingRows;
  }
  // Probe the stage column separately so its absence degrades independently of
  // `source` (a preview DB could have one but not the other). We only ever WRITE
  // stage on inserts, so a cheap existence probe (limit 1) is enough.
  let hasStageColumn = true;
  const stageProbe = await admin
    .from('sched_candidates')
    .select('stage')
    .limit(1);
  if (stageProbe.error) hasStageColumn = false;

  const byEmail = new Map<string, string>();
  const byPhone = new Map<string, string>();
  const byName = new Map<string, string>();
  const fieldsById = new Map<string, Record<string, string>>();
  const sourceById = new Map<string, string | null>();
  const batchIdById = new Map<string, string>();
  // Prefer a row already in the TARGET batch on a key collision so an identity
  // present in both the target and a sibling batch resolves to a plain in-batch
  // UPDATE (no move) rather than dragging the sibling's row across.
  const setPref = (map: Map<string, string>, key: string, r: { id: string; batch_id: string }) => {
    if (!map.has(key) || r.batch_id === batchId) map.set(key, r.id);
  };
  for (const r of existingRows ?? []) {
    fieldsById.set(r.id, (r.fields ?? {}) as Record<string, string>);
    sourceById.set(r.id, r.source ?? null);
    batchIdById.set(r.id, r.batch_id);
    if (r.email) setPref(byEmail, r.email.trim().toLowerCase(), r);
    const d = phoneKey(r.phone);
    if (d) setPref(byPhone, d, r);
    if (r.name) setPref(byName, r.name.trim().toLowerCase(), r);
  }

  const claimed = new Set<string>();
  function matchExistingId(c: ParsedCandidate): string | undefined {
    // Candidate keys in identity order: phone first (canonical, most
    // trustworthy), then email, then name.
    const keyed: (string | undefined)[] = [];
    const d = phoneKey(c.phone);
    if (d) keyed.push(byPhone.get(d));
    if (c.email) keyed.push(byEmail.get(c.email.trim().toLowerCase()));
    if (c.name) keyed.push(byName.get(c.name.trim().toLowerCase()));
    const free = keyed.filter((id): id is string => !!id && !claimed.has(id));
    // A row already in the target batch wins over a sibling-batch row, even if a
    // higher-priority key points at the sibling: if the person is already here we
    // do a plain in-batch UPDATE (no move, no risk of a (batch_id,email) clash
    // against an existing target row). Only when the target lacks them do we pull
    // the sibling row across. Within each tier the phone>email>name order holds.
    return free.find((id) => batchIdById.get(id) === batchId) ?? free[0];
  }

  // Ids matched to a row that currently lives in a SIBLING batch — the upsert
  // rewrites their batch_id to the target (a MOVE), and their slots follow.
  const movedCandidateIds = new Set<string>();
  const payload = canonicalCandidates.map((c) => {
    const id = matchExistingId(c);
    if (id) {
      claimed.add(id);
      if (batchIdById.get(id) && batchIdById.get(id) !== batchId) {
        movedCandidateIds.add(id);
      }
    }
    const existingFields = id ? (fieldsById.get(id) ?? {}) : {};
    const base: Record<string, unknown> = {
      batch_id: batchId,
      email: c.email,
      name: c.name,
      phone: c.phone,
      fields: id ? { ...existingFields, ...c.fields } : c.fields,
    };
    if (hasSourceColumn && source) {
      // Never downgrade masking: an existing 'bridge'/'upload'/'sheet' row keeps
      // its source; only a null (or missing) source takes the new stamp.
      base.source = id ? (sourceById.get(id) ?? source) : source;
    }
    // stage: INSERT-only. An UPDATE (matched `id`) omits the key entirely so the
    // existing row keeps its stage — a re-upload never demotes a promoted row
    // back to intake. With defaultToNull:false, an omitted key on an insert row
    // takes the column DEFAULT ('roster'), which is exactly what we want when the
    // caller asks for roster, so we only need to set it explicitly for intake.
    if (hasStageColumn && !id) {
      base.stage = stage;
    }
    return id ? { id, ...base } : base;
  });

  // defaultToNull: false is load-bearing. When a re-upload mixes UPDATE rows
  // (carry `id`) with INSERT rows (omit `id`), PostgREST unions the column set
  // and, by default, fills every absent cell with NULL — so an insert row's
  // missing `id` becomes NULL and violates the PK NOT NULL (23502). With
  // missing=default, absent keys take the column DEFAULT instead: `id` →
  // gen_random_uuid(), `participant_token` → its default, `status` → 'pending'.
  // Explicitly-set nulls (email/name/phone on a row that has the key) are
  // unaffected — they're present, not missing.
  const { data, error } = await admin
    .from('sched_candidates')
    .upsert(payload, { onConflict: 'id', defaultToNull: false })
    .select('id');
  // Carry the raw Postgres code + message so the upload/import routes can surface
  // the real cause instead of a blanket "save_failed" (journey R3 #2 — an upload
  // that "looks successful" but silently no-ops must instead show why). This runs
  // through the service-role client on the user's own batch, so the DB error
  // leaks no cross-tenant secrets.
  if (error) return { error: 'save_failed', code: error.code ?? null, detail: error.message ?? null };

  // Slots follow their candidate on a cross-batch MOVE (card 605): a slot is
  // scoped to a batch both directly (sched_slots.batch_id) and transitively
  // (via candidate). The candidate_id FK is untouched by the move, so only
  // batch_id needs realigning — otherwise the moved person's interviews stay in
  // the old batch and vanish from the target's (group) calendar. Best-effort:
  // the candidate move already committed; a slot realign failure is logged but
  // does not fail the upload (and the batch_id column is additive on preview).
  if (movedCandidateIds.size > 0) {
    const slotMove = await admin
      .from('sched_slots')
      .update({ batch_id: batchId })
      .in('candidate_id', [...movedCandidateIds]);
    if (slotMove.error) {
      console.error('[scheduling/upsert] slot batch realign failed', slotMove.error);
    }
  }

  return { upserted: data?.length ?? 0 };
}

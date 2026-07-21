import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParsedCandidate } from './candidates-parse';

const phoneDigits = (p: string): string => p.replace(/\D/g, '');

// Merge + upsert parsed candidates into a batch. Shared by the CSV/XLSX file
// upload route and the Google Sheets import route so both use identical
// identity-merge semantics.
//
// Matching is MULTI-KEY: a parsed row is matched to an existing batch row if
// ANY of its email / phone / name equals the corresponding field on that row
// (priority email > phone > name). This keeps re-imports idempotent even when a
// header-mapping fix changes a candidate's *best* identity between imports
// (e.g. a row that first landed name-only later gains a phone — name still
// links it to the same row, which then absorbs the phone). Single best-identity
// matching would instead create a duplicate. Each existing row is claimed at
// most once so two parsed rows can't both update it (PostgREST rejects a second
// update to the same id in one statement).
//
// A match becomes an UPDATE (carries the existing id, unions fields so a partial
// re-import never drops earlier columns); a miss becomes an INSERT (omits id so
// the DB default mints a fresh uuid + participant_token). Anonymous rows (no
// email/phone/name) always insert.
export async function upsertCandidatesIntoBatch(
  admin: SupabaseClient,
  batchId: string,
  candidates: ParsedCandidate[],
): Promise<{ upserted: number } | { error: string }> {
  const { data: existingRows } = await admin
    .from('sched_candidates')
    .select('id, email, name, phone, fields')
    .eq('batch_id', batchId);

  const byEmail = new Map<string, string>();
  const byPhone = new Map<string, string>();
  const byName = new Map<string, string>();
  const fieldsById = new Map<string, Record<string, string>>();
  for (const r of existingRows ?? []) {
    fieldsById.set(r.id, (r.fields ?? {}) as Record<string, string>);
    if (r.email) byEmail.set(r.email.trim().toLowerCase(), r.id);
    if (r.phone) {
      const d = phoneDigits(r.phone);
      if (d) byPhone.set(d, r.id);
    }
    if (r.name) byName.set(r.name.trim().toLowerCase(), r.id);
  }

  const claimed = new Set<string>();
  function matchExistingId(c: ParsedCandidate): string | undefined {
    const candidates: (string | undefined)[] = [];
    if (c.email) candidates.push(byEmail.get(c.email.trim().toLowerCase()));
    if (c.phone) {
      const d = phoneDigits(c.phone);
      if (d) candidates.push(byPhone.get(d));
    }
    if (c.name) candidates.push(byName.get(c.name.trim().toLowerCase()));
    for (const id of candidates) if (id && !claimed.has(id)) return id;
    return undefined;
  }

  const payload = candidates.map((c) => {
    const id = matchExistingId(c);
    if (id) claimed.add(id);
    const existingFields = id ? (fieldsById.get(id) ?? {}) : {};
    const base = {
      batch_id: batchId,
      email: c.email,
      name: c.name,
      phone: c.phone,
      fields: id ? { ...existingFields, ...c.fields } : c.fields,
    };
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
  if (error) return { error: 'save_failed' };

  return { upserted: data?.length ?? 0 };
}

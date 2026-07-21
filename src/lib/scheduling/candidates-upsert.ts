import type { SupabaseClient } from '@supabase/supabase-js';
import { candidateIdentity, type ParsedCandidate } from './candidates-parse';

// Merge + upsert parsed candidates into a batch. Shared by the CSV/XLSX file
// upload route and the Google Sheets import route so both use identical
// identity-merge semantics.
//
// Each parsed row resolves against the batch's existing rows by best-available
// identity (email > phone > name). A match becomes an UPDATE (carries the
// existing id, unions fields so a partial re-import never drops earlier
// columns); a miss becomes an INSERT (omits id so the DB default mints a fresh
// uuid + participant_token). A single upsert on the `id` primary key applies
// both. Anonymous rows (no identity) always insert.
export async function upsertCandidatesIntoBatch(
  admin: SupabaseClient,
  batchId: string,
  candidates: ParsedCandidate[],
): Promise<{ upserted: number } | { error: string }> {
  const { data: existingRows } = await admin
    .from('sched_candidates')
    .select('id, email, name, phone, fields')
    .eq('batch_id', batchId);

  const existingByIdentity = new Map<
    string,
    { id: string; fields: Record<string, string> }
  >();
  for (const r of existingRows ?? []) {
    const key = candidateIdentity(r as ParsedCandidate);
    if (key != null) {
      existingByIdentity.set(key, {
        id: r.id,
        fields: (r.fields ?? {}) as Record<string, string>,
      });
    }
  }

  const payload = candidates.map((c) => {
    const key = candidateIdentity(c);
    const match = key != null ? existingByIdentity.get(key) : undefined;
    const base = {
      batch_id: batchId,
      email: c.email,
      name: c.name,
      phone: c.phone,
      fields: match ? { ...match.fields, ...c.fields } : c.fields,
    };
    return match ? { id: match.id, ...base } : base;
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

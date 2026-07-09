// Read-side helper for the encrypted refresh_token backfill.
//
// New rows are written encrypted by the OAuth callback. Rows that predate the
// encryption change are still plaintext; rather than a one-shot migration
// script (which can't hold the app key), we migrate them lazily: whenever a
// server route reads a plaintext refresh_token, we re-encrypt it in place. Once
// every stored token has been read at least once, no plaintext remains.
//
// The re-encrypt write is best-effort — a failure must not break the publish /
// share flow, since we already hold the usable plaintext for this request; the
// row simply gets migrated on the next read instead.

import type { SupabaseClient } from '@supabase/supabase-js';

import { decryptToken, encryptToken, isEncryptedToken } from './token-cipher';

// Returns the usable plaintext refresh_token for a stored value, re-encrypting
// legacy plaintext rows in place. `match` identifies the row to update
// (e.g. { user_id } or { email }) — must uniquely target the row that `stored`
// came from.
export async function decryptStoredRefreshToken(
  admin: SupabaseClient,
  stored: string,
  match: Record<string, string>,
): Promise<string> {
  if (isEncryptedToken(stored)) {
    return decryptToken(stored);
  }
  // Legacy plaintext → migrate at rest. Best-effort.
  try {
    let query = admin
      .from('user_google_oauth')
      .update({ refresh_token: encryptToken(stored) });
    for (const [column, value] of Object.entries(match)) {
      query = query.eq(column, value);
    }
    await query;
  } catch {
    // Swallow — the lazy migration retries on the next read.
  }
  return stored;
}

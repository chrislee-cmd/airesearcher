import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import {
  GoogleInvalidGrantError,
  refreshAccessToken,
  hasSheetsScope,
} from '@/lib/google-oauth';
import { decryptStoredRefreshToken } from '@/lib/crypto/oauth-token-store';
import {
  extractSpreadsheetId,
  readGoogleSheetValues,
} from '@/lib/share/google-sheets';
import { parseCandidateRows } from '@/lib/scheduling/candidates-parse';
import { upsertCandidatesIntoBatch } from '@/lib/scheduling/candidates-upsert';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Import candidates into a batch from a Google Sheet (super-admin only). Reuses
// the existing recruiting Google OAuth connection — no new auth flow. The
// admin pastes a sheet URL; we resolve their stored refresh_token (which must
// carry the Sheets scope, granted via `?share=1`), read the first tab, map
// header→column exactly like the file upload path, and upsert with the same
// identity-merge semantics.
//
// A 412 tells the client to (re)connect Google with the Sheets scope. The
// target sheet is user-owned, so we use the *user's* token — not the admin
// proxy (which can only see the admin Drive).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: batchId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: batch } = await admin
    .from('sched_batches')
    .select('id')
    .eq('id', batchId)
    .maybeSingle();
  if (!batch) {
    return NextResponse.json({ error: 'batch_not_found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const sheetUrl =
    body && typeof body === 'object' && typeof (body as { sheetUrl?: unknown }).sheetUrl === 'string'
      ? (body as { sheetUrl: string }).sheetUrl
      : '';
  const spreadsheetId = extractSpreadsheetId(sheetUrl);
  if (!spreadsheetId) {
    return NextResponse.json({ error: 'invalid_sheet_url' }, { status: 400 });
  }

  // Resolve the requesting super-admin's Google connection. Needs the Sheets
  // scope to read an arbitrary sheet they own.
  const { data: oauth } = await admin
    .from('user_google_oauth')
    .select('refresh_token, scope')
    .eq('user_id', user!.id)
    .maybeSingle();
  if (!oauth?.refresh_token) {
    return NextResponse.json({ error: 'google_not_connected' }, { status: 412 });
  }
  if (!hasSheetsScope(oauth.scope)) {
    return NextResponse.json({ error: 'reconsent_required' }, { status: 412 });
  }

  let accessToken: string;
  try {
    const refreshToken = await decryptStoredRefreshToken(
      admin,
      oauth.refresh_token,
      { user_id: user!.id },
    );
    const { access_token } = await refreshAccessToken(refreshToken);
    accessToken = access_token;
  } catch (e) {
    if (e instanceof GoogleInvalidGrantError) {
      return NextResponse.json({ error: 'reconsent_required' }, { status: 412 });
    }
    return NextResponse.json({ error: 'refresh_failed' }, { status: 502 });
  }

  let headers: string[];
  let rows: Record<string, string>[];
  try {
    const sheet = await readGoogleSheetValues(accessToken, spreadsheetId);
    headers = sheet.headers;
    rows = sheet.rows;
  } catch {
    return NextResponse.json({ error: 'sheet_read_failed' }, { status: 502 });
  }

  const parsed = parseCandidateRows(headers, rows);
  if (parsed.candidates.length === 0) {
    return NextResponse.json({ error: 'no_candidates' }, { status: 400 });
  }

  const result = await upsertCandidatesIntoBatch(admin, batchId, parsed.candidates);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json(
    { upserted: result.upserted },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

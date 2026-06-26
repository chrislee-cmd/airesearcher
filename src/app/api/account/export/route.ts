// POST /api/account/export — GDPR Art. 15 + 20 self-service data export.
//
// Builds a zip of every PII row tied to the caller (see lib/account-export.ts
// for the table list), uploads it to the private `account-exports` bucket,
// and returns a 24h signed URL. Always writes an `account_exported` row to
// `audit_log` so the trail of "who pulled their data when" is preserved.
//
// Rate limited per user — exports are expensive (full table scan across
// ~20 tables + storage upload) and one click per minute is more than enough
// for the legitimate Settings UI; a tighter limit also reduces blast
// radius if a session token is stolen.
import { NextResponse } from 'next/server';
import { zipSync, strToU8 } from 'fflate';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { collectAccountExport } from '@/lib/account-export';
import { logAudit } from '@/lib/audit';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const runtime = 'nodejs';
// The full export can do ~25 selects + ~N storage signs + a Storage upload.
// Generous timeout — `default 300s` already covers it on Vercel.
export const maxDuration = 300;

const BUCKET = 'account-exports';
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24; // 24h

function dateStamp(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}`;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 3 exports per user-hour. Tightest sensible cap — legitimate UI use is
  // one click, repeated only if the previous link expired or the user
  // re-runs after creating new data.
  const rl = await rateLimit(user.id, 'account-export', 3, '1 h');
  if (!rl.success) {
    return rateLimitResponse(rl);
  }

  const admin = createAdminClient();
  const bundle = await collectAccountExport(admin, {
    userId: user.id,
    userEmail: user.email ?? null,
  });

  // Zip layout: manifest.json + one file per table. Tables that came back
  // empty are still emitted so the consumer can rely on a fixed file set.
  const entries: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(bundle.manifest, null, 2)),
  };
  for (const [name, rows] of Object.entries(bundle.tables)) {
    entries[`${name}.json`] = strToU8(JSON.stringify(rows, null, 2));
  }

  const zipped = zipSync(entries);
  // zipSync returns a Uint8Array that shares memory with fflate's pool.
  // Copy into a clean ArrayBuffer before handing it to Storage so the
  // upload is decoupled from the library's internal lifetime.
  const zipBuf = new ArrayBuffer(zipped.byteLength);
  new Uint8Array(zipBuf).set(zipped);

  const now = new Date();
  const filename = `airesearcher-export-${user.id}-${dateStamp(now)}.zip`;
  // user-prefixed so future cleanup jobs (and any accidental list query)
  // are scoped to one user.
  const storageKey = `${user.id}/${filename}`;

  const uploadRes = await admin.storage.from(BUCKET).upload(storageKey, zipBuf, {
    contentType: 'application/zip',
    upsert: true,
  });
  if (uploadRes.error) {
    console.error('[account-export] upload failed', uploadRes.error);
    return NextResponse.json(
      { error: 'upload_failed', detail: uploadRes.error.message },
      { status: 500 },
    );
  }

  const signed = await admin.storage
    .from(BUCKET)
    .createSignedUrl(storageKey, SIGNED_URL_TTL_SECONDS, {
      download: filename,
    });
  if (signed.error || !signed.data?.signedUrl) {
    console.error('[account-export] sign failed', signed.error);
    return NextResponse.json(
      { error: 'sign_failed', detail: signed.error?.message ?? 'no_url' },
      { status: 500 },
    );
  }

  const expiresAt = new Date(
    Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
  ).toISOString();

  await logAudit({
    event_type: 'account_exported',
    user_id: user.id,
    actor_email: user.email ?? null,
    resource_type: 'account_export',
    resource_id: storageKey,
    metadata: {
      bucket: BUCKET,
      filename,
      size_bytes: zipped.byteLength,
      table_count: bundle.manifest.tables.length,
      expires_at: expiresAt,
    },
    request,
  });

  return NextResponse.json({
    url: signed.data.signedUrl,
    filename,
    size_bytes: zipped.byteLength,
    expires_at: expiresAt,
    tables: bundle.manifest.tables,
  });
}

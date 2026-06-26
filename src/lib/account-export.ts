// account-export.ts — GDPR Art. 15 (access) + Art. 20 (portability) bundler.
//
// Collects every PII row tied to a user across the public schema and the
// `audio-uploads` storage bucket, then returns a JSON-per-table map ready
// to be zipped by the /api/account/export route. The collector intentionally
// uses the service-role admin client because RLS would otherwise hide rows
// the user has the right to see (e.g. org rows for orgs they belong to but
// don't own). The route handler is the access boundary — it authenticates
// the session before invoking this helper.
//
// Security carve-outs (audit SEC-005):
//   - user_google_oauth.refresh_token → stripped (long-lived API credential)
//   - user_notion_oauth.access_token  → stripped (long-lived API credential)
//
// Storage attachments (transcript / video uploads) are surfaced as 24h
// signed URLs rather than embedded bytes — the bundle stays small and the
// user downloads the original media directly from Supabase Storage.
import type { SupabaseClient } from '@supabase/supabase-js';

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24; // 24h
const STORAGE_BUCKET_MEDIA = 'audio-uploads';

type Row = Record<string, unknown>;

export type AccountExportBundle = {
  manifest: {
    exported_at: string;
    user_id: string;
    user_email: string | null;
    schema_version: 1;
    note: string;
    tables: Array<{ name: string; row_count: number }>;
  };
  tables: Record<string, Row[]>;
};

async function selectByUser<T extends Row = Row>(
  admin: SupabaseClient,
  table: string,
  column: string,
  userId: string,
): Promise<T[]> {
  const { data, error } = await admin
    .from(table)
    .select('*')
    .eq(column, userId);
  if (error) {
    console.error('[account-export] select failed', { table, column, error });
    return [];
  }
  return (data ?? []) as T[];
}

async function selectByIn<T extends Row = Row>(
  admin: SupabaseClient,
  table: string,
  column: string,
  ids: Array<string | number>,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const { data, error } = await admin
    .from(table)
    .select('*')
    .in(column, ids);
  if (error) {
    console.error('[account-export] select-in failed', { table, column, error });
    return [];
  }
  return (data ?? []) as T[];
}

async function signMediaKey(
  admin: SupabaseClient,
  storageKey: string,
): Promise<string | null> {
  if (!storageKey) return null;
  const { data, error } = await admin.storage
    .from(STORAGE_BUCKET_MEDIA)
    .createSignedUrl(storageKey, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    console.error('[account-export] sign failed', { storageKey, error });
    return null;
  }
  return data.signedUrl;
}

async function attachSignedUrl(
  admin: SupabaseClient,
  rows: Row[],
): Promise<Row[]> {
  return Promise.all(
    rows.map(async (row) => {
      const key = typeof row.storage_key === 'string' ? row.storage_key : '';
      if (!key) return row;
      const signed_url = await signMediaKey(admin, key);
      // 24h expiry matches the bundle's own signed URL — both regenerate
      // together if the user re-runs the export.
      return {
        ...row,
        signed_url,
        signed_url_expires_at: new Date(
          Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
        ).toISOString(),
      };
    }),
  );
}

// Drops sensitive credential fields that the user has no right-to-access
// claim against — these are long-lived API secrets, not personal data.
function stripSecrets<K extends string>(rows: Row[], keys: K[]): Row[] {
  return rows.map((row) => {
    const next: Row = { ...row };
    for (const k of keys) delete next[k];
    return next;
  });
}

/**
 * Build a full per-user data bundle. Never throws on a single-table failure
 * — partial export is preferable to a 500 (the user still gets most of
 * their data). Each table's failure is logged with `[account-export]`.
 */
export async function collectAccountExport(
  admin: SupabaseClient,
  opts: { userId: string; userEmail: string | null },
): Promise<AccountExportBundle> {
  const { userId, userEmail } = opts;
  const tables: Record<string, Row[]> = {};

  // --- Identity ---
  tables.profiles = await selectByUser(admin, 'profiles', 'id', userId);
  tables.user_consents = await selectByUser(
    admin,
    'user_consents',
    'user_id',
    userId,
  );

  // --- Org membership ---
  const memberships = await selectByUser(
    admin,
    'organization_members',
    'user_id',
    userId,
  );
  tables.organization_members = memberships;
  const orgIds = Array.from(
    new Set(
      memberships
        .map((m) => (typeof m.org_id === 'string' ? m.org_id : null))
        .filter((v): v is string => Boolean(v)),
    ),
  );
  tables.organizations = await selectByIn(admin, 'organizations', 'id', orgIds);

  // --- Projects / folders ---
  tables.projects = await selectByUser(admin, 'projects', 'created_by', userId);
  tables.folders = await selectByUser(admin, 'folders', 'created_by', userId);

  // --- Media jobs (with 24h signed link to the original upload) ---
  const transcripts = await selectByUser(
    admin,
    'transcript_jobs',
    'user_id',
    userId,
  );
  tables.transcript_jobs = await attachSignedUrl(admin, transcripts);

  const videos = await selectByUser(admin, 'video_jobs', 'user_id', userId);
  tables.video_jobs = await attachSignedUrl(admin, videos);

  // --- Generative jobs ---
  tables.desk_jobs = await selectByUser(admin, 'desk_jobs', 'user_id', userId);

  const insightsJobs = await selectByUser(
    admin,
    'insights_jobs',
    'user_id',
    userId,
  );
  tables.insights_jobs = insightsJobs;
  const insightsJobIds = insightsJobs
    .map((j) => (typeof j.id === 'string' ? j.id : null))
    .filter((v): v is string => Boolean(v));
  tables.insights_quotes = await selectByIn(
    admin,
    'insights_quotes',
    'job_id',
    insightsJobIds,
  );
  tables.insights_clusters = await selectByIn(
    admin,
    'insights_clusters',
    'job_id',
    insightsJobIds,
  );
  tables.insights_cluster_quotes = await selectByIn(
    admin,
    'insights_cluster_quotes',
    'job_id',
    insightsJobIds,
  );
  tables.insights_tensions = await selectByIn(
    admin,
    'insights_tensions',
    'job_id',
    insightsJobIds,
  );
  tables.insights_contradictions = await selectByIn(
    admin,
    'insights_contradictions',
    'job_id',
    insightsJobIds,
  );
  tables.insights_chat_messages = await selectByIn(
    admin,
    'insights_chat_messages',
    'job_id',
    insightsJobIds,
  );

  // --- Voice concierge ---
  const voiceSessions = await selectByUser(
    admin,
    'voice_sessions',
    'user_id',
    userId,
  );
  tables.voice_sessions = voiceSessions;
  const voiceSessionIds = voiceSessions
    .map((s) => (typeof s.id === 'string' ? s.id : null))
    .filter((v): v is string => Boolean(v));
  tables.voice_messages = await selectByIn(
    admin,
    'voice_messages',
    'session_id',
    voiceSessionIds,
  );

  // --- Translate ---
  const translateSessions = await selectByUser(
    admin,
    'translate_sessions',
    'host_user_id',
    userId,
  );
  tables.translate_sessions = translateSessions;
  const translateSessionIds = translateSessions
    .map((s) => (typeof s.id === 'string' ? s.id : null))
    .filter((v): v is string => Boolean(v));
  tables.translate_messages = await selectByIn(
    admin,
    'translate_messages',
    'session_id',
    translateSessionIds,
  );

  // --- Probing (PR-12) ---
  tables.probing_questions = await selectByUser(
    admin,
    'probing_questions',
    'user_id',
    userId,
  );
  tables.probing_suggestions = await selectByUser(
    admin,
    'probing_suggestions',
    'user_id',
    userId,
  );

  // --- Billing ---
  tables.payments = await selectByUser(admin, 'payments', 'user_id', userId);
  tables.credit_transactions = await selectByUser(
    admin,
    'credit_transactions',
    'user_id',
    userId,
  );

  // --- Scheduler (the user as attendee — match by email). ---
  if (userEmail) {
    const { data, error } = await admin
      .from('scheduler_bookings')
      .select('*')
      .eq('email', userEmail);
    if (error) {
      console.error('[account-export] scheduler_bookings select failed', error);
      tables.scheduler_bookings = [];
    } else {
      // cancel_token is the attendee's self-service handle — already theirs.
      tables.scheduler_bookings = (data ?? []) as Row[];
    }
  } else {
    tables.scheduler_bookings = [];
  }

  // --- OAuth — metadata only, no credentials. ---
  tables.user_google_oauth = stripSecrets(
    await selectByUser(admin, 'user_google_oauth', 'user_id', userId),
    ['refresh_token'],
  );
  tables.user_notion_oauth = stripSecrets(
    await selectByUser(admin, 'user_notion_oauth', 'user_id', userId),
    ['access_token'],
  );

  // --- Audit trail (the user's own events). ---
  tables.audit_log = await selectByUser(admin, 'audit_log', 'user_id', userId);

  const manifest: AccountExportBundle['manifest'] = {
    exported_at: new Date().toISOString(),
    user_id: userId,
    user_email: userEmail,
    schema_version: 1,
    note:
      'GDPR Art. 15 (access) + Art. 20 (portability) export. signed_url ' +
      'fields expire 24h after export; re-run the export to regenerate. ' +
      'OAuth refresh/access tokens are intentionally omitted (long-lived ' +
      'API credentials, not personal data).',
    tables: Object.keys(tables)
      .sort()
      .map((name) => ({ name, row_count: tables[name]?.length ?? 0 })),
  };

  return { manifest, tables };
}

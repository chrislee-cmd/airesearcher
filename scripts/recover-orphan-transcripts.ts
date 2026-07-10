// Orphan transcript recovery — one-off ops script.
//
// WHY this exists — before #549 (row-first handoff), an audio upload could land
// in the `audio-uploads` bucket while its `transcript_jobs` row was never
// created (silent gate/batch failure). The file then "disappeared": the user
// paid, the audio is in storage, but nothing surfaces it. This script finds
// those orphans (storage object with NO matching transcript_jobs.storage_key)
// and idempotently re-creates a row so the file reappears in the user's list
// (#546) and can be re-transcribed via the existing retry path.
//
// It mirrors scripts/backfill-recruiting-criteria.ts's self-contained pattern:
// plain @supabase/supabase-js with the service-role key, so it runs under
// `node --experimental-strip-types` without pulling the Next.js server module
// graph (@sentry/nextjs, @/env, etc).
//
// APPROVAL GATE — see docs/TRANSCRIPT_ORPHAN_RECOVERY.md. prod writes are
// jarvis/admin-only, after explicit user approval. The default is read-only.
//   (no flag)   list orphans + resolved org + validation warnings. No writes.
//   --dry-run   also print the exact insert payloads --commit would write. No writes.
//   --commit    idempotently INSERT recovery rows. Writes. (approval-gated)
// Scope with --limit N, --user <user_id>.
//
// RECOVERY SHAPE (conservative default — see runbook §3): rows are created with
//   status='error', error_message='recovered_orphan'
// so the file surfaces as a retryable failure. The user (or admin) then hits
// the existing /api/transcripts/jobs/[id]/retry, which re-issues a signed URL
// and re-dispatches (ElevenLabs auto-detect, robust across languages). We do
// NOT create status='submitting' rows here: without a dispatch trigger that
// would just recreate the stuck-'submitting' state Part 0-2 cleans up.
//
// RUN (from the repo/worktree root, with .env.local present):
//   node --experimental-strip-types --env-file=.env.local \
//     scripts/recover-orphan-transcripts.ts                 # diagnose (read-only)
//   node --experimental-strip-types --env-file=.env.local \
//     scripts/recover-orphan-transcripts.ts --dry-run
//   node --experimental-strip-types --env-file=.env.local \
//     scripts/recover-orphan-transcripts.ts --commit        # approval-gated

import { createClient } from '@supabase/supabase-js';

const BUCKET = 'audio-uploads';
const PAGE = 1000;

// Conservative recovery defaults. ElevenLabs Scribe v2 auto-detect handles
// every language, so a retry on this row re-dispatches correctly regardless of
// what the original upload language was (which the orphan doesn't record).
const RECOVERY_PROVIDER = 'elevenlabs';
const RECOVERY_MODEL = 'scribe_v2';
const RECOVERY_MODE = 'research';

type Flags = {
  commit: boolean;
  dryRun: boolean;
  help: boolean;
  limit: number | undefined;
  user: string | undefined;
};

function parseArgs(argv: string[]): Flags {
  const readValue = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const limitRaw = readValue('--limit');
  return {
    commit: argv.includes('--commit'),
    dryRun: argv.includes('--dry-run'),
    help: argv.includes('--help') || argv.includes('-h'),
    limit: limitRaw ? Number.parseInt(limitRaw, 10) : undefined,
    user: readValue('--user'),
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing env ${name}. Run with --env-file=.env.local (or export it).`,
    );
  }
  return v;
}

type StorageObject = {
  key: string; // full path, e.g. `${user_id}/${ts}-${filename}`
  userId: string;
  filename: string;
  sizeBytes: number | null;
  mimeType: string | null;
  createdAt: string | null;
};

// Loose slice of the storage list() row shape.
type ListEntry = {
  name: string;
  id: string | null; // null => folder placeholder, not a file
  created_at?: string | null;
  metadata?: { size?: number; mimetype?: string } | null;
};

type SupabaseClient = ReturnType<typeof createClient>;

// Recursively list every object under the bucket. Folders (id === null) are
// descended into; files (id !== null) are collected with their full key.
async function listAllObjects(supabase: SupabaseClient): Promise<StorageObject[]> {
  const out: StorageObject[] = [];

  async function walk(prefix: string): Promise<void> {
    let offset = 0;
    for (;;) {
      const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
        limit: PAGE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw new Error(`storage.list('${prefix}') failed: ${error.message}`);
      const entries = (data ?? []) as ListEntry[];
      for (const e of entries) {
        const full = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.id === null) {
          // folder → recurse
          await walk(full);
        } else {
          const segs = full.split('/');
          out.push({
            key: full,
            userId: segs[0] ?? '',
            filename: segs[segs.length - 1] ?? full,
            sizeBytes: typeof e.metadata?.size === 'number' ? e.metadata.size : null,
            mimeType: e.metadata?.mimetype ?? null,
            createdAt: e.created_at ?? null,
          });
        }
      }
      if (entries.length < PAGE) break;
      offset += PAGE;
    }
  }

  await walk('');
  return out;
}

// All storage_keys that already have a transcript_jobs row (paginated).
async function existingStorageKeys(supabase: SupabaseClient): Promise<Set<string>> {
  const keys = new Set<string>();
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('transcript_jobs')
      .select('storage_key')
      .not('storage_key', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`select transcript_jobs failed: ${error.message}`);
    const rows = (data ?? []) as { storage_key: string | null }[];
    for (const r of rows) if (r.storage_key) keys.add(r.storage_key);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return keys;
}

// Resolve a user's active org the same way the app does: earliest-joined
// membership (organization_members ordered by created_at ASC → first). Returns
// null when the user has no membership (→ skip + manual review).
async function resolveOrgId(
  supabase: SupabaseClient,
  userId: string,
  cache: Map<string, string | null>,
): Promise<string | null> {
  if (cache.has(userId)) return cache.get(userId) ?? null;
  const { data, error } = await supabase
    .from('organization_members')
    .select('org_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(`resolve org for ${userId} failed: ${error.message}`);
  const rows = (data ?? []) as { org_id: string | null }[];
  const orgId = rows[0]?.org_id ?? null;
  cache.set(userId, orgId);
  return orgId;
}

type Orphan = StorageObject & { orgId: string | null };

function fmtSize(bytes: number | null): string {
  if (bytes === null) return '?';
  if (bytes === 0) return '0 (⚠ empty)';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)}MB` : `${(bytes / 1024).toFixed(0)}KB`;
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(
      'Usage: recover-orphan-transcripts.ts [--dry-run|--commit] [--limit N] [--user <id>]\n' +
        'See docs/TRANSCRIPT_ORPHAN_RECOVERY.md. --commit is approval-gated (jarvis/admin only).',
    );
    return;
  }

  const supabase = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const mode = flags.commit ? 'COMMIT' : flags.dryRun ? 'DRY-RUN' : 'DIAGNOSE';
  console.log(`\n=== orphan transcript recovery — ${mode} ===\n`);

  const [objects, existing] = await Promise.all([
    listAllObjects(supabase),
    existingStorageKeys(supabase),
  ]);
  console.log(
    `storage objects: ${objects.length} · existing transcript_jobs keys: ${existing.size}`,
  );

  let orphanObjs = objects.filter((o) => !existing.has(o.key));
  if (flags.user) orphanObjs = orphanObjs.filter((o) => o.userId === flags.user);
  orphanObjs.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  if (flags.limit !== undefined) orphanObjs = orphanObjs.slice(0, flags.limit);

  const orgCache = new Map<string, string | null>();
  const orphans: Orphan[] = [];
  for (const o of orphanObjs) {
    orphans.push({ ...o, orgId: await resolveOrgId(supabase, o.userId, orgCache) });
  }

  console.log(`\norphans found: ${orphans.length}\n`);
  for (const o of orphans) {
    const flagsStr = [
      o.orgId ? '' : 'NO-ORG(skip)',
      o.sizeBytes === 0 ? 'EMPTY(skip)' : '',
    ]
      .filter(Boolean)
      .join(' ');
    console.log(
      `  ${o.createdAt ?? '?'}  ${fmtSize(o.sizeBytes).padEnd(14)}  ${o.userId}  ${o.filename}` +
        (flagsStr ? `  [${flagsStr}]` : ''),
    );
  }

  // Recoverable = has a resolvable org AND a non-empty file.
  const recoverable = orphans.filter((o) => o.orgId && o.sizeBytes !== 0);
  const skipped = orphans.length - recoverable.length;
  console.log(
    `\nrecoverable: ${recoverable.length}` +
      (skipped ? `  ·  skipped (no-org / empty): ${skipped}` : ''),
  );

  if (mode === 'DIAGNOSE') {
    console.log('\nread-only. Re-run with --dry-run to preview inserts, --commit to write.\n');
    return;
  }

  const payloads = recoverable.map((o) => ({
    org_id: o.orgId as string,
    user_id: o.userId,
    storage_key: o.key,
    filename: o.filename,
    size_bytes: o.sizeBytes,
    mime_type: o.mimeType,
    provider: RECOVERY_PROVIDER,
    model: RECOVERY_MODEL,
    mode: RECOVERY_MODE,
    status: 'error',
    error_message: 'recovered_orphan',
  }));

  if (mode === 'DRY-RUN') {
    console.log('\n--- insert payloads (--commit would write these) ---');
    for (const p of payloads) console.log(JSON.stringify(p));
    console.log('\ndry-run. No writes.\n');
    return;
  }

  // COMMIT — idempotent per-row insert. transcript_jobs has NO unique constraint
  // on storage_key, so we select-check before each insert to stay re-run safe.
  console.log('\n--- COMMIT: idempotent insert ---');
  let created = 0;
  let already = 0;
  let failed = 0;
  for (const p of payloads) {
    const { data: dupe, error: checkErr } = await supabase
      .from('transcript_jobs')
      .select('id')
      .eq('storage_key', p.storage_key)
      .limit(1);
    if (checkErr) {
      console.log(`  FAIL(check) ${p.storage_key}: ${checkErr.message}`);
      failed += 1;
      continue;
    }
    if ((dupe ?? []).length > 0) {
      console.log(`  skip(exists) ${p.storage_key}`);
      already += 1;
      continue;
    }
    const { error: insErr } = await supabase.from('transcript_jobs').insert(p);
    if (insErr) {
      console.log(`  FAIL(insert) ${p.storage_key}: ${insErr.message}`);
      failed += 1;
      continue;
    }
    console.log(`  created ${p.storage_key}`);
    created += 1;
  }
  console.log(
    `\ndone. created: ${created} · already-existed: ${already} · failed: ${failed}\n` +
      'Re-transcribe via the user retry path (#546) or POST /api/transcripts/jobs/[id]/retry.\n',
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

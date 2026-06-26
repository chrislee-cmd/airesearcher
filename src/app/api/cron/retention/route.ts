// PR-SEC5 — daily retention cron (GDPR Art. 5(1)(e) storage limitation).
//
// Runs five cleanup_* RPCs defined in
// 20260626140000_account_delete_retention.sql. Each RPC returns the row
// count it deleted; the response body aggregates them so the Vercel logs
// show "what got pruned today" without a follow-up DB query.
//
// Auth: standard Vercel cron pattern — request must carry
//   Authorization: Bearer <CRON_SECRET>
// matching the env var. CRON_SECRET is enforced as required in env.ts so
// it is always present at runtime (PR-SEC21 fail-closed).

import { NextResponse } from 'next/server';
import { env } from '@/env';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Retention windows. Centralized so a future "privacy policy says 60 days
// for voice" change is one constant edit, not a hunt across SQL + TS.
const VOICE_SESSIONS_DAYS = 30;
const TRANSLATE_MESSAGES_DAYS = 30;
const AUDIT_LOG_DAYS = 365;

function authorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? '';
  return header === `Bearer ${env.CRON_SECRET}`;
}

type CleanupResult = {
  trial_fingerprints: number;
  voice_sessions: number;
  translate_messages: number;
  orphaned_insights_jobs: number;
  audit_log: number;
};

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const result: CleanupResult = {
    trial_fingerprints: 0,
    voice_sessions: 0,
    translate_messages: 0,
    orphaned_insights_jobs: 0,
    audit_log: 0,
  };
  const errors: Array<{ step: keyof CleanupResult; message: string }> = [];

  // Each RPC is independent — a failure on one shouldn't block the
  // others. Collect errors but keep walking so a transient blip on
  // voice_sessions doesn't strand the audit_log purge.
  async function step(
    key: keyof CleanupResult,
    run: () => Promise<{ data: number | null; error: { message: string } | null }>,
  ): Promise<void> {
    const { data, error } = await run();
    if (error) {
      errors.push({ step: key, message: error.message });
      return;
    }
    result[key] = data ?? 0;
  }

  await step('trial_fingerprints', async () =>
    admin.rpc('cleanup_trial_fingerprints'),
  );
  await step('voice_sessions', async () =>
    admin.rpc('cleanup_voice_sessions', { p_days: VOICE_SESSIONS_DAYS }),
  );
  await step('translate_messages', async () =>
    admin.rpc('cleanup_translate_messages', { p_days: TRANSLATE_MESSAGES_DAYS }),
  );
  await step('orphaned_insights_jobs', async () =>
    admin.rpc('cleanup_orphaned_insights_jobs'),
  );
  await step('audit_log', async () =>
    admin.rpc('cleanup_audit_log', { p_days: AUDIT_LOG_DAYS }),
  );

  const status = errors.length === 0 ? 200 : 207;
  return NextResponse.json({ ok: errors.length === 0, result, errors }, { status });
}

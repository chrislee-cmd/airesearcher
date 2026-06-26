// audit.ts — server-side helper for writing audit_log rows.
//
// Use this from any server-only context (route handlers, server actions,
// webhooks) when a security/privacy-relevant event happens. The function
// uses the service-role client so writes bypass RLS, which is intentional:
// RLS has no insert policy for audit_log, so only this helper can write.
//
// Never import this from client components — it would leak the service
// role key into the bundle. The admin client already throws at runtime if
// invoked without SUPABASE_SERVICE_ROLE_KEY, which only exists on the
// server.

import { createAdminClient } from '@/lib/supabase/admin';
import { getClientIp } from '@/lib/rate-limit';

// Canonical event_type values. Extending this union is the SSOT — the
// audit_log migration comment and the ROPA in docs/legal/ both point
// here. Group conventions:
//   - consent_*               PR-SEC7 + PR-SEC12 (privacy policy version bumps)
//   - account_deletion_*      PR-SEC5 + PR-SEC12 (Art. 17 erasure flow)
//   - data_export_*           PR-SEC6 + PR-SEC12 (Art. 15 / 20 portability)
//   - login_*                 PR-SEC7 (auth)
//   - permission_denied       PR-SEC7 (app-level deny)
//   - rls_violation_attempted PR-SEC12 (DB-level RLS reject)
//   - rate_limited            PR-SEC4 (Upstash limiter)
//   - admin_action            PR-SEC7 (member role / remove etc.)
//   - admin_action_error      PR-SEC19 (admin route runtime error)
//   - admin_impersonation     PR-SEC12 (admin views as user — reserved)
//   - public_booking_error    PR-SEC19 (public booking route runtime error)
//   - config_changed          PR-SEC12 (cron / env / migration ops)
export type AuditEventType =
  | 'consent_granted'
  | 'consent_revoked'
  | 'consent_version_updated'
  | 'account_deletion_requested'
  | 'account_deletion_completed'
  | 'data_export_requested'
  | 'data_export_completed'
  | 'login_success'
  | 'login_failure'
  | 'permission_denied'
  | 'rls_violation_attempted'
  | 'rate_limited'
  | 'admin_action'
  | 'admin_action_error'
  | 'admin_impersonation'
  | 'public_booking_error'
  | 'config_changed';

export type AuditOpts = {
  event_type: AuditEventType;
  user_id?: string | null;
  org_id?: string | null;
  // Captured separately so the row survives auth.users deletion.
  actor_email?: string | null;
  resource_type?: string | null;
  resource_id?: string | null;
  metadata?: Record<string, unknown>;
  // When passed, IP / user-agent are extracted from the request headers.
  request?: Request;
};

// Reuse the rate-limiter's hardened helper: first-hop XFF trust is gated
// to `process.env.VERCEL === '1'` so non-Vercel environments can't be
// spoofed. We normalize the 'unknown' sentinel back to null since `ip` is
// a nullable text column in audit_log.
function extractIp(request: Request): string | null {
  const ip = getClientIp(request);
  return ip === 'unknown' ? null : ip;
}

/**
 * Append one row to `public.audit_log`. Never throws — audit failures
 * must not break the user-visible flow. Errors are logged so they show
 * up in the Vercel function logs.
 */
export async function logAudit(opts: AuditOpts): Promise<void> {
  const { request, metadata, ...rest } = opts;
  const ip = request ? extractIp(request) : null;
  const userAgent = request ? request.headers.get('user-agent') : null;

  try {
    const admin = createAdminClient();
    const { error } = await admin.from('audit_log').insert({
      event_type: rest.event_type,
      user_id: rest.user_id ?? null,
      org_id: rest.org_id ?? null,
      actor_email: rest.actor_email ?? null,
      resource_type: rest.resource_type ?? null,
      resource_id: rest.resource_id ?? null,
      metadata: metadata ?? {},
      ip,
      user_agent: userAgent,
    });
    if (error) {
      console.error('[audit] insert failed', {
        event: rest.event_type,
        code: error.code,
        message: error.message,
      });
    }
  } catch (err) {
    console.error('[audit] insert threw', {
      event: rest.event_type,
      err,
    });
  }
}

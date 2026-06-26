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

export type AuditEventType =
  | 'consent_granted'
  | 'consent_revoked'
  | 'account_deleted'
  | 'account_exported'
  | 'login_success'
  | 'login_failure'
  | 'permission_denied'
  | 'rate_limited'
  | 'admin_action';

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

// Best-effort IP extraction. Vercel proxies set x-forwarded-for; we take
// the first hop (client). Falls back to x-real-ip and finally null.
function extractIp(request: Request): string | null {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return request.headers.get('x-real-ip');
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

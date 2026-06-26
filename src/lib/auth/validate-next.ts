// Path-only allow-list for the `?next=` redirect target on /auth/callback.
// Rejects absolute URLs (`https://...`) and protocol-relative URLs (`//host`),
// both of which `new URL(input, origin)` would resolve to an off-site host —
// the open-redirect surface from SEC-001 (security audit 2026-06-26).
export function validateNext(next: string | null | undefined): string | null {
  if (typeof next !== 'string' || next.length === 0) return null;
  if (!next.startsWith('/')) return null;
  if (next.startsWith('//')) return null;
  if (next.startsWith('/\\')) return null;
  return next;
}

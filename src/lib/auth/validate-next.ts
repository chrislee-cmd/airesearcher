import { routing } from '@/i18n/routing';

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

// Split a leading supported-locale segment off a same-origin path.
//   '/ko/invite/accept' → { locale: 'ko', pathname: '/invite/accept' }
//   '/canvas'           → { locale: null, pathname: '/canvas' }
// Only the prefix judgement changes here — the open-redirect semantics live in
// validateNext/safeNext and stay untouched (callers pass an already-safe path).
export function splitLocalePrefix(path: string): {
  locale: string | null;
  pathname: string;
} {
  const seg = path.split('/')[1];
  if ((routing.locales as readonly string[]).includes(seg)) {
    return { locale: seg, pathname: path.slice(seg.length + 1) || '/' };
  }
  return { locale: null, pathname: path };
}

// Locale-aware `next` normalizer for the OAuth redirectTo target. If `next`
// already begins with a supported locale (`/ko|en|ja|th/…`) it is returned
// verbatim — re-prefixing it would produce the `/ko/ko/…` double-locale 404
// that strands the invite round-trip. Otherwise the active locale is prepended
// as before.
export function localizeNext(next: string, locale: string): string {
  return splitLocalePrefix(next).locale ? next : `/${locale}${next}`;
}

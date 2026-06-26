// consent.ts — shared consent constants + helpers.
//
// CONSENT_VERSION bumps when the privacy / terms text changes materially.
// Existing rows in user_consents are not edited; instead the app prompts
// users with stale versions to re-consent. The version string mirrors the
// EFFECTIVE_DATE on /legal/privacy and /legal/terms (kept in sync by
// convention).

export const CONSENT_VERSION = '2026-05-23';

export type ConsentType =
  | 'privacy_policy'
  | 'terms_of_service'
  | 'marketing'
  | 'analytics'
  | 'llm_processing';

export const REQUIRED_SIGNUP_CONSENTS: ConsentType[] = [
  'privacy_policy',
  'terms_of_service',
];

// Local-storage key for the cookie consent banner. Kept in one place so
// the banner and any future "reset cookie preferences" UI agree.
export const COOKIE_CONSENT_STORAGE_KEY = 'rm-cookie-consent-v1';

// Short-lived cookie set before the Google OAuth round-trip so the
// /auth/callback route can record the user's signup consents once the
// session is exchanged. 10-minute expiry covers the OAuth round-trip;
// the callback deletes the cookie immediately after reading it.
export const OAUTH_CONSENT_COOKIE = 'rm_oauth_consent';
export const OAUTH_CONSENT_COOKIE_MAX_AGE_S = 60 * 10;

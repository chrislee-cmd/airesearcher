// Client-safe device-level analytics opt-out, shared by the PostHog and
// Mixpanel providers so both SDKs read one source of truth.
//
// Why device-level (not just account-level): with PostHog's
// `person_profiles: 'identified_only'`, anonymous pageviews are still captured,
// so excluding an *account* is not enough to keep our own landing visits out of
// the numbers. We need to exclude the *browser* — even before login and even
// for anonymous visits after logout.
//
// Two triggers feed one persisted flag (localStorage, so it survives reloads
// and anonymous visits):
//   1. Internal account login (`isSuperAdminEmail`) — marks this browser
//      permanently once we've ever logged in on it.
//   2. Manual URL param `?analytics_optout=1` / `?analytics_optin=1` — for
//      anonymous / incognito / pre-login devices. Bookmarkable.
//
// Note on PostHog: `posthog.opt_out_capturing()` already persists in PostHog's
// own storage and suppresses capture on subsequent page loads, so the flag here
// is primarily for cross-SDK coordination with Mixpanel (whose consent flow
// calls `opt_in_tracking()` on init, which would otherwise clear a prior
// opt-out — see mixpanel-provider.tsx).

const OPTOUT_KEY = 'analytics_device_optout';

export function isDeviceOptedOut(): boolean {
  try {
    return window.localStorage.getItem(OPTOUT_KEY) === '1';
  } catch {
    // localStorage unavailable (private mode edge case) — treat as not opted
    // out; the manual param path will still call the SDK opt-out directly.
    return false;
  }
}

function setDeviceOptOut(value: boolean) {
  try {
    if (value) window.localStorage.setItem(OPTOUT_KEY, '1');
    else window.localStorage.removeItem(OPTOUT_KEY);
  } catch {
    // best-effort — see note in isDeviceOptedOut
  }
}

// Permanently mark this browser as opted out (internal account path).
export function markDeviceOptedOut() {
  setDeviceOptOut(true);
}

// Reads `?analytics_optout=1` / `?analytics_optin=1` from the current URL and
// updates the persisted flag. Returns what changed so the caller can log a
// one-line confirmation. No-op (returns null) when neither param is present.
export function readOptOutParam(): 'optout' | 'optin' | null {
  try {
    const params = new URL(window.location.href).searchParams;
    if (params.get('analytics_optout') === '1') {
      setDeviceOptOut(true);
      return 'optout';
    }
    if (params.get('analytics_optin') === '1') {
      setDeviceOptOut(false);
      return 'optin';
    }
  } catch {
    // malformed URL / no window — no-op
  }
  return null;
}

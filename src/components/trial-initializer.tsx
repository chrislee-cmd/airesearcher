'use client';

import { useEffect, useRef } from 'react';

// Fires once per tab to register the device fingerprint with the trial
// policy. Idempotent on the server — if the org has already been seen with
// this hash, the API returns without changing trial_ends_at. Mounted at the
// app layout level so every authenticated page contributes the signal.
//
// We also keep a localStorage marker so we don't issue redundant POSTs across
// reloads when the policy has already run for this device.
const STORAGE_KEY = 'trial-init:v1';

export function TrialInitializer({ enabled }: { enabled: boolean }) {
  const sentRef = useRef(false);

  useEffect(() => {
    if (!enabled || sentRef.current) return;
    sentRef.current = true;

    let alreadyDone = false;
    try {
      alreadyDone = window.localStorage.getItem(STORAGE_KEY) === 'done';
    } catch {
      // privacy-mode → just skip the marker, server is still idempotent
    }
    if (alreadyDone) return;

    // Cross-browser-stable signals. We deliberately do NOT include
    // navigator.userAgent because UA differs per browser on the same
    // machine, defeating the whole purpose. Hardware-class signals
    // (resolution, CPU cores, color depth, OS, timezone) are the same
    // across Chrome/Safari/Firefox on a given device.
    const ratio = Math.min(8, Math.round((window.devicePixelRatio || 1) * 10) / 10);
    const screenStr = `${window.screen?.width ?? 0}x${window.screen?.height ?? 0}@${ratio}`;
    const tz = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      } catch {
        return '';
      }
    })();
    const navUaData = (navigator as Navigator & {
      userAgentData?: { platform?: string };
    }).userAgentData;
    const os = navUaData?.platform || guessOsFromPlatform(navigator.platform);
    const cores = (navigator as Navigator).hardwareConcurrency ?? 0;
    const colorDepth = window.screen?.colorDepth ?? 0;

    void fetch('/api/auth/trial-init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ screen: screenStr, tz, os, cores, colorDepth }),
    })
      .then((res) => {
        if (res.ok) {
          try {
            window.localStorage.setItem(STORAGE_KEY, 'done');
          } catch {
            // ignore
          }
        }
      })
      .catch(() => {
        // Silent — the policy will retry on the next session.
      });
  }, [enabled]);

  return null;
}

// Best-effort OS family from the legacy `navigator.platform` string when the
// modern userAgentData API isn't available. Lowercased for stability across
// browser quirks.
function guessOsFromPlatform(p: string | undefined): string {
  if (!p) return '';
  const s = p.toLowerCase();
  if (s.includes('mac')) return 'macos';
  if (s.includes('win')) return 'windows';
  if (s.includes('linux')) return 'linux';
  if (s.includes('iphone') || s.includes('ipad')) return 'ios';
  if (s.includes('android')) return 'android';
  return s.slice(0, 32);
}

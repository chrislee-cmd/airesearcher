// Client-safe formatter for the "전화번호 확인 필요" toast (card 604). Both upload
// surfaces (journey-intake-band, recruiting-scheduling-client) share it so the
// flagged-phone notice reads identically. Pure — takes the flagged list + a
// translator, returns a single toast string (or null when nothing is flagged).

import type { FlaggedPhone } from './candidates-parse';

// The next-intl translator shape we need (key + optional interpolation values).
type Translate = (key: string, values?: Record<string, string | number>) => string;

const MAX_SHOWN = 5;

export function flaggedPhonesToast(
  flagged: FlaggedPhone[] | undefined,
  t: Translate,
): string | null {
  if (!flagged || flagged.length === 0) return null;
  const shown = flagged.slice(0, MAX_SHOWN).map((f) => {
    const who = f.name?.trim() || t('phoneFlagNoName');
    const reason = t(`phoneReason_${f.reason}`);
    return `${who}(${f.rawPhone || '—'} · ${reason})`;
  });
  const more = flagged.length - shown.length;
  const list =
    more > 0
      ? `${shown.join(', ')} ${t('phoneFlagMore', { count: more })}`
      : shown.join(', ');
  return t('phoneCheckNeeded', { count: flagged.length, list });
}

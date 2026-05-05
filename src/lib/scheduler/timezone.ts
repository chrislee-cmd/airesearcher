// Curated IANA timezone list shown in the requirement form. Keep small —
// scheduler is for face-to-face research, not a global meeting tool.
export const TIMEZONES: { id: string; key: string }[] = [
  { id: 'Asia/Seoul',          key: 'seoul' },
  { id: 'Asia/Tokyo',          key: 'tokyo' },
  { id: 'Asia/Singapore',      key: 'singapore' },
  { id: 'Asia/Kuala_Lumpur',   key: 'kualaLumpur' },
  { id: 'Asia/Bangkok',        key: 'bangkok' },
  { id: 'America/Los_Angeles', key: 'losAngeles' },
  { id: 'America/New_York',    key: 'newYork' },
  { id: 'Europe/London',       key: 'london' },
  { id: 'UTC',                 key: 'utc' },
];

// Detect the viewer's IANA timezone. Falls back to Asia/Seoul on the rare
// runtime that doesn't expose it.
export function getViewerTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
  } catch {
    return 'Asia/Seoul';
  }
}

// Format a timezone as e.g. "GMT+8" using Intl. Returns just the offset chunk
// for use in compact UI like "Asia/Seoul (GMT+9)".
export function tzShortOffset(tz: string, on: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    }).formatToParts(on);
    const tzn = parts.find((p) => p.type === 'timeZoneName')?.value;
    return tzn ?? '';
  } catch {
    return '';
  }
}

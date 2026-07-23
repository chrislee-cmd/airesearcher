'use client';

import { useTranslations } from 'next-intl';

// Full-screen notice for the recruiting-scheduling share link.
//   * default ('invalid') — the token didn't resolve to a candidate (dead/
//     expired link). Deliberately generic: it never reveals whether the token
//     ever existed, only that this link can't be opened.
//   * 'no_phone' — the candidate has no phone on file, so the tail gate can't
//     verify identity → entry is blocked (2026-07-22 policy). Directs the
//     participant to the host instead of trapping them at an unpassable gate.
export function ParticipantScheduleNotice({
  reason = 'invalid',
}: {
  reason?: 'invalid' | 'no_phone';
}) {
  const t = useTranslations('SchedulingParticipant');
  const titleKey = reason === 'no_phone' ? 'gateNoPhoneTitle' : 'invalidTitle';
  const bodyKey = reason === 'no_phone' ? 'gateNoPhoneBody' : 'invalidBody';
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold text-ink">{t(titleKey)}</h1>
      <p className="text-sm text-mute">{t(bodyKey)}</p>
    </div>
  );
}

'use client';

import { useTranslations } from 'next-intl';

// Shown when a recruiting-scheduling share link is invalid/expired (the token
// didn't resolve to a candidate). Deliberately generic — it never reveals
// whether the token ever existed, only that this link can't be opened.
export function ParticipantScheduleNotice() {
  const t = useTranslations('SchedulingParticipant');
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold text-ink">{t('invalidTitle')}</h1>
      <p className="text-sm text-mute">{t('invalidBody')}</p>
    </div>
  );
}

'use client';

// Dead-link / already-ended notice for the anonymous AI-UT participant page
// (624). Rendered under the same NextIntlClientProvider as ParticipantCapture
// so it reads localized copy through useTranslations — no data about the
// session is shown, only a friendly message.

import { useTranslations } from 'next-intl';

export function ParticipantNotice({
  variant,
}: {
  variant: 'invalid' | 'ended';
}) {
  const t = useTranslations('UtParticipant');
  return (
    <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col px-4 pb-16 pt-10">
      <div className="rounded-md border border-line bg-paper p-6">
        <h1 className="text-xl font-semibold tracking-[-0.01em] text-ink-2">
          {t(`notice.${variant}.heading`)}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-mute">
          {t(`notice.${variant}.body`)}
        </p>
      </div>
    </main>
  );
}

'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { GoogleSignInButton } from './google-signin-button';
import { EmailPasswordForm } from './email-password-form';

export function LoginDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('Auth');

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[420px] border border-line bg-paper p-9 [border-radius:4px]"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[20px] font-bold tracking-[-0.018em] text-ink-2">
              {t('signInTitle')}
            </h2>
            <p className="mt-2 text-[12.5px] leading-[1.7] text-mute">
              {t('signInSubtitle')}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-1 px-2 py-1 text-[14px] text-mute-soft transition-colors duration-[120ms] hover:text-ink-2"
          >
            ✕
          </button>
        </div>

        <div className="mt-7">
          <GoogleSignInButton label={t('google')} />
        </div>

        <div className="my-6 flex items-center gap-3">
          <span className="h-px flex-1 bg-line" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
            {t('or')}
          </span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <EmailPasswordForm />
      </div>
    </div>
  );
}

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-8 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{t('signInTitle')}</h2>
            <p className="mt-1 text-sm text-neutral-500">{t('signInSubtitle')}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-1 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
          >
            ✕
          </button>
        </div>

        <div className="mt-6">
          <GoogleSignInButton label={t('google')} />
        </div>

        <div className="my-5 flex items-center gap-3 text-xs text-neutral-400">
          <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
          <span>{t('or')}</span>
          <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
        </div>

        <EmailPasswordForm />
      </div>
    </div>
  );
}

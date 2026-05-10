'use client';

import { useEffect, useRef, useState } from 'react';
import { Link, useRouter, usePathname } from '@/i18n/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { useTransition } from 'react';
import { formatTrialRemaining, usePaywall } from '@/components/paywall-provider';
import { track } from '@/components/mixpanel-provider';

type Props = {
  email: string | null;
  credits: number | null;
  isAuthed: boolean;
  isSuperAdmin?: boolean;
};

// The footer block of the sidebar. Shows account name + credits, and a
// gear button that opens a popover with language / members / credits /
// sign-out — all the things that used to live in the topbar.
export function SidebarAccount({ email, credits, isAuthed, isSuperAdmin }: Props) {
  const t = useTranslations('Sidebar');
  const tCommon = useTranslations('Common');
  const tAuth = useTranslations('Auth');
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const { status } = usePaywall();

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!popRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  function changeLocale(next: 'ko' | 'en') {
    if (next === locale) return;
    track('settings_locale_change_click', { from: locale, to: next });
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  async function signOut() {
    track('auth_signout_click');
    const supabase = createClient();
    await supabase.auth.signOut();
    setOpen(false);
    router.replace('/dashboard');
    router.refresh();
  }

  if (!isAuthed) {
    return (
      <div className="border-t border-line-soft px-5 py-4">
        <Link
          href="/login"
          onClick={() => track('sidebar_signin_link_click')}
          className="block border border-ink bg-ink px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-paper transition-colors duration-[120ms] hover:bg-ink-2 [border-radius:4px]"
        >
          {tAuth('signIn')}
        </Link>
      </div>
    );
  }

  // The visible name in the row — the local-part of the email reads more
  // like a display name when no separate display field exists.
  const displayName = email ? email.split('@')[0] : '';

  return (
    <div className="relative border-t border-line-soft px-3 py-3" ref={popRef}>
      <div className="flex items-center gap-2 px-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-ink-2">
            {displayName}
          </div>
          {status?.isUnlimited ? (
            <div className="mt-0.5 text-[10.5px] tabular-nums text-amore">
              {tCommon('unlimitedAccess')}
            </div>
          ) : status?.isTrialActive && status.trialEndsAt ? (
            <div className="mt-0.5 text-[10.5px] tabular-nums text-amore">
              {tCommon('trialRemaining', {
                remaining: formatTrialRemaining(status.trialEndsAt),
              })}
            </div>
          ) : credits !== null ? (
            <div className="mt-0.5 text-[10.5px] tabular-nums text-mute-soft">
              {tCommon('creditsRemaining', { count: credits })}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen((v) => {
              if (!v) track('settings_menu_open_click');
              return !v;
            });
          }}
          aria-label={t('settings')}
          aria-expanded={open}
          className={`flex h-7 w-7 shrink-0 items-center justify-center text-mute-soft transition-colors duration-[120ms] hover:text-ink-2 ${
            open ? 'text-ink-2' : ''
          }`}
        >
          <Gear />
        </button>
      </div>

      {open && (
        <div className="absolute bottom-full left-3 right-3 z-30 mb-2 border border-line bg-paper py-1 text-[11.5px] [border-radius:4px]">
          {/* Language toggle */}
          <div className="px-3 py-2">
            <div className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-mute-soft">
              {tCommon('language')}
            </div>
            <div className="mt-1.5 flex items-center gap-3 text-[10.5px] font-semibold uppercase tracking-[0.18em]">
              {(['ko', 'en'] as const).map((lng) => (
                <button
                  key={lng}
                  type="button"
                  onClick={() => changeLocale(lng)}
                  className={`transition-colors duration-[120ms] ${
                    lng === locale
                      ? 'text-amore'
                      : 'text-mute-soft hover:text-ink-2'
                  }`}
                >
                  {lng}
                </button>
              ))}
            </div>
          </div>
          <div className="my-1 h-px bg-line-soft" />
          <PopoverLink
            href="/members"
            onClick={() => {
              track('settings_members_click');
              setOpen(false);
            }}
          >
            {t('members')}
          </PopoverLink>
          <PopoverLink
            href="/credits"
            onClick={() => {
              track('settings_buy_credits_click');
              setOpen(false);
            }}
          >
            {t('buyCredits')}
          </PopoverLink>
          {isSuperAdmin && (
            <>
              <div className="my-1 h-px bg-line-soft" />
              <PopoverLink
                href="/admin/api-usage"
                onClick={() => {
                  track('admin_api_usage_open_click');
                  setOpen(false);
                }}
              >
                {t('adminApiUsage')}
              </PopoverLink>
            </>
          )}
          <div className="my-1 h-px bg-line-soft" />
          <button
            type="button"
            onClick={signOut}
            className="block w-full px-3 py-1.5 text-left text-[11.5px] text-warning transition-colors duration-[120ms] hover:bg-paper-soft"
          >
            {tAuth('signOut')}
          </button>
        </div>
      )}
    </div>
  );
}

function PopoverLink({
  href,
  onClick,
  children,
}: {
  href: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="block px-3 py-1.5 text-[11.5px] text-mute transition-colors duration-[120ms] hover:bg-paper-soft hover:text-ink-2"
    >
      {children}
    </Link>
  );
}

function Gear() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

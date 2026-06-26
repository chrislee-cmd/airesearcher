'use client';

import { useEffect, useRef, useState } from 'react';
import { Link, useRouter, usePathname } from '@/i18n/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { useTransition } from 'react';
import { formatTrialRemaining, usePaywall } from '@/components/paywall-provider';
import { track } from '@/components/mixpanel-provider';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';

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
    // Persist preference for logged-in users so future logins from new
    // devices skip Accept-Language detection. Fire-and-forget — the URL
    // change below is what the user actually waits for.
    if (isAuthed) {
      const supabase = createClient();
      void supabase.auth.getUser().then(({ data: { user } }) => {
        if (!user) return;
        void supabase
          .from('profiles')
          .update({ locale: next })
          .eq('id', user.id);
      });
    }
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  async function signOut() {
    track('auth_signout_click');
    const supabase = createClient();
    await supabase.auth.signOut();
    setOpen(false);
    router.replace('/');
    router.refresh();
  }

  // PR-D5: 캔버스와 같은 시각 — Memphis 카드 (노랑 bg + 검정 3px
   // border + offset shadow). Outfit 폰트.
  const outfitStack = 'var(--font-outfit), var(--font-sans)';

  if (!isAuthed) {
    return (
      <div className="px-3 pb-4 pt-3">
        <Link
          href="/login"
          onClick={() => track('sidebar_signin_link_click')}
          className="block px-3 py-2 text-center text-sm uppercase tracking-[0.18em] transition-transform duration-[120ms] hover:-translate-y-0.5"
          style={{
            background: 'var(--sidebar-border)',
            color: '#fff',
            border:
              'var(--sidebar-nav-border-width) solid var(--sidebar-border)',
            borderRadius: 'var(--sidebar-nav-radius)',
            boxShadow: 'var(--memphis-shadow-sm)',
            fontFamily: outfitStack,
            fontWeight: 700,
          }}
        >
          {tAuth('signIn')}
        </Link>
      </div>
    );
  }

  // The visible name in the row — the local-part of the email reads more
  // like a display name when no separate display field exists.
  const displayName = email ? email.split('@')[0] : '';
  const avatarLetter = (displayName.charAt(0) || '?').toUpperCase();

  return (
    <div className="relative px-3 pb-4 pt-3" ref={popRef}>
      <div
        className="flex items-center gap-2 px-2.5 py-2.5"
        style={{
          background: 'var(--sidebar-bg-strong)',
          border:
            'var(--sidebar-border-width) solid var(--sidebar-border)',
          borderRadius: 'var(--sidebar-nav-radius)',
          boxShadow: 'var(--memphis-shadow-sm)',
        }}
      >
        <div
          className="flex shrink-0 items-center justify-center"
          style={{
            width: 30,
            height: 30,
            background: '#fff',
            color: '#000',
            border:
              'var(--sidebar-nav-border-width) solid var(--sidebar-border)',
            borderRadius: 'var(--sidebar-nav-radius)',
            boxShadow: 'var(--memphis-shadow-xs)',
            fontFamily: outfitStack,
            fontWeight: 800,
            fontSize: 13,
            letterSpacing: '-0.02em',
          }}
        >
          {avatarLetter}
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-md"
            style={{
              fontFamily: outfitStack,
              fontWeight: 700,
              color: 'var(--sidebar-border)',
            }}
          >
            {displayName}
          </div>
          {status?.isUnlimited ? (
            <div
              className="mt-0.5 truncate text-xs-soft tabular-nums"
              style={{
                fontFamily: outfitStack,
                fontWeight: 600,
                color: 'var(--canvas-accent)',
              }}
            >
              {tCommon('unlimitedAccess')}
            </div>
          ) : status?.isTrialActive && status.trialEndsAt ? (
            <div
              className="mt-0.5 truncate text-xs-soft tabular-nums"
              style={{
                fontFamily: outfitStack,
                fontWeight: 600,
                color: 'var(--canvas-accent)',
              }}
            >
              {tCommon('trialRemaining', {
                remaining: formatTrialRemaining(status.trialEndsAt),
              })}
            </div>
          ) : credits !== null ? (
            <div
              className="mt-0.5 truncate text-xs-soft tabular-nums"
              style={{
                fontFamily: outfitStack,
                fontWeight: 600,
                color: 'var(--sidebar-border)',
              }}
            >
              {tCommon('creditsRemaining', { count: credits })}
            </div>
          ) : null}
        </div>
        <IconButton
          variant="ghost"
          size="md"
          onClick={() => {
            setOpen((v) => {
              if (!v) track('settings_menu_open_click');
              return !v;
            });
          }}
          aria-label={t('settings')}
          aria-expanded={open}
          className="shrink-0"
          style={{ color: 'var(--sidebar-border)' }}
        >
          <Gear />
        </IconButton>
      </div>

      {open && (
        <div
          className="absolute bottom-full left-3 right-3 z-modal mb-2 py-1 text-sm"
          style={{
            background: 'var(--sidebar-nav-bg)',
            border:
              'var(--sidebar-nav-border-width) solid var(--sidebar-nav-border)',
            borderRadius: 'var(--sidebar-nav-radius)',
            boxShadow: 'var(--memphis-shadow-sm)',
          }}
        >
          {/* Language toggle */}
          <div className="px-3 py-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mute-soft">
              {tCommon('language')}
            </div>
            <div className="mt-1.5 flex items-center gap-3 text-xs-soft font-semibold uppercase tracking-[0.18em]">
              {(['ko', 'en'] as const).map((lng) => (
                <Button
                  key={lng}
                  variant="link"
                  size="xs"
                  onClick={() => changeLocale(lng)}
                  className={`!px-0 !py-0 !text-xs-soft uppercase tracking-[0.18em] ${
                    lng === locale
                      ? 'text-amore hover:text-amore'
                      : 'text-mute-soft hover:text-ink-2'
                  }`}
                >
                  {lng}
                </Button>
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
              <PopoverLink
                href="/admin/payments"
                onClick={() => {
                  track('admin_payments_open_click');
                  setOpen(false);
                }}
              >
                {t('adminPayments')}
              </PopoverLink>
            </>
          )}
          <div className="my-1 h-px bg-line-soft" />
          <Button
            variant="destructive-link"
            size="xs"
            fullWidth
            onClick={signOut}
            className="!justify-start !px-3 !py-1.5 !text-sm font-normal text-warning hover:bg-paper-soft hover:text-warning"
          >
            {tAuth('signOut')}
          </Button>
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
      className="block px-3 py-1.5 text-sm text-mute transition-colors duration-[120ms] hover:bg-paper-soft hover:text-ink-2"
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

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
import { useCreditDeductionEvent } from '@/components/credit-deduction-provider';

type Props = {
  email: string | null;
  credits: number | null;
  isSuperAdmin?: boolean;
};

// PR-D7: 사이드바 → 헤더 탭 전환 후, 우측 끝의 account trigger. 기존
// SidebarAccount 의 popover 동작을 가로 헤더용으로 정렬 — 트리거 = 아바타
// + 이름 + 크레딧 + gear 한 줄, dropdown 은 트리거 아래로 펼침.
export function TopbarAccount({ email, credits, isSuperAdmin }: Props) {
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

  // 차감 시 잔액 optimistic count-down + pulse.
  // 서버 prop `credits` 는 layout 가 SSR 로 한 번 주는 초기값. 차감 신호가
  // 오면 client state 가 새 값을 그리고, 다음 navigation/refresh 에서
  // 서버가 다시 동기화된다. displayCredits = clientCredits ?? credits.
  const [clientCredits, setClientCredits] = useState<number | null>(null);
  const [pulseTick, setPulseTick] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isUnlimited = !!status?.isUnlimited;

  useCreditDeductionEvent((event) => {
    // unlimited / trial 사용자는 실제 잔액이 줄지 않으므로 카운트 다운 생략.
    if (isUnlimited) return;
    const base = clientCredits ?? credits ?? 0;
    const target =
      typeof event.balance === 'number' ? event.balance : Math.max(0, base - event.amount);
    setPulseTick((t) => t + 1);

    if (countdownRef.current) clearInterval(countdownRef.current);
    // 0.5s 동안 base → target 으로 카운트 다운 (12 frame). |delta| 가 작으면
    // 한 step 으로 끝나도록 round-up.
    const STEPS = 12;
    const start = base;
    const delta = target - start;
    if (delta === 0) {
      setClientCredits(target);
      return;
    }
    let i = 0;
    countdownRef.current = setInterval(() => {
      i += 1;
      if (i >= STEPS) {
        setClientCredits(target);
        if (countdownRef.current) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
        }
        return;
      }
      setClientCredits(Math.round(start + (delta * i) / STEPS));
    }, 40);
  });

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // 서버 prop 이 새로 들어오면 (라우트 전환으로 layout re-render) 클라이언트
  // optimistic 값은 무효 — server truth 로 재정렬. React 19 권장 render-phase
  // 동기화 패턴 (Effect 안의 setState 가 cascading render 를 만드는 것을 회피).
  const [prevServerCredits, setPrevServerCredits] = useState(credits);
  if (credits !== prevServerCredits) {
    setPrevServerCredits(credits);
    setClientCredits(null);
  }

  const displayCredits = clientCredits ?? credits;

  function changeLocale(next: 'ko' | 'en') {
    if (next === locale) return;
    track('settings_locale_change_click', { from: locale, to: next });
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      void supabase.from('profiles').update({ locale: next }).eq('id', user.id);
    });
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

  const outfitStack = 'var(--font-outfit), var(--font-sans)';
  const displayName = email ? email.split('@')[0] : '';
  const avatarLetter = (displayName.charAt(0) || '?').toUpperCase();

  return (
    <div className="relative" ref={popRef}>
      <div className="flex items-center gap-2 rounded-full bg-ink/10 px-2 py-1.5">
        <div
          className="flex shrink-0 items-center justify-center rounded-full bg-paper text-ink"
          style={{
            width: 26,
            height: 26,
            fontFamily: outfitStack,
            fontWeight: 800,
            fontSize: 12,
            letterSpacing: '-0.02em',
          }}
        >
          {avatarLetter}
        </div>
        <div className="hidden min-w-0 max-w-[160px] sm:block">
          <div
            className="truncate text-sm"
            style={{
              fontFamily: outfitStack,
              fontWeight: 700,
              color: 'var(--sidebar-border)',
              lineHeight: 1.1,
            }}
          >
            {displayName}
          </div>
          {status?.isUnlimited ? (
            <div
              className="truncate text-xs-soft tabular-nums"
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
              className="truncate text-xs-soft tabular-nums"
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
          ) : displayCredits !== null ? (
            <div
              className="truncate text-xs-soft tabular-nums"
              style={{
                fontFamily: outfitStack,
                fontWeight: 600,
                color: 'var(--sidebar-border)',
              }}
            >
              <span
                key={pulseTick}
                className={pulseTick > 0 ? 'credit-balance-pulse' : undefined}
              >
                {tCommon('creditsRemaining', { count: displayCredits })}
              </span>
            </div>
          ) : null}
        </div>
        <IconButton
          variant="subtle"
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
          className="absolute right-0 top-full z-modal mt-2 w-60 py-1 text-sm"
          style={{
            background: 'var(--sidebar-nav-bg)',
            border:
              'var(--sidebar-nav-border-width) solid var(--sidebar-nav-border)',
            borderRadius: 'var(--sidebar-nav-radius)',
            boxShadow: 'var(--memphis-shadow-sm)',
          }}
        >
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
            href="/settings"
            onClick={() => {
              track('settings_open_click');
              setOpen(false);
            }}
          >
            {t('settings')}
          </PopoverLink>
          <div className="my-1 h-px bg-line-soft" />
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
              <PopoverLink
                href="/admin/analytics"
                onClick={() => {
                  track('admin_analytics_open_click');
                  setOpen(false);
                }}
              >
                {t('adminAnalytics')}
              </PopoverLink>
              <PopoverLink
                href="/design-system"
                onClick={() => {
                  track('admin_design_system_open_click');
                  setOpen(false);
                }}
              >
                {t('adminDesignSystem')}
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

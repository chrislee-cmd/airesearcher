'use client';

import { Link, usePathname } from '@/i18n/navigation';
import { track } from '@/components/mixpanel-provider';

type Tab = {
  key: string;
  href: string;
  label: string;
};

// PR-D7: 노랑 banner 위에 얹는 탭 row. Memphis 카드 스타일 — 검정
// border + active 시 핑크 wash + 흰 텍스트. usePathname 으로 active
// 매칭 (locale prefix 는 next-intl 의 usePathname 이 제거해 줌).
export function TopbarTabs({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();
  const outfitStack = 'var(--font-outfit), var(--font-sans)';

  return (
    <nav
      aria-label="Primary"
      className="flex min-w-0 flex-1 items-center justify-center gap-2"
    >
      {tabs.map((tab) => {
        const active =
          pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.key}
            href={tab.href}
            onClick={() => track('topbar_tab_click', { tab: tab.key })}
            aria-current={active ? 'page' : undefined}
            className="inline-flex items-center px-3.5 py-1.5 text-sm uppercase tracking-[0.18em] transition-transform duration-[120ms] hover:-translate-y-0.5"
            style={{
              fontFamily: outfitStack,
              fontWeight: 700,
              background: active
                ? 'var(--sidebar-active-bg)'
                : 'var(--sidebar-nav-bg)',
              color: active
                ? 'var(--sidebar-active-text)'
                : 'var(--sidebar-border)',
              border:
                'var(--sidebar-nav-border-width) solid var(--sidebar-border)',
              borderRadius: 'var(--sidebar-nav-radius)',
              boxShadow: 'var(--memphis-shadow-sm)',
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

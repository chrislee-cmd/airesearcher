'use client';

import { Link, usePathname } from '@/i18n/navigation';
import { track } from '@/components/mixpanel-provider';

type Tab = {
  key: string;
  href: string;
  label: string;
};

// 노란 banner 위 탭 row — pill form (subtle 패밀리). inactive = 부드러운
// ink fill, active = 검정 채움 pill. border / shadow / translate 모두 제거,
// 색만 transition.
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
            className={`inline-flex items-center rounded-full px-3.5 py-1.5 text-sm uppercase tracking-[0.18em] transition-colors duration-[120ms] ${
              active
                ? 'bg-ink text-paper'
                : 'bg-ink/10 text-ink-2 hover:bg-ink/15'
            }`}
            style={{ fontFamily: outfitStack, fontWeight: 700 }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

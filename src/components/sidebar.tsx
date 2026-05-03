'use client';

import { Link, usePathname } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { FEATURES } from '@/lib/features';

const NAV_GROUPS = [
  { label: 'OVERVIEW', items: [{ key: 'dashboard', href: '/dashboard' }] },
  {
    label: 'GENERATORS',
    items: FEATURES.map((f) => ({ key: f.key, href: f.href })),
  },
  {
    label: 'WORKSPACE',
    items: [
      { key: 'members', href: '/members' },
      { key: 'settings', href: '/settings' },
    ],
  },
];

export function Sidebar({ orgName }: { orgName: string | null }) {
  const pathname = usePathname();
  const t = useTranslations('Sidebar');
  const tBrand = useTranslations('Brand');

  let counter = 0;

  return (
    <aside className="sticky top-0 hidden h-screen w-[224px] shrink-0 flex-col border-r border-line bg-paper md:flex">
      <div className="px-7 pb-5 pt-7">
        <div className="text-[15px] font-bold tracking-[-0.01em] text-ink">
          {tBrand('name')}
        </div>
        <div className="mt-1 h-px w-6 bg-amore" />
        <div className="mt-2 truncate text-[10.5px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
          {orgName ?? 'Research Console'}
        </div>
      </div>
      <nav className="flex-1 space-y-7 px-3 pb-7">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="px-4 pb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
              {group.label}
            </div>
            <ul>
              {group.items.map((item) => {
                counter += 1;
                const num = String(counter).padStart(2, '0');
                const active = pathname === item.href;
                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-3 px-4 py-2 text-[12.5px] transition-colors duration-[120ms] border-l-2 ${
                        active
                          ? 'border-amore text-ink-2 font-semibold'
                          : 'border-transparent text-mute hover:text-ink-2'
                      }`}
                    >
                      <span
                        className={`text-[10.5px] tabular-nums ${
                          active ? 'text-amore' : 'text-mute-soft'
                        }`}
                      >
                        {num}
                      </span>
                      <span>{t(item.key as Parameters<typeof t>[0])}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}

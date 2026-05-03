'use client';

import { Link, usePathname } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { FEATURES } from '@/lib/features';

const NAV_GROUPS = [
  {
    label: 'main',
    items: [{ key: 'dashboard', href: '/dashboard' }],
  },
  {
    label: 'features',
    items: FEATURES.map((f) => ({ key: f.key, href: f.href })),
  },
  {
    label: 'workspace',
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

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-white px-3 py-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="px-3 pb-4">
        <div className="text-sm font-semibold tracking-tight">{tBrand('name')}</div>
        <div className="mt-0.5 truncate text-xs text-neutral-500">{orgName ?? '—'}</div>
      </div>
      <nav className="flex-1 space-y-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      className={`block rounded-md px-3 py-1.5 text-sm transition ${
                        active
                          ? 'bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-50'
                          : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800/60'
                      }`}
                    >
                      {t(item.key as Parameters<typeof t>[0])}
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

'use client';

import { Link, usePathname } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { FEATURES } from '@/lib/features';

export function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations('Sidebar');
  const tBrand = useTranslations('Brand');

  return (
    <aside className="sticky top-0 hidden h-screen w-[224px] shrink-0 flex-col border-r border-line bg-paper md:flex">
      <div className="px-7 pb-6 pt-7">
        <Link
          href="/dashboard"
          className="block transition-opacity duration-[120ms] hover:opacity-80"
        >
          <div className="text-[15px] font-bold tracking-[-0.01em] text-ink">
            {tBrand('name')}
          </div>
          <div className="mt-1 h-px w-6 bg-amore" />
        </Link>
      </div>

      <nav className="flex-1 px-3 pb-7">
        <ul>
          {FEATURES.map((f) => {
            const active = pathname === f.href;
            return (
              <li key={f.key}>
                <Link
                  href={f.href}
                  className={`block px-4 py-2 text-[12.5px] transition-colors duration-[120ms] border-l-2 ${
                    active
                      ? 'border-amore text-ink-2 font-semibold'
                      : 'border-transparent text-mute hover:text-ink-2'
                  }`}
                >
                  {t(f.key)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-line-soft px-7 py-5">
        <div className="flex flex-col gap-2 text-[11px] text-mute-soft">
          <Link
            href="/members"
            className={`transition-colors duration-[120ms] hover:text-ink-2 ${
              pathname === '/members' ? 'text-ink-2' : ''
            }`}
          >
            {t('members')}
          </Link>
          <Link
            href="/settings"
            className={`transition-colors duration-[120ms] hover:text-ink-2 ${
              pathname === '/settings' ? 'text-ink-2' : ''
            }`}
          >
            {t('settings')}
          </Link>
        </div>
      </div>
    </aside>
  );
}

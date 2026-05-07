'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useActiveProject } from './active-project-provider';

export function SidebarActiveProject() {
  const { active, setActive } = useActiveProject();
  const t = useTranslations('Dashboard');

  return (
    <div className="flex items-center gap-1 border-l-2 border-transparent pl-3 pr-1 text-[11px]">
      <span className="text-mute-soft">@</span>
      {active ? (
        <Link
          href={`/projects/${active.id}`}
          className="flex-1 truncate text-mute hover:text-ink-2"
          title={active.name}
        >
          {active.name}
        </Link>
      ) : (
        <Link href="/projects" className="flex-1 text-mute hover:text-ink-2">
          {t('unfiled')}
        </Link>
      )}
      {active && (
        <button
          type="button"
          aria-label="clear active project"
          onClick={() => setActive(null)}
          className="px-1 text-mute-soft transition-colors hover:text-ink-2"
        >
          ×
        </button>
      )}
    </div>
  );
}

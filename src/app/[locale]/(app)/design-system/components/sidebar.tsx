'use client';

import type { SectionId } from './sections';
import { SECTION_GROUPS } from './sections';

export function DesignSystemSidebar({
  activeId,
  onSelect,
}: {
  activeId: SectionId;
  onSelect: (id: SectionId) => void;
}) {
  return (
    <aside className="sticky top-6 hidden max-h-[calc(100vh-3rem)] w-[200px] shrink-0 self-start overflow-y-auto md:block">
      <nav aria-label="Design system navigation" className="space-y-5 pr-1">
        {SECTION_GROUPS.map((group) => (
          <div key={group.title}>
            <div className="mb-1.5 px-2 text-xs uppercase tracking-[0.22em] text-mute-soft">
              {group.title}
            </div>
            <ul className="space-y-0.5">
              {group.sections.map((s) => {
                const active = activeId === s.id;
                return (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      aria-current={active ? 'page' : undefined}
                      onClick={(e) => {
                        e.preventDefault();
                        onSelect(s.id);
                      }}
                      className={
                        active
                          ? 'block rounded-xs bg-amore-bg px-2 py-1 text-md text-ink'
                          : 'block rounded-xs px-2 py-1 text-md text-mute hover:bg-line-soft hover:text-ink'
                      }
                    >
                      {s.label}
                    </a>
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

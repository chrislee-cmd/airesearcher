'use client';

import { useTranslations } from 'next-intl';
import { SidebarAccount } from './sidebar-account';

type Props = {
  email: string | null;
  credits: number | null;
  isAuthed: boolean;
  isSuperAdmin?: boolean;
};

export function Sidebar({
  email,
  credits,
  isAuthed,
  isSuperAdmin = false,
}: Props) {
  const tBrand = useTranslations('Brand');
  const outfitStack = 'var(--font-outfit), var(--font-sans)';

  return (
    <aside
      data-coachmark-id="sidebar"
      className="sticky top-0 hidden h-screen w-[240px] shrink-0 flex-col md:flex"
      style={{
        background: 'var(--sidebar-bg)',
        borderRight: 'var(--sidebar-border-width) solid var(--sidebar-border)',
      }}
    >
      <div
        className="px-6 pb-5 pt-6"
        style={{
          background: 'var(--sidebar-bg-strong)',
          borderBottom: 'var(--sidebar-border-width) solid var(--sidebar-border)',
        }}
      >
        <h1
          style={{
            fontFamily: outfitStack,
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: 'var(--sidebar-border)',
            lineHeight: 1,
            margin: 0,
          }}
        >
          {tBrand('name')}
        </h1>
      </div>

      <div className="flex-1" />

      <SidebarAccount
        email={email}
        credits={credits}
        isAuthed={isAuthed}
        isSuperAdmin={isSuperAdmin}
      />
    </aside>
  );
}

import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import { Link } from '@/i18n/navigation';
import { TopbarTabs } from './topbar-tabs';
import { TopbarAccount } from './topbar-account';
import { SignInButton } from './sign-in-button';
import { BackgroundJobPill } from './background-job-pill';
import { QaVoiceAgentButton } from './qa/qa-voice-agent-button';

// PR-D7: 사이드바 → 헤더 탭 구조 전환. 노랑 banner + 검정 3px 하단 border
// + Outfit display logo. 좌측 로고 / 중앙 탭 row / 우측 user menu.
export async function Topbar({
  credits,
  userEmail,
  isAuthed,
  isSuperAdmin = false,
}: {
  credits: number | null;
  userEmail: string | null;
  isAuthed: boolean;
  isSuperAdmin?: boolean;
}) {
  const tBrand = await getTranslations('Brand');
  const tTabs = await getTranslations('Topbar.tabs');

  const tabs = [
    { key: 'canvas', href: '/canvas', label: tTabs('canvas') },
    { key: 'projects', href: '/projects', label: tTabs('projects') },
    { key: 'members', href: '/members', label: tTabs('members') },
  ];

  return (
    <header
      data-coachmark-id="topbar"
      className="flex h-14 shrink-0 items-center justify-between gap-6 px-8"
      style={{
        background: 'var(--sidebar-bg-strong)',
        borderBottom: 'var(--sidebar-border-width) solid var(--sidebar-border)',
      }}
    >
      <div className="flex shrink-0 items-center gap-4">
        <Link href="/" aria-label={tBrand('name')} className="flex shrink-0 items-center">
          {/* Primary horizontal lockup — dark wordmark reads cleanly on the
              yellow (--sidebar-bg-strong) banner; on-color card variants would
              float a badge inside the bar. `unoptimized` skips the image
              optimizer (SVG, no dangerouslyAllowSVG config) — the vector is
              served as-is. Height pinned to 28px inside the h-14 bar; width
              follows the 1539×272 viewBox ratio so it never distorts. */}
          <Image
            src="/branding/logos/01_PRIMARY_LOGO_HORIZONTAL.svg"
            alt={tBrand('name')}
            width={158}
            height={28}
            priority
            unoptimized
            style={{ height: 28, width: 'auto' }}
          />
        </Link>
        <BackgroundJobPill />
      </div>

      {isAuthed && <TopbarTabs tabs={tabs} />}

      <div className="flex shrink-0 items-center gap-3">
        {isAuthed ? (
          <>
            {/* Voice-feedback mic trigger — shown to every signed-in account. */}
            <QaVoiceAgentButton />
            <TopbarAccount
              email={userEmail}
              credits={credits}
              isSuperAdmin={isSuperAdmin}
            />
          </>
        ) : (
          <SignInButton />
        )}
      </div>
    </header>
  );
}

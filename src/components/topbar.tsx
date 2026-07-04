import { getTranslations } from 'next-intl/server';
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
  const outfitStack = 'var(--font-outfit), var(--font-sans)';

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
        <div
          style={{
            fontFamily: outfitStack,
            fontSize: 20,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: 'var(--sidebar-border)',
          }}
        >
          {tBrand('name')}
        </div>
        <BackgroundJobPill />
      </div>

      {isAuthed && <TopbarTabs tabs={tabs} />}

      <div className="flex shrink-0 items-center gap-3">
        {isAuthed ? (
          <>
            {/* QA-only mic trigger — self-gates on isQaTester, renders
                nothing for non-QA users. */}
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

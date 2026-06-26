import { LanguageSwitcher } from './language-switcher';
import { SignOutButton } from './sign-out-button';
import { SignInButton } from './sign-in-button';
import { BackgroundJobPill } from './background-job-pill';
import { getTranslations } from 'next-intl/server';

// PR-D5: 노랑 banner + 검정 3px 하단 border + Outfit display logo.
// 사이드바와 시각 일관 (캔버스의 노랑/검정/Memphis 톤). 본 컴포넌트
// 는 일부 비-사이드바 라우트 (canvas-mock 등) 에서 사용.
export async function Topbar({
  credits,
  userEmail,
  isAuthed,
}: {
  credits: number | null;
  userEmail: string | null;
  isAuthed: boolean;
}) {
  const t = await getTranslations('Common');
  const tBrand = await getTranslations('Brand');
  const outfitStack = 'var(--font-outfit), var(--font-sans)';
  return (
    <header
      className="flex h-14 items-center justify-between px-8"
      style={{
        background: 'var(--sidebar-bg-strong)',
        borderBottom: 'var(--sidebar-border-width) solid var(--sidebar-border)',
      }}
    >
      <div className="flex items-center gap-4">
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
        {isAuthed && credits !== null && (
          <span
            className="text-md tabular-nums"
            style={{
              fontFamily: outfitStack,
              fontWeight: 700,
              color: 'var(--sidebar-border)',
            }}
          >
            {t('creditsRemaining', { count: credits })}
          </span>
        )}
        <BackgroundJobPill />
      </div>
      <div className="flex items-center gap-4">
        {isAuthed && (
          <span
            className="hidden text-sm sm:inline"
            style={{
              fontFamily: outfitStack,
              fontWeight: 600,
              color: 'var(--sidebar-border)',
            }}
          >
            {userEmail}
          </span>
        )}
        <LanguageSwitcher />
        {isAuthed ? <SignOutButton /> : <SignInButton />}
      </div>
    </header>
  );
}

import { LanguageSwitcher } from './language-switcher';
import { SignOutButton } from './sign-out-button';
import { SignInButton } from './sign-in-button';
import { BackgroundJobPill } from './background-job-pill';
import { getTranslations } from 'next-intl/server';

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
  // PR-D5 — 노랑 banner bg + 검정 3px 하단 frame + Outfit display 톤
  // (사이드바 / 캔버스와 시각 일관). D3 chrome / D4 내부 → D5 bold full
  // pop. shared primitive (LanguageSwitcher / SignIn·OutButton /
  // BackgroundJobPill) 는 그대로 — 다른 라우트 회귀 위험 없도록.
  return (
    <header
      data-shell-topbar
      className="flex h-16 items-center justify-between border-b-[3px] px-8"
      style={{
        borderColor: 'var(--color-pop-border)',
        background: 'var(--color-pop-banner)',
        boxShadow: 'var(--shadow-pop-offset-sm)',
      }}
    >
      <div className="flex items-center gap-3">
        {isAuthed && credits !== null && (
          <span
            data-shell-topbar-label
            className="text-md tabular-nums"
          >
            {t('creditsRemaining', { count: credits })}
          </span>
        )}
        <BackgroundJobPill />
      </div>
      <div className="flex items-center gap-4">
        {isAuthed && (
          <span
            data-shell-topbar-breadcrumb
            className="hidden text-sm sm:inline"
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

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
  // PR-D3 — chrome pop 적용: 노랑 banner bg + 2.5px 검은 하단 frame +
  // subtle offset shadow. 내부 컨텐츠 (credits / BackgroundJobPill /
  // LanguageSwitcher / SignIn·OutButton) 시각은 그대로 — 검정 frame
  // 위에서 자연 contrast.
  return (
    <header
      className="flex h-16 items-center justify-between border-b-[2.5px] px-8"
      style={{
        borderColor: 'var(--color-pop-border)',
        background: 'var(--color-pop-banner)',
        boxShadow: 'var(--shadow-pop-offset-sm)',
      }}
    >
      <div className="flex items-center gap-3">
        {isAuthed && credits !== null && (
          <span className="text-md tabular-nums text-ink">
            {t('creditsRemaining', { count: credits })}
          </span>
        )}
        <BackgroundJobPill />
      </div>
      <div className="flex items-center gap-4">
        {isAuthed && (
          <span className="hidden text-sm text-ink sm:inline">
            {userEmail}
          </span>
        )}
        <LanguageSwitcher />
        {isAuthed ? <SignOutButton /> : <SignInButton />}
      </div>
    </header>
  );
}

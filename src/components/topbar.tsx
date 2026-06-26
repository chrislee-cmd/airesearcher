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
  // subtle offset shadow.
  // PR-D4 — 내부 컨텐츠 (credits / user email) 도 pop 톤 (Outfit) 적용 —
  // data-shell-topbar rule (globals.css) 가 폰트 / 색 / hover underline
  // 적용. shared primitive (LanguageSwitcher / SignIn·OutButton /
  // BackgroundJobPill) 는 그대로 — 다른 라우트 회귀 위험 없도록.
  return (
    <header
      data-shell-topbar
      className="flex h-16 items-center justify-between border-b-[2.5px] px-8"
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

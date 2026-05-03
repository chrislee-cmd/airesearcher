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
  return (
    <header className="flex h-14 items-center justify-between border-b border-line bg-paper px-8">
      <div className="flex items-center gap-3">
        {isAuthed && credits !== null && (
          <span className="text-[12px] tabular-nums text-mute">
            {t('creditsRemaining', { count: credits })}
          </span>
        )}
        <BackgroundJobPill />
      </div>
      <div className="flex items-center gap-4">
        {isAuthed && (
          <span className="hidden text-[11.5px] text-mute-soft sm:inline">
            {userEmail}
          </span>
        )}
        <LanguageSwitcher />
        {isAuthed ? <SignOutButton /> : <SignInButton />}
      </div>
    </header>
  );
}

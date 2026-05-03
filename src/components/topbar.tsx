import { LanguageSwitcher } from './language-switcher';
import { SignOutButton } from './sign-out-button';
import { SignInButton } from './sign-in-button';
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
    <header className="flex h-14 items-center justify-between border-b border-neutral-200 bg-white px-6 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-3">
        {isAuthed && credits !== null && (
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            {t('creditsRemaining', { count: credits })}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {isAuthed ? (
          <>
            <span className="hidden text-xs text-neutral-500 sm:inline">{userEmail}</span>
            <LanguageSwitcher />
            <SignOutButton />
          </>
        ) : (
          <>
            <LanguageSwitcher />
            <SignInButton />
          </>
        )}
      </div>
    </header>
  );
}

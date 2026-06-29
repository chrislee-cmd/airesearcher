import Link from 'next/link';
import { LanguageSwitcher } from '@/components/language-switcher';

export function LegalShell({
  locale,
  children,
}: {
  locale: string;
  children: React.ReactNode;
}) {
  // Legal-shell nav labels: Korean only on /ko; every other locale uses
  // the English labels because the legal page body itself also falls
  // back to English for non-Korean.
  const labels =
    locale === 'ko'
      ? { terms: '이용약관', privacy: '개인정보처리방침', usePolicy: '이용정책' }
      : { terms: 'Terms', privacy: 'Privacy', usePolicy: 'Acceptable Use' };

  return (
    <main className="flex flex-1 flex-col bg-paper">
      <header className="flex items-center justify-between border-b border-line-soft px-6 py-4">
        <Link
          href={`/${locale}`}
          className="text-lg font-semibold tracking-[-0.01em] text-ink hover:text-amore"
        >
          Research-Canvas
        </Link>
        <div className="flex items-center gap-5 text-md text-mute">
          <Link href={`/${locale}/terms`} className="hover:text-ink">
            {labels.terms}
          </Link>
          <Link href={`/${locale}/privacy`} className="hover:text-ink">
            {labels.privacy}
          </Link>
          <Link href={`/${locale}/use-policy`} className="hover:text-ink">
            {labels.usePolicy}
          </Link>
          <LanguageSwitcher />
        </div>
      </header>
      <article className="mx-auto w-full max-w-[760px] px-6 py-14 text-xl leading-[1.85] text-ink">
        {children}
      </article>
    </main>
  );
}

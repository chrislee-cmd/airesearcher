import Link from 'next/link';
import { LanguageSwitcher } from '@/components/language-switcher';

export function LegalShell({
  locale,
  children,
}: {
  locale: string;
  children: React.ReactNode;
}) {
  const labels =
    locale === 'en'
      ? { terms: 'Terms', privacy: 'Privacy' }
      : { terms: '이용약관', privacy: '개인정보처리방침' };

  return (
    <main className="flex flex-1 flex-col bg-paper">
      <header className="flex items-center justify-between border-b border-line-soft px-6 py-4">
        <Link
          href={`/${locale}`}
          className="text-[13px] font-semibold tracking-[-0.01em] text-ink hover:text-amore"
        >
          Research-mochi
        </Link>
        <div className="flex items-center gap-5 text-[12px] text-mute">
          <Link href={`/${locale}/terms`} className="hover:text-ink">
            {labels.terms}
          </Link>
          <Link href={`/${locale}/privacy`} className="hover:text-ink">
            {labels.privacy}
          </Link>
          <LanguageSwitcher />
        </div>
      </header>
      <article className="mx-auto w-full max-w-[760px] px-6 py-14 text-[14px] leading-[1.85] text-ink">
        {children}
      </article>
    </main>
  );
}

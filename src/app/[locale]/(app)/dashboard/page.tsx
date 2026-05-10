import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getCurrentUser } from '@/lib/supabase/user';
import { getActiveOrg } from '@/lib/org';
import { getDashboardCards, type ProjectCard } from '@/lib/dashboard';

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Dashboard');

  const user = await getCurrentUser();
  const org = user ? await getActiveOrg() : null;
  const cards: ProjectCard[] = org?.org_id
    ? (await getDashboardCards(org.org_id)).cards
    : [];

  // 0-project state: marketing-ish hero + "create your first project" CTA.
  // Falls back to the old feature-list mindset only when not signed in.
  const hasAnyProject = cards.some((c) => c.projectId !== null);

  return (
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-8">
      <header className="border-b border-line pb-4">
        <div className="flex items-center gap-2">
          <span className="inline-block h-px w-5 bg-amore" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amore">
            {t('eyebrow')}
          </span>
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-4">
          <h1 className="text-[28px] font-bold tracking-[-0.02em] text-ink">
            {t('title')}
          </h1>
          {user && org && (
            <Link
              href="/projects"
              className="border border-ink bg-ink px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-paper transition-colors duration-[120ms] hover:bg-ink-2 [border-radius:4px]"
            >
              {t('newProject')}
            </Link>
          )}
        </div>
        <p className="mt-3 max-w-[820px] text-[12.5px] leading-[1.75] text-mute">
          {t('subtitle')}
        </p>
      </header>

      {!user ? (
        <SignedOutHero />
      ) : !org ? (
        <p className="mt-10 text-[12.5px] text-mute-soft">{t('noOrg')}</p>
      ) : !hasAnyProject ? (
        <FirstProjectHero />
      ) : (
        <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <CardView
              key={card.projectId ?? '__unfiled__'}
              card={card}
            />
          ))}
        </section>
      )}
    </div>
  );
}

async function CardView({ card }: { card: ProjectCard }) {
  const t = await getTranslations('Dashboard');
  const isUnfiled = card.projectId === null;
  const total =
    card.counts.reports +
    card.counts.interviews +
    card.counts.transcripts +
    card.counts.desk +
    card.counts.quotes +
    card.counts.recruiting +
    card.counts.scheduler;

  const inner = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="truncate text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
          {isUnfiled ? t('unfiled') : card.name ?? '—'}
        </h3>
        {card.runningCount > 0 && (
          <span className="flex shrink-0 items-center gap-1 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-amore">
            <span className="inline-block h-1.5 w-1.5 animate-pulse [border-radius:9999px] bg-amore" />
            {t('runningCount', { count: card.runningCount })}
          </span>
        )}
      </div>
      <p className="mt-1 text-[10.5px] uppercase tracking-[0.18em] text-mute-soft">
        {card.lastActivityAt
          ? t('lastActivity', { when: formatRelative(card.lastActivityAt) })
          : t('noActivity')}
      </p>

      {total === 0 ? (
        <p className="mt-5 text-[11.5px] text-mute-soft">{t('emptyProject')}</p>
      ) : (
        <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11.5px] tabular-nums">
          <CountRow label={t('countReports')} count={card.counts.reports} />
          <CountRow label={t('countInterviews')} count={card.counts.interviews} />
          <CountRow label={t('countTranscripts')} count={card.counts.transcripts} />
          <CountRow label={t('countDesk')} count={card.counts.desk} />
          <CountRow label={t('countQuotes')} count={card.counts.quotes} />
          <CountRow label={t('countRecruiting')} count={card.counts.recruiting} />
          <CountRow label={t('countScheduler')} count={card.counts.scheduler} />
        </ul>
      )}

      <div className="flex-1" />
      {!isUnfiled && (
        <span className="mt-5 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-mute-soft transition-colors duration-[120ms] group-hover:text-amore">
          {t('openProject')} →
        </span>
      )}
    </>
  );

  if (isUnfiled) {
    return (
      <div className="flex h-full flex-col border border-line bg-paper-soft p-5 [border-radius:4px]">
        {inner}
      </div>
    );
  }
  return (
    <Link
      href={`/projects/${card.projectId}`}
      className="group flex h-full flex-col border border-line bg-paper p-5 transition-colors duration-[120ms] hover:bg-paper-soft [border-radius:4px]"
    >
      {inner}
    </Link>
  );
}

function CountRow({ label, count }: { label: string; count: number }) {
  return (
    <li
      className={`flex items-center justify-between gap-2 ${
        count === 0 ? 'text-mute-soft' : 'text-ink-2'
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="font-semibold tabular-nums">{count}</span>
    </li>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

async function FirstProjectHero() {
  const t = await getTranslations('Dashboard');
  return (
    <section className="mt-10 border border-line bg-paper p-8 [border-radius:4px]">
      <h2 className="text-[20px] font-bold tracking-[-0.018em] text-ink-2">
        {t('firstProjectTitle')}
      </h2>
      <p className="mt-2 max-w-[640px] text-[12.5px] leading-[1.75] text-mute">
        {t('firstProjectBody')}
      </p>
      <Link
        href="/projects"
        className="mt-5 inline-block border border-ink bg-ink px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-paper transition-colors duration-[120ms] hover:bg-ink-2 [border-radius:4px]"
      >
        {t('firstProjectCta')}
      </Link>
    </section>
  );
}

async function SignedOutHero() {
  const t = await getTranslations('Dashboard');
  return (
    <section className="mt-10 border border-line bg-paper p-8 [border-radius:4px]">
      <h2 className="text-[20px] font-bold tracking-[-0.018em] text-ink-2">
        {t('signedOutTitle')}
      </h2>
      <p className="mt-2 max-w-[640px] text-[12.5px] leading-[1.75] text-mute">
        {t('signedOutBody')}
      </p>
      <Link
        href="/login"
        className="mt-5 inline-block border border-ink bg-ink px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-paper transition-colors duration-[120ms] hover:bg-ink-2 [border-radius:4px]"
      >
        {t('signIn')}
      </Link>
    </section>
  );
}

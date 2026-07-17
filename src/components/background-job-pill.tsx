'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { useInterviewJob } from './interview-job-provider';

export function BackgroundJobPill() {
  const t = useTranslations('BackgroundJob');
  const job = useInterviewJob();
  const pathname = usePathname();

  if (!job.isWorking) return null;

  const onInterviewsPage = pathname === '/interviews';
  const extracting = job.items.some((i) => i.extractStatus === 'extracting');
  const label = job.convertingAll
    ? t('converting')
    : extracting
    ? t('extracting')
    : t('analyzing');
  const detail = job.analyzing && job.analysis
    ? `${job.analysis.rows.length} rows`
    : null;

  const content = (
    <span className="flex items-center gap-2 text-xs-soft uppercase tracking-[0.22em] text-amore">
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
      {label}
      {detail && (
        <span className="tabular-nums text-mute-soft normal-case tracking-normal">
          · {detail}
        </span>
      )}
    </span>
  );

  if (onInterviewsPage) return content;

  return (
    <Link
      href="/interviews"
      className="border-l border-line pl-3 transition-colors duration-[120ms] hover:opacity-80"
      title="Go back to the analyzer"
    >
      {content}
    </Link>
  );
}

import { setRequestLocale } from 'next-intl/server';
import { InsightsAnalyzer } from '@/components/insights/insights-analyzer';
import { createClient } from '@/lib/supabase/server';

// Past jobs surfaced in the idle state. ready-only because failed jobs
// were refunded and have no quotes to open. RLS scopes by org via the
// org_members join policy on insights_jobs (see 0025), so an .eq() org
// filter here would be redundant.
const PAST_JOBS_LIMIT = 20;

export default async function InsightsAnalyzerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();
  const { data: pastJobs } = await supabase
    .from('insights_jobs')
    .select(
      'id, title, status, file_count, participant_count, quote_count, failure_reason, created_at',
    )
    .eq('status', 'ready')
    .order('created_at', { ascending: false })
    .limit(PAST_JOBS_LIMIT);

  return <InsightsAnalyzer pastJobs={pastJobs ?? []} />;
}

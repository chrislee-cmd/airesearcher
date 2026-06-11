import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { InsightsAnalyzer } from '@/components/insights/insights-analyzer';
import { createClient } from '@/lib/supabase/server';

// Per-job dashboard route. The job's row carries the counts the ready
// state needs, so we hydrate <InsightsAnalyzer initialJob={...}/> from
// the server and skip the client resume path entirely. RLS scopes the
// query by org_members — anyone outside the owning org sees notFound.
export default async function InsightsAnalyzerJobPage({
  params,
}: {
  params: Promise<{ locale: string; jobId: string }>;
}) {
  const { locale, jobId } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();
  const { data: job } = await supabase
    .from('insights_jobs')
    .select(
      'id, title, status, file_count, participant_count, quote_count, failure_reason, created_at',
    )
    .eq('id', jobId)
    .eq('status', 'ready')
    .maybeSingle();

  if (!job) notFound();

  return <InsightsAnalyzer initialJob={job} pastJobs={[]} />;
}

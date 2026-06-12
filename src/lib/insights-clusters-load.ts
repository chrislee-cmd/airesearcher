import type { SupabaseClient } from '@supabase/supabase-js';

export type ClusterQuote = {
  id: number;
  participant_name: string;
  text: string;
};

export type ClusterWithQuotes = {
  id: string;
  cluster_key: string;
  label: string;
  insight: string | null;
  quotes: ClusterQuote[];
};

// Two-step fetch (clusters → cluster_quotes → quotes) instead of a
// PostgREST embed. Each step's FK is direct so an embed *would* work
// here, but splitting keeps us robust against the §7.10 transitive-
// embed trap if anyone later swaps the join shape. Also keeps cluster
// ordering stable: we return them in insertion order via id sort, and
// each cluster's quote list in the original quote.id order so members
// stay aligned with the per-quote search panel.
export async function loadClustersForJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<ClusterWithQuotes[]> {
  const { data: clusters } = await supabase
    .from('insights_clusters')
    .select('id, cluster_key, label, insight')
    .eq('job_id', jobId);
  if (!clusters || clusters.length === 0) return [];

  const clusterIds = clusters.map((c) => c.id);
  const { data: cqs } = await supabase
    .from('insights_cluster_quotes')
    .select('cluster_id, quote_id')
    .in('cluster_id', clusterIds);

  const quoteIds = Array.from(new Set((cqs ?? []).map((r) => r.quote_id)));
  const { data: quotes } = quoteIds.length
    ? await supabase
        .from('insights_quotes')
        .select('id, participant_name, text')
        .in('id', quoteIds)
    : { data: [] as ClusterQuote[] };

  const quotesById = new Map((quotes ?? []).map((q) => [q.id, q]));
  const clusterIdToQuotes = new Map<string, ClusterQuote[]>();
  for (const row of cqs ?? []) {
    const q = quotesById.get(row.quote_id);
    if (!q) continue;
    const arr = clusterIdToQuotes.get(row.cluster_id) ?? [];
    arr.push(q);
    clusterIdToQuotes.set(row.cluster_id, arr);
  }

  return clusters.map((c) => ({
    id: c.id,
    cluster_key: c.cluster_key,
    label: c.label,
    insight: c.insight,
    quotes: (clusterIdToQuotes.get(c.id) ?? []).sort((a, b) => a.id - b.id),
  }));
}

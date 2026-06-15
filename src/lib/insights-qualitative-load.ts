import type { SupabaseClient } from '@supabase/supabase-js';

export type QualitativeQuote = {
  id: number;
  participant_name: string;
  text: string;
};

export type TensionWithQuotes = {
  id: string;
  participant_name: string;
  axis: string;
  lo_val: number;
  hi_val: number;
  lo_quote: QualitativeQuote | null;
  hi_quote: QualitativeQuote | null;
};

export type ContradictionWithQuotes = {
  id: string;
  participant_name: string;
  contradiction_type: string;
  strength: 'high' | 'medium' | 'low' | null;
  label: string;
  a_label: string | null;
  a_quote: QualitativeQuote | null;
  b_label: string | null;
  b_quote: QualitativeQuote | null;
  insight: string | null;
  tag: string | null;
};

export type QualitativeForJob = {
  tensions: TensionWithQuotes[];
  contradictions: ContradictionWithQuotes[];
};

// Two-step fetch (tensions + contradictions → quotes) mirroring
// loadClustersForJob. Avoids the §7.10 PostgREST transitive-embed trap
// and lets the qualitative viz render even if a quote was later pruned
// (FK is on delete set null in migration 0025 — the row survives, the
// anchor just becomes null).
export async function loadQualitativeForJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<QualitativeForJob> {
  const [tensionsRes, contradictionsRes] = await Promise.all([
    supabase
      .from('insights_tensions')
      .select(
        'id, participant_name, axis, lo_val, hi_val, lo_quote_id, hi_quote_id',
      )
      .eq('job_id', jobId),
    supabase
      .from('insights_contradictions')
      .select(
        'id, participant_name, contradiction_type, strength, label, a_label, a_quote_id, b_label, b_quote_id, insight, tag',
      )
      .eq('job_id', jobId),
  ]);

  const tensionRows = tensionsRes.data ?? [];
  const contradictionRows = contradictionsRes.data ?? [];
  if (tensionRows.length === 0 && contradictionRows.length === 0) {
    return { tensions: [], contradictions: [] };
  }

  const quoteIds = new Set<number>();
  for (const t of tensionRows) {
    if (t.lo_quote_id != null) quoteIds.add(t.lo_quote_id);
    if (t.hi_quote_id != null) quoteIds.add(t.hi_quote_id);
  }
  for (const c of contradictionRows) {
    if (c.a_quote_id != null) quoteIds.add(c.a_quote_id);
    if (c.b_quote_id != null) quoteIds.add(c.b_quote_id);
  }

  const { data: quotes } = quoteIds.size
    ? await supabase
        .from('insights_quotes')
        .select('id, participant_name, text')
        .in('id', Array.from(quoteIds))
    : { data: [] as QualitativeQuote[] };

  const quotesById = new Map((quotes ?? []).map((q) => [q.id, q]));
  const lookup = (id: number | null): QualitativeQuote | null =>
    id == null ? null : (quotesById.get(id) ?? null);

  return {
    tensions: tensionRows.map((t) => ({
      id: t.id,
      participant_name: t.participant_name,
      axis: t.axis,
      lo_val: t.lo_val,
      hi_val: t.hi_val,
      lo_quote: lookup(t.lo_quote_id),
      hi_quote: lookup(t.hi_quote_id),
    })),
    contradictions: contradictionRows.map((c) => ({
      id: c.id,
      participant_name: c.participant_name,
      contradiction_type: c.contradiction_type,
      strength: c.strength,
      label: c.label,
      a_label: c.a_label,
      a_quote: lookup(c.a_quote_id),
      b_label: c.b_label,
      b_quote: lookup(c.b_quote_id),
      insight: c.insight,
      tag: c.tag,
    })),
  };
}

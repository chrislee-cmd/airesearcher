import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { env } from '@/env';
import { ZERO_RETENTION } from './llm/config';
import {
  buildInsightsClustersSystem,
  insightsClustersExtractionSchema,
  type InsightsCluster,
} from './insights-clusters-schema';
import type { OutputLang } from './i18n/output-language';

type QuoteRow = {
  id: number;
  participant_name: string;
  theme: string | null;
  text: string;
};

// One-shot cluster pass over a finalized job's quotes. generateObject
// instead of streamObject because the response is small (5-7 clusters)
// and /finalize blocks the response anyway — streaming buys us nothing
// here and complicates the validation pass.
//
// Returns clusters with quote_ids already filtered against the input set
// so a hallucinated id can't reach the M:N table.
export async function extractClusters(
  quotes: QuoteRow[],
  lang?: OutputLang,
): Promise<InsightsCluster[]> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('missing_anthropic_key');
  if (quotes.length === 0) return [];

  // Compact prompt: id + participant + theme + text per line. We pack
  // the existing theme into the line because it's already a coarse
  // signal that helps the model anchor cluster boundaries.
  const lines = quotes
    .map((q) => {
      const t = q.theme ? ` · ${q.theme}` : '';
      // Strip newlines from quote text — the model gets one quote per
      // input line, so embedded newlines would corrupt the index map.
      const text = q.text.replace(/\s+/g, ' ').trim();
      return `[${q.id}] ${q.participant_name}${t}: ${text}`;
    })
    .join('\n');

  const anthropic = createAnthropic({ apiKey });
  const result = await generateObject({
    model: anthropic('claude-sonnet-4-6'),
    schema: insightsClustersExtractionSchema,
    system: buildInsightsClustersSystem(lang),
    // 200k char cap matches the per-file extract route — well under
    // Sonnet's input window and bounds prompt cost for outlier jobs.
    prompt: `quotes (id 형식: [id]):\n\n${lines.slice(0, 200_000)}`,
    // Slightly higher than per-quote extraction (0.1) because clustering
    // is inherently more interpretive and benefits from a touch of
    // exploration. Still low enough for stable runs.
    temperature: 0.2,
    maxOutputTokens: 8192,
    providerOptions: ZERO_RETENTION,
  });

  const validIds = new Set(quotes.map((q) => q.id));
  return result.object.clusters
    .map((c) => ({
      ...c,
      quote_ids: c.quote_ids.filter((id) => validIds.has(id)),
    }))
    .filter((c) => c.quote_ids.length > 0);
}

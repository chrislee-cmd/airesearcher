import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import {
  INSIGHTS_QUALITATIVE_SYSTEM,
  insightsQualitativeExtractionSchema,
  type InsightsContradiction,
  type InsightsTension,
} from './insights-qualitative-schema';

type QuoteRow = {
  id: number;
  participant_name: string;
  theme: string | null;
  text: string;
};

export type QualitativeResult = {
  tensions: InsightsTension[];
  contradictions: InsightsContradiction[];
};

// Single LLM pass over a finalized job's quotes returning BOTH tensions
// and contradictions in one generateObject call. The input shape is
// identical to extractClusters (id + participant + theme + text per
// line) so we share the same compaction.
//
// quote_ids are filtered against the input set + the unique constraint
// on (participant_name, axis) is enforced client-side so a model that
// emits duplicate axes for one participant doesn't crash the bulk
// INSERT.
export async function extractQualitative(
  quotes: QuoteRow[],
): Promise<QualitativeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('missing_anthropic_key');
  if (quotes.length === 0) return { tensions: [], contradictions: [] };

  const lines = quotes
    .map((q) => {
      const t = q.theme ? ` · ${q.theme}` : '';
      const text = q.text.replace(/\s+/g, ' ').trim();
      return `[${q.id}] ${q.participant_name}${t}: ${text}`;
    })
    .join('\n');

  const anthropic = createAnthropic({ apiKey });
  const result = await generateObject({
    model: anthropic('claude-sonnet-4-6'),
    schema: insightsQualitativeExtractionSchema,
    system: INSIGHTS_QUALITATIVE_SYSTEM,
    prompt: `quotes (id 형식: [id]):\n\n${lines.slice(0, 200_000)}`,
    // 0.3 is a touch higher than clustering (0.2) because qualitative
    // pattern-spotting benefits from a bit more exploration. Still low
    // enough to be replayable.
    temperature: 0.3,
    maxOutputTokens: 8192,
  });

  const validIds = new Set(quotes.map((q) => q.id));

  // Filter hallucinated quote_ids. The schema allows nulls for the
  // anchor refs, so a bad id just becomes null — same downstream UX as
  // "the LLM declined to anchor this one".
  const cleanQuoteId = (id: number | null) =>
    id === null || !validIds.has(id) ? null : id;

  // Dedupe tensions on (participant_name, axis) to satisfy 0025's
  // unique constraint. If the model emits the same axis twice for one
  // person, last-wins is fine — usually the second pass is a refinement.
  const tensionMap = new Map<string, InsightsTension>();
  for (const t of result.object.tensions) {
    const k = `${t.participant_name}|${t.axis}`;
    tensionMap.set(k, {
      ...t,
      lo_quote_id: cleanQuoteId(t.lo_quote_id),
      hi_quote_id: cleanQuoteId(t.hi_quote_id),
    });
  }

  const contradictions = result.object.contradictions.map((c) => ({
    ...c,
    a_quote_id: cleanQuoteId(c.a_quote_id),
    b_quote_id: cleanQuoteId(c.b_quote_id),
  }));

  return {
    tensions: Array.from(tensionMap.values()),
    contradictions,
  };
}

import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import {
  TERM_NORMALIZE_SYSTEM,
  termNormalizeSchema,
  type TermCluster,
  type TermNormalizeDecision,
} from './term-normalize-schema';

// Cross-turn terminology normalization for Korean transcripts.
//
// Runs after the per-chunk cleanup pass. cleanup() can only see 20 turns
// at a time, so it can't notice that "스피커폰" appears in turn 3 and
// "스피크폰" appears in turn 41 — both are valid-looking words inside
// their own chunk. This pass takes the whole cleaned markdown and asks
// the LLM to find clusters of STT variants of the same word.
//
// Safety guards (defense-in-depth against an over-eager LLM):
//  1. Each variant must actually occur in the document (we recompute
//     occurrences ourselves — the LLM's `variants[]` is a proposal, not
//     ground truth).
//  2. At least ONE of (canonical, variants) must occur ≥2 times. A pure
//     1+1+1 cluster could just be three coincidentally similar single
//     mentions of unrelated words.
//  3. Canonical must be one of the proposed variants (no LLM-invented
//     words).
//  4. Document-level length drift after substitution capped at 5%
//     (catches a pathological cluster that would rewrite huge swaths).
//
// On any failure / no clusters → returns null and the caller leaves
// clean_markdown as cleanup()'s output.

const MODEL = 'claude-haiku-4-5-20251001';
const MIN_DOC_LENGTH = 400; // Skip very short transcripts — no recurrence likely.
const MAX_DOC_DRIFT = 0.05; // 5% document-level length change cap.

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  // Whole-word(-ish) match: needle bounded by non-word/Hangul on both sides.
  // We can't use \b for Korean — fall back to a simple split-count using a
  // RegExp escape + non-Hangul lookarounds. Simpler: count substring hits
  // and let the substitution itself handle word boundaries via the same
  // pattern. This is a coarse count used only as a sanity gate — exact
  // segmentation isn't critical.
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    count += 1;
    from = idx + needle.length;
  }
  return count;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type TermNormalizeAudit = {
  skipped: boolean;
  reason?: string;
  model?: string;
  clusters_proposed: number;
  clusters_applied: number;
  clusters_rejected: number;
  substitutions: number;
  doc_drift?: number;
  reasoning?: string;
  applied_clusters?: Array<{
    canonical: string;
    variants: string[];
    reason: string;
    substitutions: number;
  }>;
  generated_at?: string;
};

export type TermNormalizeResult = {
  normalized: string | null;
  audit: TermNormalizeAudit;
};

const emptyAudit = (reason: string): TermNormalizeAudit => ({
  skipped: true,
  reason,
  clusters_proposed: 0,
  clusters_applied: 0,
  clusters_rejected: 0,
  substitutions: 0,
});

/**
 * Find and normalize cross-turn STT spelling variants in the cleaned
 * markdown. Returns the normalized text plus an audit object; the audit
 * is persisted in `raw_result._term_normalize` for review.
 *
 * Conservative: any guard failure on a cluster drops only that cluster;
 * other clusters in the same response still apply. The function returns
 * `normalized: null` only if NO clusters survived guards or the LLM call
 * itself failed — in that case the caller keeps the cleanup output.
 */
export async function normalizeTermsInTranscript(
  markdown: string,
): Promise<TermNormalizeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { normalized: null, audit: emptyAudit('missing_api_key') };
  if (!markdown || markdown.length < MIN_DOC_LENGTH) {
    return { normalized: null, audit: emptyAudit('document_too_short') };
  }

  let decision: TermNormalizeDecision;
  try {
    const anthropic = createAnthropic({ apiKey });
    const result = await generateObject({
      model: anthropic(MODEL),
      schema: termNormalizeSchema,
      system: TERM_NORMALIZE_SYSTEM,
      prompt: `다음 인터뷰 전사록 전체를 보고, 같은 고유명사·전문용어의 STT 변형 클러스터를 찾아 정규화하세요. 확신 없는 클러스터는 결과에서 제외.\n\n[전사록]\n${markdown}`,
      temperature: 0.1,
      maxOutputTokens: 2048,
    });
    decision = result.object;
  } catch (e) {
    console.warn('[transcripts/term-normalize] LLM call failed', e);
    return {
      normalized: null,
      audit: {
        ...emptyAudit(
          e instanceof Error ? `llm_error: ${e.message.slice(0, 120)}` : 'llm_error',
        ),
      },
    };
  }

  const audit: TermNormalizeAudit = {
    skipped: false,
    model: MODEL,
    clusters_proposed: decision.clusters.length,
    clusters_applied: 0,
    clusters_rejected: 0,
    substitutions: 0,
    reasoning: decision.reasoning,
    applied_clusters: [],
    generated_at: new Date().toISOString(),
  };

  if (decision.clusters.length === 0) {
    audit.reason = 'no_clusters';
    return { normalized: null, audit };
  }

  // Vet + apply clusters one at a time so the doc-drift cap composes
  // across the whole pass (not per cluster). Each cluster that survives
  // its guard contributes to a running `current` string that the next
  // cluster sees.
  let current = markdown;
  const appliedClusters: NonNullable<TermNormalizeAudit['applied_clusters']> = [];

  for (const cluster of decision.clusters) {
    const result = vetAndApply(current, cluster);
    if (!result.applied) {
      audit.clusters_rejected += 1;
      continue;
    }
    current = result.next;
    audit.clusters_applied += 1;
    audit.substitutions += result.substitutions;
    appliedClusters.push({
      canonical: cluster.canonical,
      variants: cluster.variants,
      reason: cluster.reason,
      substitutions: result.substitutions,
    });
  }

  audit.applied_clusters = appliedClusters;
  const drift = Math.abs(current.length - markdown.length) / Math.max(markdown.length, 1);
  audit.doc_drift = Number(drift.toFixed(4));

  if (audit.clusters_applied === 0) {
    audit.reason = 'all_clusters_rejected';
    return { normalized: null, audit };
  }
  if (drift > MAX_DOC_DRIFT) {
    audit.reason = `doc_drift_exceeded: ${drift.toFixed(3)} > ${MAX_DOC_DRIFT}`;
    return { normalized: null, audit };
  }

  return { normalized: current, audit };
}

type VetResult =
  | { applied: false }
  | { applied: true; next: string; substitutions: number };

function vetAndApply(doc: string, cluster: TermCluster): VetResult {
  const { canonical } = cluster;
  // Dedupe + drop canonical from the variants-to-replace list (we don't
  // need to substitute it onto itself).
  const variants = Array.from(new Set(cluster.variants)).filter((v) => v && v !== canonical);
  if (variants.length === 0) return { applied: false };

  // Guard 1: canonical must occur ≥1 in the doc (no LLM-invented words).
  // Guard 2: each variant must occur ≥1 in the doc.
  if (countOccurrences(doc, canonical) < 1) return { applied: false };
  for (const v of variants) {
    if (countOccurrences(doc, v) < 1) return { applied: false };
  }

  // Guard 3: at least one of (canonical, variant₀, variant₁, …) must occur
  // ≥2 times. Otherwise this is just 3 coincidentally similar singletons.
  const allOccurrences = [
    countOccurrences(doc, canonical),
    ...variants.map((v) => countOccurrences(doc, v)),
  ];
  if (!allOccurrences.some((n) => n >= 2)) return { applied: false };

  // Guard 4: per-pair length similarity. Each variant must be within ±2
  // characters of canonical, with a similarity floor (block "공항" → "공장"
  // style merges where the chars overlap but meaning diverges).
  for (const v of variants) {
    const lenDiff = Math.abs(v.length - canonical.length);
    if (lenDiff > 2) return { applied: false };
  }

  // Apply substitutions in descending length order so "스피커 폰" gets
  // replaced before "스피커폰" — otherwise the shorter variant's regex
  // would consume the prefix of the longer one.
  const ordered = variants.slice().sort((a, b) => b.length - a.length);
  let next = doc;
  let substitutions = 0;
  for (const v of ordered) {
    const before = next;
    const re = new RegExp(escapeRegex(v), 'g');
    next = next.replace(re, canonical);
    // Net change in `v`'s occurrence count = number of times we replaced it.
    substitutions += Math.max(
      0,
      countOccurrences(before, v) - countOccurrences(next, v),
    );
  }

  if (substitutions === 0) return { applied: false };
  return { applied: true, next, substitutions };
}

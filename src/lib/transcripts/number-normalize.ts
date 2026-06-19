import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import {
  NUMBER_NORMALIZE_SYSTEM,
  numberNormalizeSchema,
  type NumberSpan,
  type NumberNormalizeDecision,
} from './number-normalize-schema';

// Korean number normalization pass. Runs AFTER cleanup + term-normalize,
// so the input is already disfluency-free and terminologically consistent.
// Converts text-form numerals like "삼 년", "오천만 원", "스무 살" into
// digit + Korean-unit forms ("3년", "5천만 원", "20살").
//
// Same defense-in-depth pattern as term-normalize:
//  1. Each `original` must occur in the document (LLM can't invent spans).
//  2. Length similarity gate per span (normalized within ±5 chars).
//  3. Document-level length drift capped at 5%.
//  4. Conservative system prompt — figurative / idiomatic uses excluded.
//
// On any failure / no spans → returns null and the caller keeps the
// upstream cleaned+normalized markdown.

const MODEL = 'claude-haiku-4-5-20251001';
const MIN_DOC_LENGTH = 400;
const MAX_DOC_DRIFT = 0.05;
const MAX_SPAN_LEN_DIFF = 5;

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
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

export type NumberNormalizeAudit = {
  skipped: boolean;
  reason?: string;
  model?: string;
  spans_proposed: number;
  spans_applied: number;
  spans_rejected: number;
  substitutions: number;
  doc_drift?: number;
  reasoning?: string;
  applied_spans?: Array<{
    original: string;
    normalized: string;
    kind: NumberSpan['kind'];
    reason: string;
    substitutions: number;
  }>;
  generated_at?: string;
};

export type NumberNormalizeResult = {
  normalized: string | null;
  audit: NumberNormalizeAudit;
};

const emptyAudit = (reason: string): NumberNormalizeAudit => ({
  skipped: true,
  reason,
  spans_proposed: 0,
  spans_applied: 0,
  spans_rejected: 0,
  substitutions: 0,
});

/**
 * Find Korean text-form numerals and substitute them with digit+unit forms.
 * Returns the rewritten markdown plus an audit object; audit lands in
 * `raw_result._number_normalize`. On failure the caller keeps the upstream
 * cleanup + term-normalize output unchanged.
 */
export async function normalizeNumbersInTranscript(
  markdown: string,
): Promise<NumberNormalizeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { normalized: null, audit: emptyAudit('missing_api_key') };
  if (!markdown || markdown.length < MIN_DOC_LENGTH) {
    return { normalized: null, audit: emptyAudit('document_too_short') };
  }

  let decision: NumberNormalizeDecision;
  try {
    const anthropic = createAnthropic({ apiKey });
    const result = await generateObject({
      model: anthropic(MODEL),
      schema: numberNormalizeSchema,
      system: NUMBER_NORMALIZE_SYSTEM,
      prompt: `다음 인터뷰 전사록에서 한국어 텍스트형 숫자 표현을 찾아 디지트 + 한국식 단위로 변환할 spans 을 반환하세요. 확신 없는 span 은 결과에서 제외.\n\n[전사록]\n${markdown}`,
      temperature: 0.1,
      maxOutputTokens: 4096,
    });
    decision = result.object;
  } catch (e) {
    console.warn('[transcripts/number-normalize] LLM call failed', e);
    return {
      normalized: null,
      audit: emptyAudit(
        e instanceof Error ? `llm_error: ${e.message.slice(0, 120)}` : 'llm_error',
      ),
    };
  }

  const audit: NumberNormalizeAudit = {
    skipped: false,
    model: MODEL,
    spans_proposed: decision.spans.length,
    spans_applied: 0,
    spans_rejected: 0,
    substitutions: 0,
    reasoning: decision.reasoning,
    applied_spans: [],
    generated_at: new Date().toISOString(),
  };

  if (decision.spans.length === 0) {
    audit.reason = 'no_spans';
    return { normalized: null, audit };
  }

  // Apply spans longest-first so overlapping replacements don't cascade
  // (e.g. "오천만 원" must be replaced before its substring "오천만").
  const ordered = decision.spans
    .slice()
    .sort((a, b) => b.original.length - a.original.length);

  let current = markdown;
  const appliedSpans: NonNullable<NumberNormalizeAudit['applied_spans']> = [];

  for (const span of ordered) {
    const result = vetAndApply(current, span);
    if (!result.applied) {
      audit.spans_rejected += 1;
      continue;
    }
    current = result.next;
    audit.spans_applied += 1;
    audit.substitutions += result.substitutions;
    appliedSpans.push({
      original: span.original,
      normalized: span.normalized,
      kind: span.kind,
      reason: span.reason,
      substitutions: result.substitutions,
    });
  }

  audit.applied_spans = appliedSpans;
  const drift = Math.abs(current.length - markdown.length) / Math.max(markdown.length, 1);
  audit.doc_drift = Number(drift.toFixed(4));

  if (audit.spans_applied === 0) {
    audit.reason = 'all_spans_rejected';
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

function vetAndApply(doc: string, span: NumberSpan): VetResult {
  const { original, normalized } = span;
  if (!original || !normalized || original === normalized) return { applied: false };

  // Guard 1: original must literally appear in the doc.
  const occurrences = countOccurrences(doc, original);
  if (occurrences === 0) return { applied: false };

  // Guard 2: per-span length similarity. Numbers don't usually balloon —
  // "오천만 원" (6) → "5천만 원" (5) is fine; >5 char swing suggests the
  // LLM is rewriting more than just the number.
  const lenDiff = Math.abs(normalized.length - original.length);
  if (lenDiff > MAX_SPAN_LEN_DIFF) return { applied: false };

  // Apply globally — numbers often recur (e.g. interviewer asks "스무 살"
  // multiple times). One span = one rewrite rule.
  const re = new RegExp(escapeRegex(original), 'g');
  const next = doc.replace(re, normalized);
  if (next === doc) return { applied: false };

  return { applied: true, next, substitutions: occurrences };
}

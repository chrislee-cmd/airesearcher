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
// Defense-in-depth:
//  1. Each `original` must literally appear in the document.
//  2. Length similarity gate per span (normalized within ±5 chars).
//  3. Unit-suffix guard: if `normalized` introduces a Korean unit char that
//     `original` doesn't already have, reject — the LLM is "adding" unit
//     information that may be wrong when applied globally (e.g. "오백" →
//     "500만 원" would mangle "오백만 원" into "500만 원만 원").
//  4. Atomic token-based substitution: each accepted span's `original` is
//     first rewritten to a unique sentinel (Private-Use-Area code points
//     that never appear in real text), then sentinels are rewritten to
//     `normalized`. This prevents chaining where one span's output becomes
//     the input of a later span (the "이천만 원" → "2천만 원" → "21천만 원"
//     → "211천만 원" PR #337 bug).
//  5. Spans deduped by (original, normalized) to defang LLM repeating itself.
//  6. Document-level length drift capped at 5% after all substitutions.

const MODEL = 'claude-haiku-4-5-20251001';
const MIN_DOC_LENGTH = 400;
const MAX_DOC_DRIFT = 0.05;
const MAX_SPAN_LEN_DIFF = 5;
// Korean unit chars commonly appended by number normalization. The
// unit-suffix guard rejects spans where `normalized` introduces any of
// these chars that `original` doesn't already contain.
const KOREAN_UNIT_CHARS = '만억조천백십년월일시분초세살명번개대회회차주원천원';
// Private-Use-Area sentinels written as \u escape sequences so the source
// file stays plain ASCII (Git diff-able). U+E000 / U+E001 never appear in
// real Korean transcripts and have no special regex meaning.
const SENTINEL_OPEN = '\uE000';
const SENTINEL_CLOSE = '\uE001';

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

// Returns true iff `normalized` introduces a Korean unit char that
// `original` doesn't already include. Used to reject spans like "오백" →
// "500만 원" which silently mangle the doc when "오백만 원" appears intact
// elsewhere.
function introducesNewUnitChar(original: string, normalized: string): boolean {
  for (const ch of normalized) {
    if (KOREAN_UNIT_CHARS.includes(ch) && !original.includes(ch)) {
      return true;
    }
  }
  return false;
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

  // Dedup by (original, normalized). LLM occasionally repeats the same
  // span — without dedup the duplicate would compound the substitution.
  const dedupMap = new Map<string, NumberSpan>();
  for (const span of decision.spans) {
    const key = `${span.original}|${span.normalized}`;
    if (!dedupMap.has(key)) dedupMap.set(key, span);
  }

  // Per-span pre-vet against the ORIGINAL document. Occurrences check uses
  // the unmodified markdown so a later (longer) span's placeholder
  // substitution doesn't hide a shorter span's original instance.
  const accepted: NumberSpan[] = [];
  for (const span of dedupMap.values()) {
    if (!span.original || !span.normalized || span.original === span.normalized) {
      audit.spans_rejected += 1;
      continue;
    }
    if (countOccurrences(markdown, span.original) === 0) {
      audit.spans_rejected += 1;
      continue;
    }
    if (Math.abs(span.normalized.length - span.original.length) > MAX_SPAN_LEN_DIFF) {
      audit.spans_rejected += 1;
      continue;
    }
    if (introducesNewUnitChar(span.original, span.normalized)) {
      audit.spans_rejected += 1;
      continue;
    }
    accepted.push(span);
  }

  if (accepted.length === 0) {
    audit.reason = 'all_spans_rejected';
    return { normalized: null, audit };
  }

  // Atomic token-based substitution. Longest-first ensures "이천만 원" is
  // tokenized before its substring "천만 원" — so the shorter span only
  // matches occurrences OUTSIDE the longer span's instances.
  accepted.sort((a, b) => b.original.length - a.original.length);

  const ph = (i: number): string => `${SENTINEL_OPEN}NN${i}${SENTINEL_CLOSE}`;

  let working = markdown;
  const phCounts = new Map<NumberSpan, number>();
  for (let i = 0; i < accepted.length; i += 1) {
    const span = accepted[i];
    const placeholder = ph(i);
    const re = new RegExp(escapeRegex(span.original), 'g');
    const before = working;
    working = working.replace(re, placeholder);
    if (working === before) {
      phCounts.set(span, 0);
      continue;
    }
    const phRe = new RegExp(escapeRegex(placeholder), 'g');
    phCounts.set(span, (working.match(phRe) ?? []).length);
  }
  // Second pass: replace each placeholder with its normalized form. The
  // sentinel chars guarantee no other span's `original` matches a placeholder.
  for (let i = 0; i < accepted.length; i += 1) {
    const placeholder = ph(i);
    working = working.replace(
      new RegExp(escapeRegex(placeholder), 'g'),
      accepted[i].normalized,
    );
  }

  const appliedSpans: NonNullable<NumberNormalizeAudit['applied_spans']> = [];
  for (const span of accepted) {
    const count = phCounts.get(span) ?? 0;
    if (count === 0) {
      // The span's original was entirely absorbed by a longer span's
      // tokenization — treat as rejected so the audit reflects reality.
      audit.spans_rejected += 1;
      continue;
    }
    appliedSpans.push({
      original: span.original,
      normalized: span.normalized,
      kind: span.kind,
      reason: span.reason,
      substitutions: count,
    });
    audit.spans_applied += 1;
    audit.substitutions += count;
  }

  audit.applied_spans = appliedSpans;
  const drift = Math.abs(working.length - markdown.length) / Math.max(markdown.length, 1);
  audit.doc_drift = Number(drift.toFixed(4));

  if (audit.spans_applied === 0) {
    audit.reason = 'all_spans_rejected';
    return { normalized: null, audit };
  }
  if (drift > MAX_DOC_DRIFT) {
    audit.reason = `doc_drift_exceeded: ${drift.toFixed(3)} > ${MAX_DOC_DRIFT}`;
    return { normalized: null, audit };
  }

  return { normalized: working, audit };
}

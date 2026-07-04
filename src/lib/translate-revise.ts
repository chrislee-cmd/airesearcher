// AI 동시통역 — 사후 batch 재번역 (PR-T3).
//
// The realtime simultaneous interpreter compresses and elides under
// load — long utterances become terse paraphrases, subordinate clauses
// lose their subjects, sentences run together without whitespace. The
// source-language transcript (kind='input' rows) is preserved verbatim,
// so once the session ends we can re-translate it with a higher-fidelity
// model in batch mode without the latency budget the realtime path has
// to respect.
//
// This module is the LLM-facing layer. The route in
// src/app/api/translate/sessions/[id]/revise/route.ts handles auth /
// credit gating / DB writes and delegates here for the actual call.

import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { ZERO_RETENTION } from './llm/config';
import { languageLabel } from './translate-instructions';

// Claude Sonnet 4-6 — the same model the other in-app LLM features
// (insights extraction, speaker-roles) use. Sonnet handles ~40-line
// transcript chunks well within a single response window while
// preserving Korean / English idiom faithfully.
const MODEL = 'claude-sonnet-4-6';

// Batch size. Keeps any single call under ~10k input tokens for a
// typical interview (Korean / English mixed) — well within Sonnet's
// limits and small enough that one slow chunk doesn't dominate the
// total wall-clock. Batching is per-row, so this tuning stays valid even
// though live sessions can now run 90+ min via auto renewal (see
// translate-console SESSION_MAX_MS): a longer session just yields more
// 40-row batches, not larger ones.
export const REVISE_BATCH_SIZE = 40;

export type ReviseInputRow = {
  id: number;
  text: string;
  speaker?: 'host' | 'guest' | null;
};

export type RevisedRow = {
  id: number;
  revised: string;
};

const responseSchema = z.object({
  translations: z.array(
    z.object({
      id: z.number().int(),
      revised: z.string(),
    }),
  ),
});

function buildSystem(
  sourceLang: string,
  targetLang: string,
  glossary: string[] = [],
): string {
  const src = languageLabel(sourceLang);
  const tgt = languageLabel(targetLang);
  // The system prompt restates the realtime prompt's fidelity rules
  // (no compression, preserve every clause / connective / subject)
  // but in a batch context — no latency budget, full sentence visible
  // before commit, so the model can render the full meaning.
  const lines = [
    `You are a high-fidelity post-hoc interpreter restoring a transcript that was first translated live by a simultaneous interpreter LLM under tight latency constraints.`,
    `The realtime interpreter compresses long utterances, drops subordinate clauses, runs sentences together without whitespace, and elides subjects/verbs/connectives. Your job is to undo that damage.`,
    `Source language: ${src}. Target language: ${tgt}. Output every translation in ${tgt} only.`,
    `For each numbered source line you receive, produce a faithful translation that:`,
    `1) Renders EVERY clause, subject, verb, object, and logical connective ("because", "however", "but", "so", "그래서", "왜냐하면") — never compress or paraphrase the gist.`,
    `2) Always emits whitespace between sentences and after every comma. Never run two sentences together.`,
    `3) Preserves the speaker's tone, register, filler words that carry meaning ("I mean", "actually", "wait, sorry"), and proper nouns / numbers / dates / units exactly as spoken.`,
    `4) Drops only pure verbal tics ("uh", "um", "어", "음") that carry no meaning.`,
    `5) If a source line is genuinely empty or unintelligible, return an empty string for that id — do not invent content.`,
    `6) NEVER editorialize, summarize, label, or add commentary. Return only the translated text per id.`,
  ];
  // Glossary hint (PR — translate output quality). The host-provided
  // canonical spellings keep proper nouns / names consistent across the
  // whole session, fixing the "same person, three transliterations" and
  // soundalike drift the user reported. Empty glossary → no extra rule.
  if (glossary.length > 0) {
    lines.push(
      `7) Glossary — use these EXACT canonical spellings for the named people / organizations / tools / acronyms whenever the spoken audio refers to them (match by sound, not just spelling); never re-transliterate them: ${glossary.join('; ')}.`,
    );
  }
  lines.push(
    `Return a JSON object { translations: [{id, revised}] } where every input id appears exactly once. Do not invent ids; do not drop ids.`,
  );
  return lines.join(' ');
}

function buildPrompt(rows: ReviseInputRow[]): string {
  const lines = rows.map((r) => {
    // Speaker tag is informational only — the model uses it to keep
    // pronouns / register consistent across a multi-turn exchange. We
    // do NOT ask the model to echo the tag back; the id alone is the
    // join key for the response.
    const sp = r.speaker === 'host' ? '진행자' : r.speaker === 'guest' ? '응답자' : '';
    const tag = sp ? `(${sp}) ` : '';
    // Collapse whitespace to a single space so the model isn't tempted
    // to "preserve" formatting artifacts from the raw transcript.
    const text = r.text.replace(/\s+/g, ' ').trim();
    return `[${r.id}] ${tag}${text}`;
  });
  return `Source lines (numbered by id):\n\n${lines.join('\n')}`;
}

// Run a single batch through the LLM. Returns one RevisedRow per input
// row in `rows`. Rows the model failed to revise (missing id, empty
// string) come back with `revised = ''` — the caller decides whether
// to retry or write-through.
export async function reviseBatch(
  rows: ReviseInputRow[],
  sourceLang: string,
  targetLang: string,
  glossary: string[] = [],
): Promise<RevisedRow[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('missing_anthropic_key');
  if (rows.length === 0) return [];

  const anthropic = createAnthropic({ apiKey });
  const result = await generateObject({
    model: anthropic(MODEL),
    schema: responseSchema,
    system: buildSystem(sourceLang, targetLang, glossary),
    prompt: buildPrompt(rows),
    // 0.2 — same as clustering. Low enough that two runs converge,
    // high enough that idioms don't get rendered word-for-word.
    temperature: 0.2,
    // 8192 covers a 40-row batch's worth of expanded translation with
    // headroom. Korean → English typically inflates char count 1.5x.
    maxOutputTokens: 8192,
    providerOptions: ZERO_RETENTION,
  });

  const validIds = new Set(rows.map((r) => r.id));
  const seen = new Set<number>();
  const out: RevisedRow[] = [];
  for (const t of result.object.translations) {
    if (!validIds.has(t.id) || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push({ id: t.id, revised: t.revised });
  }
  // Fill in any ids the model skipped with empty strings so the
  // caller can decide policy (mark as skipped / blank / retry).
  for (const r of rows) {
    if (!seen.has(r.id)) {
      out.push({ id: r.id, revised: '' });
    }
  }
  return out;
}

export const REVISION_MODEL_LABEL = MODEL;

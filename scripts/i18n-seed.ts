// ─────────────────────────────────────────────────────────────────────────
// i18n backfill seed — LLM translation of missing ja/th keys (i18n Phase 8).
//
// Why: `messages/en.json` (+ ko) is the first-class source, but ja/th were
// only ~40% translated, so the en-base fallback in src/i18n/request.ts leaked
// English into ja/th views (the "Thai mode shows Korean/English/Thai mixed"
// report). This util reads en as the source of truth, finds every leaf key a
// target locale is missing, translates it with the glossary (docs/WRITING.md
// §5) injected, runs a second review pass for naturalness, gates the result
// on machine-checkable quality rules, and merges it back — rebuilding the
// target file in en's key order so parity is exact and the diff is stable.
//
// It is idempotent: keys the target already has are preserved verbatim, only
// gaps are filled. Re-run it after adding new en keys to top up any locale.
// The same pipeline seeds future locales — add the code to LOCALES + GLOSSARY.
//
// Human review is intentionally out of scope (LLM-only, per the Phase 8 spec):
// the automated gate (ICU-placeholder parity, no-empty, no-Korean-residue) is
// the quality floor; native review is a later optional pass.
//
// Run:
//   node --experimental-strip-types --env-file-if-exists=.env.local \
//     scripts/i18n-seed.ts [--locale ja|th|all] [--no-review] [--limit N] [--dry-run]
//
// Needs ANTHROPIC_API_KEY (from .env.local). No src/ imports — scripts run
// outside Next, so the @ alias and env wrapper are unavailable; the glossary
// and language labels are inlined below.
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

const HERE = dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = join(HERE, '..', 'messages');

// Sonnet 4-6 — the same model the in-app translation features use
// (translate-revise, insights extraction). Handles JSON-structured batch
// translation with glossary constraints well within one response window.
const MODEL = 'claude-sonnet-4-6';

// Keep each batch small enough that one call stays well under the output
// token budget and a single slow/failed batch doesn't dominate wall-clock.
const BATCH_SIZE = 30;

type TargetLocale = 'ja' | 'th';
const ALL_TARGETS: TargetLocale[] = ['ja', 'th'];

const LANG_LABEL: Record<TargetLocale, string> = { ja: 'Japanese', th: 'Thai' };

// docs/WRITING.md §5 glossary — canonical per-locale bindings. Injected into
// the system prompt and spot-checked in the gate. Terms that stay romanized in
// a locale (AI UT, Affinity Bubble, moderator) are represented as-is so the
// model does not "translate" them.
const GLOSSARY: Record<TargetLocale, Array<[en: string, target: string]>> = {
  ja: [
    ['canvas', 'キャンバス'],
    ['widget', 'ウィジェット'],
    ['credit', 'クレジット'],
    ['project', 'プロジェクト'],
    ['organization', '組織'],
    ['member', 'メンバー'],
    ['workspace', 'ワークスペース'],
    ['session', 'セッション'],
    ['transcript', '文字起こし'],
    ['quote', '引用'],
    ['insight', 'インサイト'],
    ['probing assistant', 'プロービングアシスタント'],
    ['live interpretation', 'AI同時通訳'],
    ['desk research', 'デスクリサーチ'],
    ['topline', 'トップライン'],
    ['report', 'レポート'],
    ['respondent', '回答者'],
    ['participant', '参加者'],
    ['AI UT', 'AI UT'],
    ['moderator', 'moderator'],
    ['Affinity Bubble', 'Affinity Bubble'],
  ],
  th: [
    ['canvas', 'แคนวาส'],
    ['widget', 'วิดเจ็ต'],
    ['credit', 'เครดิต'],
    ['project', 'โปรเจกต์'],
    ['organization', 'องค์กร'],
    ['member', 'สมาชิก'],
    ['workspace', 'เวิร์กสเปซ'],
    ['session', 'เซสชัน'],
    ['transcript', 'ทรานสคริปต์'],
    ['quote', 'คำพูด'],
    ['insight', 'อินไซต์'],
    ['live interpretation', 'ล่ามแปลสด AI'],
    ['desk research', 'เดสก์รีเสิร์ช'],
    ['topline', 'ท็อปไลน์'],
    ['report', 'รายงาน'],
    ['respondent', 'ผู้ตอบ'],
    ['participant', 'ผู้เข้าร่วม'],
    ['AI UT', 'AI UT'],
    ['moderator', 'moderator'],
    ['Affinity Bubble', 'Affinity Bubble'],
  ],
};

const HANGUL = /[가-힣ᄀ-ᇿ]/;

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

/** ICU-style `{placeholder}` names in a string (order-insensitive). */
function placeholders(value: string): Set<string> {
  const out = new Set<string>();
  for (const m of value.matchAll(/\{\s*([a-zA-Z0-9_]+)\s*[,}]/g)) out.add(m[1]);
  return out;
}

// ── Structural walk ───────────────────────────────────────────────────────
// A translation unit: one en string that the target is missing, addressed by
// a JSON path (dotted keys + numeric array indices) so we can merge it back.
type Unit = { id: number; path: (string | number)[]; en: string };

/**
 * Rebuild the target locale mirroring en's structure/order. Existing target
 * strings are preserved; missing strings become `null` placeholders and are
 * queued as translation Units. Non-string leaves (numbers/booleans) are copied
 * from en. Objects/arrays recurse in parallel.
 */
function buildSkeleton(
  enNode: Json,
  targetNode: Json,
  path: (string | number)[],
  units: Unit[],
): Json {
  if (typeof enNode === 'string') {
    if (typeof targetNode === 'string' && targetNode.length > 0) return targetNode;
    // Nothing to translate for whitespace/empty or non-letter strings — copy.
    if (enNode.trim() === '') return enNode;
    const id = units.length;
    units.push({ id, path, en: enNode });
    return null; // placeholder, filled after translation
  }
  if (Array.isArray(enNode)) {
    return enNode.map((el, i) =>
      buildSkeleton(
        el as Json,
        Array.isArray(targetNode) ? (targetNode[i] as Json) : null,
        [...path, i],
        units,
      ),
    );
  }
  if (enNode !== null && typeof enNode === 'object') {
    const out: Record<string, unknown> = {};
    const t = targetNode !== null && typeof targetNode === 'object' && !Array.isArray(targetNode)
      ? (targetNode as Record<string, unknown>)
      : {};
    for (const key of Object.keys(enNode)) {
      out[key] = buildSkeleton((enNode as Record<string, unknown>)[key] as Json, (t[key] ?? null) as Json, [...path, key], units);
    }
    return out;
  }
  // number | boolean | null — copy en verbatim (parity needs the key present).
  return enNode;
}

function setAtPath(root: Json, path: (string | number)[], value: string): void {
  let node = root as Record<string | number, unknown>;
  for (let i = 0; i < path.length - 1; i++) node = node[path[i]] as Record<string | number, unknown>;
  node[path[path.length - 1]] = value;
}

// ── LLM translation ─────────────────────────────────────────────────────
const responseSchema = z.object({
  translations: z.array(z.object({ id: z.number().int(), text: z.string() })),
});

function buildSystem(locale: TargetLocale, review: boolean): string {
  const tgt = LANG_LABEL[locale];
  const glossaryLine = GLOSSARY[locale]
    .map(([en, t]) => (en === t ? `"${en}" → keep as "${en}" (do not translate)` : `"${en}" → "${t}"`))
    .join('; ');
  const base = [
    `You are a professional UI localizer for a SaaS research product. Translate each numbered English UI string into ${tgt}.`,
    `These are user-facing UI strings: buttons, labels, headings, tooltips, toasts, empty states, error messages. Use natural, concise ${tgt} that a native speaker expects in a polished product — not literal word-for-word translation.`,
    `Register: polite and professional (${locale === 'ja' ? 'です・ます / 丁寧語, no casual plain form' : 'formal but friendly, standard written Thai'}). Match the tone across buttons (imperative verb) vs descriptions (full sentence).`,
    `Preserve EXACTLY, without translating or reordering: ICU placeholders like {name}, {count}, {time}; HTML-ish tags like <b>…</b>; emoji; numbers; units; URLs; product/brand proper nouns.`,
    `Glossary — use these canonical bindings whenever the concept appears: ${glossaryLine}.`,
    `Do NOT output any Korean (Hangul). If the source contains a proper noun with no target equivalent, keep it as-is.`,
    `Return JSON { translations: [{id, text}] } with every input id exactly once. Never drop or invent ids.`,
  ];
  if (review) {
    base.push(
      `This is a REVIEW pass: you receive a draft ${tgt} translation next to the English source. Fix awkward phrasing, wrong politeness level, particle/spacing errors, and glossary violations. Keep it faithful to the English meaning. Return the improved ${tgt} text per id.`,
    );
  }
  return base.join(' ');
}

function buildPrompt(units: Array<{ id: number; en: string; draft?: string }>): string {
  const lines = units.map((u) =>
    u.draft !== undefined
      ? `[${u.id}] EN: ${u.en}\n     DRAFT: ${u.draft}`
      : `[${u.id}] ${u.en}`,
  );
  return `Strings:\n\n${lines.join('\n')}`;
}

async function callLLM(
  anthropic: ReturnType<typeof createAnthropic>,
  locale: TargetLocale,
  units: Array<{ id: number; en: string; draft?: string }>,
  review: boolean,
): Promise<Map<number, string>> {
  const result = await generateObject({
    model: anthropic(MODEL),
    schema: responseSchema,
    system: buildSystem(locale, review),
    prompt: buildPrompt(units),
    temperature: 0.2,
    maxOutputTokens: 8192,
  });
  const out = new Map<number, string>();
  const valid = new Set(units.map((u) => u.id));
  for (const t of result.object.translations) {
    if (valid.has(t.id) && !out.has(t.id)) out.set(t.id, t.text);
  }
  return out;
}

// ── Quality gate ──────────────────────────────────────────────────────────
type GateFail = { unit: Unit; reason: string; got: string };

function gate(unit: Unit, got: string | undefined): string | null {
  if (got == null) return 'missing from model output';
  if (got.trim() === '') return 'empty translation';
  // Korean in the output is residue only when the English source has none.
  // Some source strings deliberately embed Korean examples (e.g. the quotes
  // feature's "광고는·광고를" particle-matching demo) — keeping those is correct.
  if (HANGUL.test(got) && !HANGUL.test(unit.en)) return 'contains Korean (untranslated residue)';
  const ep = placeholders(unit.en);
  const gp = placeholders(got);
  if (ep.size !== gp.size || [...ep].some((p) => !gp.has(p))) {
    return `ICU placeholder mismatch: en{${[...ep].join(',')}} vs got{${[...gp].join(',')}}`;
  }
  // Preserve <b>…</b>-style tags count (best-effort HTML fidelity).
  const enTags = (unit.en.match(/<[^>]+>/g) ?? []).length;
  const gotTags = (got.match(/<[^>]+>/g) ?? []).length;
  if (enTags !== gotTags) return `HTML tag count mismatch (en ${enTags} vs got ${gotTags})`;
  return null;
}

// A translation identical to the English source, where the source has real
// words, is a suspicious copy-through — reported (soft), not hard-failed,
// because some strings (brand names, "URL", "AI UT") legitimately stay.
function looksUntranslated(unit: Unit, got: string): boolean {
  return got.trim() === unit.en.trim() && /[A-Za-z]{4,}/.test(unit.en) && !placeholders(unit.en).size;
}

async function translateLocale(
  locale: TargetLocale,
  opts: { review: boolean; limit: number; dryRun: boolean },
): Promise<void> {
  const en = JSON.parse(readFileSync(join(MESSAGES_DIR, 'en.json'), 'utf8')) as Json;
  const target = JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf8')) as Json;

  const units: Unit[] = [];
  const skeleton = buildSkeleton(en, target, [], units);

  const queued = opts.limit > 0 ? units.slice(0, opts.limit) : units;
  console.log(`\n[${locale}] ${units.length} missing key(s)${opts.limit > 0 ? ` (limited to ${queued.length})` : ''}.`);
  if (queued.length === 0) {
    console.log(`[${locale}] already complete — nothing to seed.`);
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('missing ANTHROPIC_API_KEY (run with --env-file-if-exists=.env.local)');
  const anthropic = createAnthropic({ apiKey });

  const translated = new Map<number, string>();
  const softWarnings: string[] = [];

  for (let start = 0; start < queued.length; start += BATCH_SIZE) {
    const batch = queued.slice(start, start + BATCH_SIZE);
    const batchNo = Math.floor(start / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(queued.length / BATCH_SIZE);

    // Pass 1 — draft.
    const draft = await callLLM(anthropic, locale, batch.map((u) => ({ id: u.id, en: u.en })), false);

    // Pass 2 — review/polish (optional).
    if (opts.review) {
      const reviewUnits = batch
        .filter((u) => draft.has(u.id))
        .map((u) => ({ id: u.id, en: u.en, draft: draft.get(u.id)! }));
      if (reviewUnits.length > 0) {
        const reviewed = await callLLM(anthropic, locale, reviewUnits, true);
        for (const [id, text] of reviewed) draft.set(id, text);
      }
    }

    // Gate + one retry for hard failures.
    const failed: GateFail[] = [];
    for (const u of batch) {
      const got = draft.get(u.id);
      const reason = gate(u, got);
      if (reason) failed.push({ unit: u, reason, got: got ?? '' });
    }
    if (failed.length > 0) {
      const retry = await callLLM(
        anthropic,
        locale,
        failed.map((f) => ({ id: f.unit.id, en: f.unit.en })),
        false,
      );
      for (const f of failed) {
        const got = retry.get(f.unit.id);
        const reason = gate(f.unit, got);
        if (reason) {
          throw new Error(
            `[${locale}] gate failure (after retry) at ${f.unit.path.join('.')}: ${reason}\n  en: ${f.unit.en}\n  got: ${got ?? '(none)'}`,
          );
        }
        draft.set(f.unit.id, got!);
      }
    }

    for (const u of batch) {
      const got = draft.get(u.id)!;
      translated.set(u.id, got);
      if (looksUntranslated(u, got)) softWarnings.push(`${u.path.join('.')}: "${u.en}" (kept as-is)`);
    }
    console.log(`[${locale}] batch ${batchNo}/${totalBatches} ✓ (${batch.length} keys${failed.length ? `, ${failed.length} regated` : ''})`);
  }

  // Merge into skeleton.
  for (const u of queued) setAtPath(skeleton, u.path, translated.get(u.id)!);

  if (softWarnings.length > 0) {
    console.log(`\n[${locale}] ${softWarnings.length} string(s) kept identical to English (spot-check these):`);
    for (const w of softWarnings.slice(0, 25)) console.log(`   • ${w}`);
    if (softWarnings.length > 25) console.log(`   … +${softWarnings.length - 25} more`);
  }

  if (opts.dryRun) {
    console.log(`\n[${locale}] --dry-run: not written. Would fill ${queued.length} key(s).`);
    return;
  }

  // Only rewrite the file if we backfilled the whole locale (limit unset);
  // a partial run would drop the un-queued placeholders (null) on write.
  if (opts.limit > 0) {
    console.log(`\n[${locale}] --limit set: skipping write (partial run is preview-only).`);
    return;
  }

  writeFileSync(join(MESSAGES_DIR, `${locale}.json`), JSON.stringify(skeleton, null, 2) + '\n');
  console.log(`\n[${locale}] ✓ wrote ${locale}.json (${queued.length} keys backfilled).`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const localeArg = (argv[argv.indexOf('--locale') + 1] ?? 'all') as string;
  const review = !argv.includes('--no-review');
  const dryRun = argv.includes('--dry-run');
  const limitIdx = argv.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(argv[limitIdx + 1] ?? '0', 10) : 0;

  const targets: TargetLocale[] =
    localeArg === 'all' ? ALL_TARGETS : ALL_TARGETS.includes(localeArg as TargetLocale) ? [localeArg as TargetLocale] : [];
  if (targets.length === 0) {
    console.error(`unknown --locale "${localeArg}" (expected ja | th | all)`);
    process.exit(1);
  }

  for (const locale of targets) await translateLocale(locale, { review, limit, dryRun });
  console.log('\n✓ i18n-seed done.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`\n✗ ${(e as Error).message}`);
    process.exit(1);
  });
}

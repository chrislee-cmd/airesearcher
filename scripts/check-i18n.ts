// ─────────────────────────────────────────────────────────────────────────
// Locale key-parity gate (i18n Phase 2). Run in CI to keep `messages/*.json`
// honest. Red conditions:
//
//   1. Invalid JSON, or a duplicate key inside any object.
//   2. ko ↔ en leaf-key sets differ (both are first-class — an orphan on
//      either side is red).
//   3. ja / th contain a key that en does not (they must be a subset of en;
//      the en-base merge in src/i18n/request.ts covers whatever they omit).
//
// Report-only (never red): per-locale untranslated counts (en − locale), and
// a best-effort ICU-placeholder diff between ko and en for shared keys.
//
// Runnable:  node --experimental-strip-types scripts/check-i18n.ts
// Importable: `import { checkI18n } from '.../check-i18n.ts'` (tests reuse it).
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const LOCALES = ['en', 'ko', 'ja', 'th'] as const;
export type Locale = (typeof LOCALES)[number];

// ko/en must match exactly (checked explicitly below); ja/th only need to be
// a subset of en.
const SUBSET_OF_EN: Locale[] = ['ja', 'th'];

type Json = Record<string, unknown>;

/** Every dotted leaf-key path in an object (arrays and scalars are leaves). */
export function leafKeys(obj: Json, prefix = '', out = new Set<string>()): Set<string> {
  for (const key of Object.keys(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      leafKeys(value as Json, path, out);
    } else {
      out.add(path);
    }
  }
  return out;
}

/** ICU-style `{placeholder}` names in a string value (order-insensitive). */
function placeholders(value: string): Set<string> {
  const out = new Set<string>();
  for (const m of value.matchAll(/\{\s*([a-zA-Z0-9_]+)\s*[,}]/g)) out.add(m[1]);
  return out;
}

function leafStrings(obj: Json, prefix = '', out = new Map<string, string>()): Map<string, string> {
  for (const key of Object.keys(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      leafStrings(value as Json, path, out);
    } else if (typeof value === 'string') {
      out.set(path, value);
    }
  }
  return out;
}

/**
 * Structural scan for duplicate object keys. `JSON.parse` silently keeps the
 * last of a repeated key, so we walk the raw text: track a key-set per object
 * frame and flag any repeat. Reports the dotted breadcrumb of the offender.
 */
export function findDuplicateKeys(text: string): string[] {
  const dups: string[] = [];
  type Frame = { isObj: boolean; keys: Set<string>; crumb: string[]; pending: string | null };
  const stack: Frame[] = [];
  let i = 0;
  const n = text.length;
  const isWs = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r';

  function readString(): string {
    i++; // opening quote
    let s = '';
    while (i < n) {
      const c = text[i];
      if (c === '\\') { s += text[i + 1]; i += 2; continue; }
      if (c === '"') { i++; break; }
      s += c; i++;
    }
    return s;
  }

  while (i < n) {
    const c = text[i];
    if (isWs(c) || c === ',' || c === ':') { i++; continue; }
    if (c === '"') {
      const str = readString();
      let j = i;
      while (j < n && isWs(text[j])) j++;
      const top = stack[stack.length - 1];
      if (top && top.isObj && text[j] === ':') {
        if (top.keys.has(str)) dups.push([...top.crumb, str].join('.'));
        else top.keys.add(str);
        top.pending = str;
      }
      continue;
    }
    if (c === '{' || c === '[') {
      const parent = stack[stack.length - 1];
      const crumb = parent
        ? [...parent.crumb, parent.pending].filter((x): x is string => x != null)
        : [];
      stack.push({ isObj: c === '{', keys: new Set(), crumb, pending: null });
      i++; continue;
    }
    if (c === '}' || c === ']') { stack.pop(); i++; continue; }
    i++; // primitive token (number / true / false / null)
  }
  return dups;
}

export type CheckResult = {
  errors: string[];
  report: string[];
};

export function checkI18n(messagesDir: string): CheckResult {
  const errors: string[] = [];
  const report: string[] = [];

  const raw: Record<Locale, string> = {} as Record<Locale, string>;
  const parsed: Record<Locale, Json> = {} as Record<Locale, Json>;

  // 1. Load + JSON validity + duplicate keys.
  for (const loc of LOCALES) {
    const file = join(messagesDir, `${loc}.json`);
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      errors.push(`${loc}.json: file not found at ${file}`);
      continue;
    }
    raw[loc] = text;
    try {
      parsed[loc] = JSON.parse(text) as Json;
    } catch (e) {
      errors.push(`${loc}.json: invalid JSON — ${(e as Error).message}`);
      continue;
    }
    const dups = findDuplicateKeys(text);
    for (const d of dups) errors.push(`${loc}.json: duplicate key "${d}"`);
  }

  // Bail if any file failed to load/parse — key checks below need all of them.
  if (Object.keys(parsed).length !== LOCALES.length) return { errors, report };

  const keys: Record<Locale, Set<string>> = {} as Record<Locale, Set<string>>;
  for (const loc of LOCALES) keys[loc] = leafKeys(parsed[loc]);

  const en = keys.en;

  // 2. ko ↔ en exact parity.
  const koOnly = [...keys.ko].filter((k) => !en.has(k)).sort();
  const enOnly = [...en].filter((k) => !keys.ko.has(k)).sort();
  if (koOnly.length) {
    errors.push(
      `ko has ${koOnly.length} key(s) missing from en (orphans):\n  ${koOnly.slice(0, 20).join('\n  ')}` +
        (koOnly.length > 20 ? `\n  … +${koOnly.length - 20} more` : ''),
    );
  }
  if (enOnly.length) {
    errors.push(
      `en has ${enOnly.length} key(s) missing from ko (orphans):\n  ${enOnly.slice(0, 20).join('\n  ')}` +
        (enOnly.length > 20 ? `\n  … +${enOnly.length - 20} more` : ''),
    );
  }
  if (!koOnly.length && !enOnly.length) {
    report.push(`ko ↔ en: exact parity (${en.size} keys).`);
  }

  // 3. ja / th ⊆ en.
  for (const loc of SUBSET_OF_EN) {
    const orphans = [...keys[loc]].filter((k) => !en.has(k)).sort();
    if (orphans.length) {
      errors.push(
        `${loc} has ${orphans.length} key(s) not present in en (must be a subset of en):\n  ${orphans
          .slice(0, 20)
          .join('\n  ')}` + (orphans.length > 20 ? `\n  … +${orphans.length - 20} more` : ''),
      );
    }
  }

  // Report-only: untranslated coverage per locale (en − locale).
  for (const loc of LOCALES) {
    const untranslated = [...en].filter((k) => !keys[loc].has(k)).length;
    const pct = (((en.size - untranslated) / en.size) * 100).toFixed(1);
    report.push(`${loc}: ${en.size - untranslated}/${en.size} keys (${pct}%), ${untranslated} fall back to en.`);
  }

  // Report-only: best-effort ICU-placeholder diff between ko and en for keys
  // both define. A mismatch usually means a translation dropped/renamed an
  // interpolation argument; surfaced for review, not a hard failure.
  const enStrings = leafStrings(parsed.en);
  const koStrings = leafStrings(parsed.ko);
  const argMismatches: string[] = [];
  for (const [key, enVal] of enStrings) {
    const koVal = koStrings.get(key);
    if (koVal == null) continue;
    const a = placeholders(enVal);
    const b = placeholders(koVal);
    if (a.size !== b.size || [...a].some((p) => !b.has(p))) {
      argMismatches.push(`${key}: en{${[...a].join(',')}} vs ko{${[...b].join(',')}}`);
    }
  }
  if (argMismatches.length) {
    report.push(
      `⚠ ${argMismatches.length} ko/en placeholder mismatch(es) (report-only):\n  ${argMismatches
        .slice(0, 10)
        .join('\n  ')}` + (argMismatches.length > 10 ? `\n  … +${argMismatches.length - 10} more` : ''),
    );
  } else {
    report.push('ko/en ICU placeholders: consistent.');
  }

  return { errors, report };
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const messagesDir = join(here, '..', 'messages');
  const { errors, report } = checkI18n(messagesDir);

  console.log('i18n locale parity report');
  console.log('─'.repeat(40));
  for (const line of report) console.log(`  ${line}`);

  if (errors.length) {
    console.error(`\n✗ ${errors.length} parity error(s):`);
    for (const e of errors) console.error(`\n  • ${e}`);
    console.error('\nSee scripts/check-i18n.ts header for the rules.');
    process.exit(1);
  }
  console.log('\n✓ locale key parity OK');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

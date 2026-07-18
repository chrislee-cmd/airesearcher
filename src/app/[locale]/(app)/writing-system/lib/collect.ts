import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────
// Writing-system data collector (super-admin catalog).
//
// Reads the four locale bundles + docs/WRITING.md straight off the repo and
// flattens them into a read-only view model. The catalog UI is the text-token
// peer of the design-system view: what the design system does for radius /
// color / z-index tokens, this does for message keys.
//
// en is the source of truth (mirrors scripts/check-i18n.ts): every en leaf key
// is a row, and a locale is "missing" that key when its bundle has no leaf at
// that path (would fall back to en — the language-leak bug the parity gate
// guards). leafKeys is re-implemented here (12 lines) rather than imported from
// scripts/check-i18n.ts because scripts/ is excluded from the app tsconfig.
// ─────────────────────────────────────────────────────────────────────────

export const LOCALES = ['en', 'ko', 'ja', 'th'] as const;
export type Locale = (typeof LOCALES)[number];

export type TokenRow = {
  /** Top-level namespace (screen/domain), e.g. "Sidebar". */
  ns: string;
  /** Full dotted leaf path, e.g. "Sidebar.transcripts". */
  path: string;
  /** Path with the namespace prefix stripped, e.g. "transcripts". */
  subKey: string;
  /** Rendered value per locale; null when the locale has no leaf at this path. */
  values: Record<Locale, string | null>;
  /** Locales missing this key relative to en (empty = full parity). */
  missing: Locale[];
};

export type NamespaceStat = { ns: string; count: number };

export type Coverage = {
  locale: Locale;
  have: number;
  total: number;
  pct: number;
  missing: number;
};

export type GlossaryRow = {
  concept: string;
  en: string;
  ko: string;
  ja: string;
  th: string;
};

export type WritingRule = { title: string; body: string };

export type WritingSystemData = {
  rows: TokenRow[];
  namespaces: NamespaceStat[];
  coverage: Coverage[];
  totalKeys: number;
  /** true once every locale hits exact parity with en (parity gate green). */
  parityHolds: boolean;
  glossary: GlossaryRow[];
  rules: WritingRule[];
};

type Json = Record<string, unknown>;

function isPlainObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Coerce a leaf value (string / number / boolean / array) to display text. */
function coerce(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => coerce(x)).join(' · ');
  return String(v);
}

/** Flatten to dotted-path → rendered value (arrays and scalars are leaves). */
function flatten(obj: Json, prefix = '', out = new Map<string, string>()): Map<string, string> {
  for (const key of Object.keys(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (isPlainObject(value)) flatten(value, path, out);
    else out.set(path, coerce(value));
  }
  return out;
}

function readMessages(locale: Locale): Map<string, string> {
  const file = join(process.cwd(), 'messages', `${locale}.json`);
  return flatten(JSON.parse(readFileSync(file, 'utf8')) as Json);
}

// Parse the §5 glossary markdown table out of docs/WRITING.md. Values are read
// from the file (never authored as literals here), so the source of this view
// carries no non-en literals — the parity/Korean-literal guards stay green.
function parseGlossary(): GlossaryRow[] {
  let md: string;
  try {
    md = readFileSync(join(process.cwd(), 'docs', 'WRITING.md'), 'utf8');
  } catch {
    return [];
  }
  const lines = md.split('\n');
  const start = lines.findIndex((l) => /^##\s+5\./.test(l));
  if (start < 0) return [];

  const rows: GlossaryRow[] = [];
  for (let j = start + 1; j < lines.length; j++) {
    const line = lines[j];
    if (/^##\s/.test(line)) break; // next top-level section
    if (!line.trim().startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.replace(/`/g, '').trim());
    if (cells.length < 5) continue;
    if (cells.every((c) => /^-+$/.test(c))) continue; // separator row
    if (cells[1] === 'en' && cells[2] === 'ko') continue; // header row
    rows.push({
      concept: cells[0],
      en: cells[1],
      ko: cells[2],
      ja: cells[3],
      th: cells[4],
    });
  }
  return rows;
}

// Writing rules digest (WRITING.md §1/§3/§4/§6/§7). English-only chrome — this
// view is super-admin internal (en-first allowed) and stays literal-free of
// non-en text so the Korean-literal ratchet never trips on a new surface.
function writingRules(): WritingRule[] {
  return [
    {
      title: 'Invariant 1 — no Korean in the default view',
      body: 'User-facing source must never hardcode Korean string literals. Every visible string comes from messages/{en,ko,ja,th}.json. CI enforces this with the Korean-literal ratchet guard.',
    },
    {
      title: 'Invariant 2 — no raw keys on screen',
      body: 'A missing key makes next-intl render the dotted path itself. Every new key ships at least an en value; en is the final fallback in the 4-locale chain.',
    },
    {
      title: 'Per-locale native copy',
      body: 'Keys are shared across 4 locales, values are native-optimized per locale. en and ko are each first-class (not translations of each other); ja/th are LLM-tier via pnpm i18n:seed, promotable to native review.',
    },
    {
      title: 'Exact key parity (hard-lock)',
      body: 'en/ja/ko/th must carry exactly en’s leaf-key set — no missing (en-fallback leak) and no orphans. scripts/check-i18n.ts fails CI on any drift.',
    },
    {
      title: 'Voice & tone (en)',
      body: 'US SaaS conventions: sentence case for titles and buttons, CTAs start with a verb, concise and direct, periods only on full sentences, emoji reserved for intentional accents.',
    },
    {
      title: 'Formatting via Intl.*',
      body: 'Dates, times, numbers and currency go through Intl.DateTimeFormat / Intl.NumberFormat with locale as an argument. Never assemble locale strings by hand. Currency baseline is USD.',
    },
    {
      title: 'Glossary is fixed',
      body: 'Product terms use the §5 glossary’s fixed per-locale rendering. Sentence tone is free; terminology follows the table. respondent vs participant stay distinct in ko.',
    },
  ];
}

export function collectWritingSystem(): WritingSystemData {
  const maps = {} as Record<Locale, Map<string, string>>;
  for (const loc of LOCALES) maps[loc] = readMessages(loc);

  const enPaths = [...maps.en.keys()]; // en file order
  const rows: TokenRow[] = enPaths.map((path) => {
    const dot = path.indexOf('.');
    const ns = dot === -1 ? path : path.slice(0, dot);
    const subKey = dot === -1 ? path : path.slice(dot + 1);
    const values = {} as Record<Locale, string | null>;
    const missing: Locale[] = [];
    for (const loc of LOCALES) {
      const has = maps[loc].has(path);
      values[loc] = has ? (maps[loc].get(path) ?? '') : null;
      if (!has) missing.push(loc);
    }
    return { ns, path, subKey, values, missing };
  });

  const nsOrder: string[] = [];
  const nsCount = new Map<string, number>();
  for (const row of rows) {
    if (!nsCount.has(row.ns)) nsOrder.push(row.ns);
    nsCount.set(row.ns, (nsCount.get(row.ns) ?? 0) + 1);
  }
  const namespaces: NamespaceStat[] = nsOrder.map((ns) => ({
    ns,
    count: nsCount.get(ns) ?? 0,
  }));

  const total = enPaths.length;
  const coverage: Coverage[] = LOCALES.map((loc) => {
    const have = enPaths.filter((p) => maps[loc].has(p)).length;
    return {
      locale: loc,
      have,
      total,
      pct: total === 0 ? 100 : (have / total) * 100,
      missing: total - have,
    };
  });
  const parityHolds = coverage.every((c) => c.missing === 0);

  return {
    rows,
    namespaces,
    coverage,
    totalKeys: total,
    parityHolds,
    glossary: parseGlossary(),
    rules: writingRules(),
  };
}

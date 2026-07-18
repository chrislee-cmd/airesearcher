// Shared view-model types + constants for the writing-system catalog. Kept in
// its own module (no node:fs / server-only) so the client catalog can import
// LOCALES and the types without pulling the server-only collector into the
// browser bundle.

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

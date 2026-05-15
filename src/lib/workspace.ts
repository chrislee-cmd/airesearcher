import type { FeatureKey } from '@/lib/features';

// DB-backed source of each workspace artifact. With localStorage removed
// in the workspace unification (see PROJECT.md changelog), every artifact
// has a dbFeature + dbId — they're the only way to fetch content.
export type DbBackedFeature =
  | 'report'
  | 'interview'
  | 'transcript'
  | 'desk'
  | 'scheduler'
  | 'recruiting'
  | 'generation';

// Server-shape list item (no content). Mirrors WorkspaceArtifactListItem
// in src/lib/workspace-server.ts; re-exported for client consumers.
export type WorkspaceArtifact = {
  id: string;
  featureKey: FeatureKey;
  title: string;
  createdAt: string;
  dbFeature: DbBackedFeature;
  dbId: string;
  projectId: string | null;
};

// Which target features can accept an artifact produced by source.
//
// Only destinations whose page actually reads the sessionStorage prefill
// are listed — adding a key here without a matching receiver in the
// destination component makes the kebab item a silent no-op (the user
// clicks "send to X", we navigate, X never reads the payload).
//
// Active receivers today:
//   - `keywords`  → FeaturePlaceholder textarea (generic)
//   - `desk`      → keyword chip input (split on commas/newlines)
//   - `reports`   → file list (text wrapped as synthetic .md)
//   - `interviews`→ file queue (text wrapped as synthetic .md)
export const SEND_TO_MAP: Partial<Record<FeatureKey, FeatureKey[]>> = {
  quotes: ['interviews', 'reports'],
  transcripts: ['interviews', 'reports'],
  interviews: ['reports'],
  desk: ['reports'],
  keywords: ['desk', 'reports'],
};

export const PREFILL_PREFIX = 'workspace:prefill:';

export function prefillKey(target: FeatureKey) {
  return `${PREFILL_PREFIX}${target}`;
}

import type { FeatureKey } from '@/lib/features';

export type DbBackedFeature =
  | 'report'
  | 'interview'
  | 'transcript'
  | 'desk'
  | 'scheduler'
  | 'recruiting';

export type WorkspaceArtifact = {
  id: string;
  featureKey: FeatureKey;
  title: string;
  content: string;
  createdAt: number;
  // DB linkage so each row in the workspace panel can be reassigned to
  // a project via /api/artifacts/assign. When absent the row shows the
  // dropdown disabled (local-only artifact).
  dbFeature?: DbBackedFeature;
  dbId?: string;
  projectId?: string | null;
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
//
// Removed historic destinations whose pages have no compatible input:
//   - `analyzer`  (ComingSoonCard — no input)
//   - `moderator` (services carousel — no input)
//   - `scheduler` (CSV / calendar — text doesn't map)
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

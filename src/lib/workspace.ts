import type { FeatureKey } from '@/lib/features';

export type WorkspaceArtifact = {
  id: string;
  featureKey: FeatureKey;
  title: string;
  content: string;
  createdAt: number;
};

// Which target features can accept an artifact produced by source.
// Conservative defaults — every target listed accepts free-text input today
// via the FeaturePlaceholder textarea (or its specialized analog).
export const SEND_TO_MAP: Partial<Record<FeatureKey, FeatureKey[]>> = {
  quotes: ['interviews', 'reports', 'analyzer', 'moderator'],
  transcripts: ['interviews', 'reports', 'analyzer'],
  interviews: ['reports', 'analyzer'],
  reports: ['analyzer'],
  moderator: ['scheduler'],
  analyzer: ['reports'],
  desk: ['reports', 'analyzer'],
  keywords: ['desk', 'reports'],
  recruiting: ['scheduler', 'moderator'],
};

export const PREFILL_PREFIX = 'workspace:prefill:';

export function prefillKey(target: FeatureKey) {
  return `${PREFILL_PREFIX}${target}`;
}

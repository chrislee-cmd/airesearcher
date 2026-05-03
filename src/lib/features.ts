export type FeatureKey =
  | 'quotes'
  | 'transcripts'
  | 'interviews'
  | 'reports'
  | 'scheduler'
  | 'moderator'
  | 'analyzer'
  | 'desk'
  | 'keywords'
  | 'recruiting';

export const FEATURES: { key: FeatureKey; href: string; cost: number }[] = [
  { key: 'quotes', href: '/quotes', cost: 1 },
  { key: 'transcripts', href: '/transcripts', cost: 2 },
  { key: 'interviews', href: '/interviews', cost: 3 },
  { key: 'reports', href: '/reports', cost: 5 },
  { key: 'scheduler', href: '/scheduler', cost: 1 },
  { key: 'moderator', href: '/moderator', cost: 3 },
  { key: 'analyzer', href: '/analyzer', cost: 5 },
  { key: 'desk', href: '/desk', cost: 3 },
  { key: 'keywords', href: '/keywords', cost: 2 },
  { key: 'recruiting', href: '/recruiting', cost: 3 },
];

export const FEATURE_COSTS: Record<FeatureKey, number> = Object.fromEntries(
  FEATURES.map((f) => [f.key, f.cost]),
) as Record<FeatureKey, number>;

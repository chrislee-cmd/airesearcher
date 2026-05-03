export type FeatureKey = 'quotes' | 'transcripts' | 'interviews' | 'reports';

export const FEATURES: { key: FeatureKey; href: string; cost: number }[] = [
  { key: 'quotes', href: '/quotes', cost: 1 },
  { key: 'transcripts', href: '/transcripts', cost: 2 },
  { key: 'interviews', href: '/interviews', cost: 3 },
  { key: 'reports', href: '/reports', cost: 5 },
];

export const FEATURE_COSTS: Record<FeatureKey, number> = Object.fromEntries(
  FEATURES.map((f) => [f.key, f.cost]),
) as Record<FeatureKey, number>;

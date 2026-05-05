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
  | 'recruiting'
  | 'survey';

// Credit costs are scaled around 1 credit ≈ ₩2,000.
// Heavy LLM synthesis (reports / analyzer) sits at 5; medium aggregations
// at 3; one-shot generations at 1. Per-file features (quotes / interviews
// convert) charge per uploaded file with a 90-min duration guideline.
export const FEATURES: { key: FeatureKey; href: string; cost: number }[] = [
  { key: 'quotes', href: '/quotes', cost: 1 },
  { key: 'transcripts', href: '/transcripts', cost: 1 },
  { key: 'interviews', href: '/interviews', cost: 3 },
  { key: 'reports', href: '/reports', cost: 5 },
  { key: 'scheduler', href: '/scheduler', cost: 1 },
  { key: 'moderator', href: '/moderator', cost: 1 },
  { key: 'analyzer', href: '/analyzer', cost: 5 },
  { key: 'desk', href: '/desk', cost: 3 },
  { key: 'keywords', href: '/keywords', cost: 2 },
  { key: 'recruiting', href: '/recruiting', cost: 1 },
  { key: 'survey', href: '/survey', cost: 1 },
];

// Single source of truth for credit pricing — read by both the
// purchase page and the sidebar copy.
export const CREDIT_PRICE_KRW = 2000;

export type CreditBundleId = 'starter' | 'team' | 'studio' | 'enterprise';

export type CreditBundle = {
  id: CreditBundleId;
  credits: number;
  // Total list price in KRW (null = "contact sales").
  priceKrw: number | null;
  // Effective per-credit price (computed). Convenience.
  perCreditKrw: number | null;
  discountPct: number;
  popular?: boolean;
};

export const CREDIT_BUNDLES: CreditBundle[] = [
  {
    id: 'starter',
    credits: 100,
    priceKrw: 200_000,
    perCreditKrw: 2_000,
    discountPct: 0,
  },
  {
    id: 'team',
    credits: 500,
    priceKrw: 900_000,
    perCreditKrw: 1_800,
    discountPct: 10,
    popular: true,
  },
  {
    id: 'studio',
    credits: 1_500,
    priceKrw: 2_550_000,
    perCreditKrw: 1_700,
    discountPct: 15,
  },
  {
    id: 'enterprise',
    credits: 5_000,
    priceKrw: null,
    perCreditKrw: null,
    discountPct: 25,
  },
];

export const FEATURE_COSTS: Record<FeatureKey, number> = Object.fromEntries(
  FEATURES.map((f) => [f.key, f.cost]),
) as Record<FeatureKey, number>;

// Sidebar grouping. Features not listed here are still routable but
// hidden from the sidebar — useful for legacy or work-in-progress flows.
export type FeatureGroupKey = 'design' | 'conduct' | 'analysis';

export const FEATURE_GROUPS: {
  key: FeatureGroupKey;
  features: FeatureKey[];
}[] = [
  { key: 'design', features: ['desk', 'recruiting', 'scheduler', 'transcripts'] },
  { key: 'conduct', features: ['moderator', 'survey'] },
  { key: 'analysis', features: ['quotes', 'interviews', 'reports', 'analyzer'] },
];

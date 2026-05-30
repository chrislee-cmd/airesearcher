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
  | 'survey'
  | 'quant'
  | 'affinity_bubble'
  | 'video'
  | 'translate'
  // Global voice concierge — not a sidebar item, mounted as a FAB in
  // (app)/layout.tsx. Cost is stubbed at 0 for PR1; the credit policy
  // is still open (design §12.5) so the foundation ships as free beta.
  | 'voice_concierge';

// Credit costs are scaled around 1 credit ≈ ₩2,000.
// Three marquee features carry the value: 전사록 / 인터뷰 결과 / 데스크 리서치.
// All other utility-style generations sit at 1 credit so they don't gate exploration.
// `cost` is the canonical (most common) price displayed in headers.
// For features with conditional pricing (e.g. scheduler — only the CSV
// upload path charges), the cost is the *base* price; the conditional
// surcharge is described in the locale `Features.<key>.cost` string and
// enforced on the server when applicable.
export const FEATURES: { key: FeatureKey; href: string; cost: number }[] = [
  { key: 'quotes', href: '/quotes', cost: 25 },
  { key: 'transcripts', href: '/transcripts', cost: 1 },
  { key: 'interviews', href: '/interviews', cost: 10 },
  { key: 'reports', href: '/reports', cost: 50 },
  { key: 'scheduler', href: '/scheduler', cost: 0 },
  { key: 'moderator', href: '/moderator', cost: 1 },
  { key: 'analyzer', href: '/analyzer', cost: 1 },
  { key: 'desk', href: '/desk', cost: 25 },
  { key: 'keywords', href: '/keywords', cost: 1 },
  { key: 'recruiting', href: '/recruiting', cost: 10 },
  { key: 'survey', href: '/survey', cost: 1 },
  { key: 'quant', href: '/quant', cost: 15 },
  // Affinity Bubble is a partner showcase, not an in-app generator;
  // cost stays 0, the page just previews the offering and links out.
  { key: 'affinity_bubble', href: '/affinity-bubble', cost: 0 },
  // video is priced dynamically by duration (2 credits per started 10min);
  // the value here is the minimum charge surfaced in sidebar / cost pills.
  { key: 'video', href: '/video', cost: 2 },
  // AI 동시통역. Lump 50 credits (₩100k) covers the first 10 minutes; each
  // additional 10-minute window adds 10 credits (₩20k). Sidebar shows the
  // lump as the headline number; the per-10-minute surcharge lives in the
  // locale `Features.translate.cost` string.
  { key: 'translate', href: '/live', cost: 50 },
  // Global voice concierge — bottom-right FAB on every (app) route. No
  // dedicated page in PR1 (the FAB only pops a coming-soon toast); the
  // href is reserved for future expand/settings routes. Free during the
  // beta — credit policy lands with PR2/PR3 (design §12.5).
  { key: 'voice_concierge', href: '/voice', cost: 0 },
];

// Features still in development — hidden from the sidebar and gated at
// the route level for everyone except super-admin orgs (organizations
// with `is_unlimited = true`). Move a key out of this list to GA the
// feature for all users.
export const PREVIEW_FEATURES: ReadonlySet<FeatureKey> = new Set<FeatureKey>([
  'recruiting',
  'transcripts',  // 스크립트 생성기 (audio→script). The 전사록 path is `quotes`.
  'survey',
  'analyzer',
  'scheduler',
  'quant',
  'video',
  'translate',
  'voice_concierge',
]);

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
  { key: 'conduct', features: ['moderator', 'survey', 'translate'] },
  { key: 'analysis', features: ['quotes', 'interviews', 'reports', 'analyzer', 'quant', 'video', 'affinity_bubble'] },
];

// Provision (reconcile) the new ₩500/cr pricing scheme on Lemon Squeezy —
// 5 no-discount credit packs (mini/starter/plus/pro/max) + 3 monthly
// subscription tiers (solo/plus/pro), across the KRW and USD stores = 16
// desired variants. Prices come *only* from `src/lib/features.ts`
// (CREDIT_BUNDLES + SUBSCRIPTION_TIERS = docs/pricing-scheme.md §5), never
// hardcoded here — the SSOT is the single source of truth.
//
// ── ⚠️ HARD CONSTRAINT: Lemon Squeezy has no create/update product API ──────
//
// The spec asked for "LS API 로 상품/variant 멱등 *생성*". After verifying the
// Lemon Squeezy API v1 surface, that is **not possible**: products, variants
// and prices are READ-ONLY over the API (GET list/one). There is no POST/PATCH
// to create or edit them — that is dashboard-only. (Open feature request:
// lemonsqueezy.nolt.io/279 "API to create and update products and variants";
// the Variant/Product/Price object docs are all read endpoints.)
//
// 질문 금지 룰(워커는 jarvis/사용자에게 확인 불가) 하에 **가장 보수적 해석**으로
// 재설계했습니다 — 스펙의 진짜 목표(SSOT 기반 · 멱등 · env 키 출력 · 안전 게이트)는
// 그대로 지키되, 불가능한 "API create" 를 다음으로 대체합니다:
//
//   1) RECONCILE (기본, read-only, 멱등): features.ts → desired 16 을 계산하고
//      각 스토어의 기존 Product/Variant 를 GET 으로 나열 → **variant SKU 정확일치**
//      로 매칭(레거시 상품은 `AIR • kind • id` 이름 토큰 폴백) → 각 항목을
//      OK(variant id 확보) / MISSING(대시보드 생성 필요) / DRIFT(가격·주기 불일치
//      → 대시보드 수정) 로 판정. read-only 라 재실행해도 결과 동일(멱등). 매칭된
//      variant id 를 A1 env 키명으로 paste-ready 출력.
//
//   ── 네이밍 B안: 브랜드 표시명 + variant SKU 매칭키 분리 (2026-07-13) ──────────
//   과거 `AIR • pack • mini` 규약은 **표시명 + 매칭키를 한 필드에 혼합** → 결제창·
//   영수증·인보이스·세무기록에 `AIR •` 가 그대로 노출됐다. 정식 제품명은
//   **Research Canvas**. 두 관심사를 분리한다:
//     · Product Name (노출용)  = 브랜드 표시명. 예: "Research Canvas — 크레딧 팩 Mini (50)"
//     · variant SKU (매칭키)   = 안정 키. 예: "rc-pack-mini" (표시명 바뀌어도 불변)
//   ⚠️ LS API v1 은 Variant/Price 어디에도 **native `sku` 필드가 없다**(2026-07
//   문서 확인). 따라서 SKU 는 운영자가 제어 가능하고 표시명과 독립인 **Variant
//   Name** 필드에 넣는다(단일 variant 상품에서 체크아웃은 Product Name 을 노출,
//   Variant Name 은 매칭 전용). 매칭은 `variant.attributes.sku`(향후/일부 스토어가
//   노출할 수 있어 방어적으로 우선) → `variant.attributes.name` 순으로 정규화
//   정확일치. SKU prefix `rc-`(research canvas). 확정 규약표는 `docs/lemonsqueezy-naming.md`.
//
//   2) WEBHOOK upsert (--webhook, API 로 실제 write 가능한 유일 리소스):
//      각 스토어의 웹훅을 URL 로 매칭 → 없으면 create / 이벤트 누락 시 events union
//      PATCH. 구독 이벤트(subscription_*)까지 구독 등록해 B1(구독 백엔드) 대비.
//      실제 API write 라 **--commit 게이트** 뒤에서만 수행(dry-run 은 plan 만).
//
// 즉 이 스크립트는 "API 자동 create" 가 아니라 **대조 + 대시보드 생성 가이드 +
// 멱등 webhook 관리** 툴입니다. MISSING 항목은 스크립트가 정확한 생성 스펙(이름/
// 가격/주기)을 찍어주고 Chris 가 대시보드에서 1회 생성한 뒤, 이 스크립트를 다시
// 돌리면 매칭되어 env 블록이 완성됩니다. 이 흐름 자체가 멱등입니다.
//
// ── 안전 게이트 (recruiting-backfill 3게이트 선례) ─────────────────────────────
//   (no flag)   RECONCILE 리포트 + env 블록. LS write 없음(GET 만). (진단)
//   --dry-run   위 + webhook plan(생성/patch 예정)만 출력. write 없음.
//   --commit    위 + webhook 실제 upsert(--webhook 동반 시). 실제 API write.
//   --webhook   webhook 대조/관리 포함(구독 이벤트). 없으면 상품 대조만.
// 스코프: --store krw|usd|all · --fx <KRW_PER_USD>(USD 예상가 환산율).
//
// ── RUN (repo/worktree 루트에서, .env.local 에 LS 키가 있어야 함) ──────────────
//   node --experimental-strip-types --env-file=.env.local \
//     scripts/provision-lemonsqueezy-products.ts                 # 대조 + env 블록
//   node --experimental-strip-types --env-file=.env.local \
//     scripts/provision-lemonsqueezy-products.ts --webhook --dry-run
//   node --experimental-strip-types --env-file=.env.local \
//     scripts/provision-lemonsqueezy-products.ts --webhook --commit
//
// tsconfig 는 `scripts` 를 exclude 하므로 이 파일은 typecheck/build 대상 밖이고
// `node --experimental-strip-types` 로 실행됩니다(recruiting-backfill 선례).

import { randomBytes } from 'crypto';
import {
  CREDIT_BUNDLES,
  SUBSCRIPTION_TIERS,
  CREDIT_PRICE_KRW,
  type CreditBundle,
  type SubscriptionTier,
} from '../src/lib/features.ts';

const LS_API_BASE = 'https://api.lemonsqueezy.com/v1';
const LS_HEADERS_READ = {
  Accept: 'application/vnd.api+json',
} as const;

// USD has no SSOT price (features.ts defines only KRW). We DERIVE an expected
// USD figure from the KRW SSOT via this FX rate purely to flag drift and to
// suggest a dashboard value — it is an *operational assumption*, not SSOT, and
// is overridable with --fx. The real USD price is whatever the operator sets
// in the USD store; the script only guides.
const DEFAULT_KRW_PER_USD = 1400;

type Currency = 'KRW' | 'USD';
const CURRENCIES: Currency[] = ['KRW', 'USD'];

type Kind = 'pack' | 'sub';

// One desired Lemon Squeezy variant, derived entirely from the SSOT.
type Desired = {
  kind: Kind;
  id: string; // bundle/tier id, e.g. 'mini' | 'solo'
  currency: Currency;
  credits: number; // pack credits or subscription included credits/month
  priceKrw: number; // SSOT KRW amount (one-time for packs, monthly for subs)
  interval: 'one_time' | 'month';
  envKey: string; // A1 mapping key (env.ts)
  displayName: string; // brand Product Name (exposed on checkout/receipts)
  sku: string; // stable variant SKU = machine match key (display-independent)
  legacyMatchName: string; // old `AIR • kind • id` — name-token fallback only
};

// A1 env-key convention (must match src/env.ts exactly):
//   packs → LEMONSQUEEZY_VARIANT_PACK_{MINI,STARTER,PLUS,PRO,MAX}_{KRW,USD}
//   subs  → LEMONSQUEEZY_SUB_{SOLO,PLUS,PRO}_{KRW,USD}
function envKeyFor(kind: Kind, id: string, currency: Currency): string {
  const idUpper = id.toUpperCase();
  return kind === 'pack'
    ? `LEMONSQUEEZY_VARIANT_PACK_${idUpper}_${currency}`
    : `LEMONSQUEEZY_SUB_${idUpper}_${currency}`;
}

// Capitalized tier label for the display name (mini → Mini). Matches the app
// i18n bundle labels (messages.Credits.bundle{Mini,Starter,Plus,Pro,Max}) so
// the LS product name stays consistent with in-app copy.
function tierLabel(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

// Brand display name = the LS Product Name the operator sets in the dashboard.
// This is what shows on hosted checkout / receipts / invoices / tax records.
// Quantity is derived from the SSOT credits so the copy never drifts.
//   pack → "Research Canvas — 크레딧 팩 Mini (50)"
//   sub  → "Research Canvas — 구독 Plus (월 60cr)"
function displayNameFor(kind: Kind, id: string, credits: number): string {
  const label = tierLabel(id);
  return kind === 'pack'
    ? `Research Canvas — 크레딧 팩 ${label} (${credits.toLocaleString('en-US')})`
    : `Research Canvas — 구독 ${label} (월 ${credits}cr)`;
}

// Stable variant SKU = the machine match key, independent of the marketing
// display name. Set as the *Variant Name* in the dashboard (LS has no native
// `sku` attribute — see header). `rc-` = Research Canvas. The pack/sub segment
// is REQUIRED: `plus`/`pro` exist as both a pack and a sub, so the discriminator
// keeps `rc-pack-plus` (300cr one-time) distinct from `rc-sub-plus` (60cr/mo).
function skuFor(kind: Kind, id: string): string {
  return `rc-${kind}-${id}`;
}

// Legacy `AIR • kind • id` product-name convention — kept ONLY as a matching
// fallback so pre-existing products without a SKU still reconcile. New products
// match by SKU; this never appears on any new display name.
function legacyMatchNameFor(kind: Kind, id: string): string {
  return `AIR • ${kind} • ${id}`;
}

// Normalize a name for tolerant matching: lowercase, strip non-alphanumerics
// to spaces, collapse. "AIR • pack • mini" → "air pack mini".
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Build the 16 desired variants purely from the SSOT arrays — zero hardcoded
// prices. Packs are one-time; subscription tiers are monthly.
function buildDesired(fx: number): Desired[] {
  const out: Desired[] = [];
  for (const currency of CURRENCIES) {
    for (const b of CREDIT_BUNDLES as CreditBundle[]) {
      // priceKrw can be null ("contact sales") in the type; all current packs
      // are real prices, but guard anyway — a null-priced pack is not a
      // provisionable fixed variant, so skip with a note at match time.
      out.push({
        kind: 'pack',
        id: b.id,
        currency,
        credits: b.credits,
        priceKrw: b.priceKrw ?? 0,
        interval: 'one_time',
        envKey: envKeyFor('pack', b.id, currency),
        displayName: displayNameFor('pack', b.id, b.credits),
        sku: skuFor('pack', b.id),
        legacyMatchName: legacyMatchNameFor('pack', b.id),
      });
    }
    for (const t of SUBSCRIPTION_TIERS as SubscriptionTier[]) {
      out.push({
        kind: 'sub',
        id: t.id,
        currency,
        credits: t.includedCredits,
        priceKrw: t.monthlyPriceKrw,
        interval: 'month',
        envKey: envKeyFor('sub', t.id, currency),
        displayName: displayNameFor('sub', t.id, t.includedCredits),
        sku: skuFor('sub', t.id),
        legacyMatchName: legacyMatchNameFor('sub', t.id),
      });
    }
  }
  // fx only affects the *display/drift* of USD; keep it referenced so the
  // derivation stays visible at the call site.
  void fx;
  return out;
}

// Expected price in Lemon Squeezy's integer minor unit ("cents"). LS stores
// EVERY currency in 2-decimal minor units — including KRW, a real-world
// zero-decimal currency: a ₩25,000 product comes back as `2500000` (won × 100).
// (Empirically verified against store 393383 — every KRW variant returned ×100.
// The earlier "zero-decimal → won == unit" assumption was wrong and made the
// DRIFT check false-positive on every KRW product.) So multiply by 100 for both.
function expectedCents(d: Desired, fx: number): number {
  if (d.currency === 'KRW') return d.priceKrw * 100; // won × 100 minor units
  return Math.round((d.priceKrw / fx) * 100); // USD cents, derived via FX
}

// `minor` is LS's 2-decimal minor unit. KRW shows as whole won (no decimals),
// USD as dollars with cents.
function formatMoney(minor: number, currency: Currency): string {
  if (currency === 'KRW') return `₩${(minor / 100).toLocaleString('en-US')}`;
  return `$${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Lemon Squeezy read API (plain fetch, JSON:API) ──────────────────────────

type LsResource = {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
};
type LsListResponse = {
  data: LsResource[];
  links?: { next?: string | null };
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing env ${name}. Run with --env-file=.env.local (or export it).`,
    );
  }
  return v;
}

async function lsGet(
  apiKey: string,
  path: string,
): Promise<LsResource[]> {
  const out: LsResource[] = [];
  let url: string | null = path.startsWith('http')
    ? path
    : `${LS_API_BASE}${path}`;
  while (url) {
    const res: Response = await fetch(url, {
      headers: { ...LS_HEADERS_READ, Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `lemonsqueezy_get_failed status=${res.status} url=${url} body=${text.slice(0, 300)}`,
      );
    }
    const json = (await res.json()) as LsListResponse;
    out.push(...(json.data ?? []));
    url = json.links?.next ?? null;
  }
  return out;
}

type StoreVariant = {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  sku: string | null; // explicit `sku` attribute if the store exposes one
  priceCents: number | null;
  interval: string | null; // 'month' | 'year' | null (one-time)
  isSubscription: boolean;
};

// Fetch every product in a store together with its variants, flattened.
async function fetchStoreVariants(
  apiKey: string,
  storeId: string,
): Promise<StoreVariant[]> {
  const products = await lsGet(
    apiKey,
    `/products?filter[store_id]=${encodeURIComponent(storeId)}&page[size]=100`,
  );
  const result: StoreVariant[] = [];
  for (const p of products) {
    const productName = String(p.attributes.name ?? '');
    const variants = await lsGet(
      apiKey,
      `/variants?filter[product_id]=${encodeURIComponent(p.id)}&page[size]=100`,
    );
    for (const v of variants) {
      const a = v.attributes;
      const priceRaw = a.price;
      const interval = a.interval;
      // LS variants have no native `sku` attribute (API v1). Read it defensively
      // anyway — a store/plan may expose one — and fall back to the variant name
      // (where the operator stores the SKU by convention) at match time.
      const skuRaw = a.sku;
      result.push({
        variantId: v.id,
        productId: p.id,
        productName,
        variantName: String(a.name ?? ''),
        sku:
          typeof skuRaw === 'string' && skuRaw.trim() !== ''
            ? skuRaw.trim()
            : null,
        priceCents:
          typeof priceRaw === 'number'
            ? priceRaw
            : typeof priceRaw === 'string' && priceRaw !== ''
              ? Number(priceRaw)
              : null,
        interval:
          typeof interval === 'string' && interval !== '' ? interval : null,
        isSubscription: a.is_subscription === true,
      });
    }
  }
  return result;
}

// ── Matching + reconcile ────────────────────────────────────────────────────

type MatchStatus = 'ok' | 'drift' | 'missing' | 'ambiguous';
type Reconciled = {
  desired: Desired;
  status: MatchStatus;
  variantId?: string;
  notes: string[];
};

// The stable SKU carried by a store variant. LS has no native `sku` attribute,
// so the convention stores it as the Variant Name; we still prefer an explicit
// `sku` attribute when present. Normalized so "rc-pack-mini" == "rc pack mini".
function variantSku(v: StoreVariant): string | null {
  const raw = v.sku ?? v.variantName;
  const n = normalizeName(raw ?? '');
  return n === '' ? null : n;
}

function reconcileOne(
  d: Desired,
  storeVariants: StoreVariant[],
  fx: number,
): Reconciled {
  const notes: string[] = [];
  if (d.priceKrw === 0) {
    notes.push(
      'SSOT priceKrw is null/0 ("contact sales") — not a fixed provisionable variant.',
    );
  }

  // Primary: exact variant-SKU match. Display/product name can change freely
  // (brand copy) without breaking the match — the whole point of B안.
  const wantSku = normalizeName(d.sku);
  let candidates = storeVariants.filter((v) => variantSku(v) === wantSku);
  let matchedBy: 'sku' | 'legacy-name' = 'sku';

  // Fallback: legacy `AIR • kind • id` product-name token match, for products
  // created before the SKU convention. Only consulted when SKU matched nothing,
  // so a correctly-SKU'd store never depends on the brittle name path.
  if (candidates.length === 0) {
    const wantNorm = normalizeName(d.legacyMatchName);
    const wantTokens = wantNorm.split(' '); // ['air', kind, id]
    candidates = storeVariants.filter((v) => {
      const pn = normalizeName(v.productName);
      if (pn === wantNorm) return true;
      return wantTokens.every((t) => pn.split(' ').includes(t));
    });
    matchedBy = 'legacy-name';
    if (candidates.length > 0) {
      notes.push(
        `matched by legacy name (AIR • …) — set variant SKU "${d.sku}" in the dashboard so matching no longer depends on the product name.`,
      );
    }
  }

  if (candidates.length === 0) {
    return { desired: d, status: 'missing', notes };
  }
  if (candidates.length > 1) {
    const key = matchedBy === 'sku' ? `SKU "${d.sku}"` : `"${d.legacyMatchName}"`;
    notes.push(
      `${candidates.length} variants matched ${key} — ${
        matchedBy === 'sku'
          ? 'each SKU must be unique across the store.'
          : 'narrow the naming so exactly one matches.'
      } Candidates: ${candidates
        .map((c) => `${c.productName}/${c.variantName}#${c.variantId}`)
        .join(', ')}`,
    );
    return { desired: d, status: 'ambiguous', notes };
  }

  const v = candidates[0];
  const want = expectedCents(d, fx);

  // Interval drift (subscription vs one-time).
  const wantMonthly = d.interval === 'month';
  const gotMonthly = v.isSubscription || v.interval === 'month';
  if (wantMonthly !== gotMonthly) {
    notes.push(
      `interval drift — SSOT wants ${d.interval}, LS variant is ${gotMonthly ? 'subscription/month' : 'one-time'}`,
    );
  }

  // Price drift. For USD the expectation is FX-derived, so flag as "verify"
  // rather than a hard error.
  if (v.priceCents == null) {
    notes.push('LS variant has no readable price — verify in dashboard.');
  } else if (v.priceCents !== want) {
    const got = formatMoney(v.priceCents, d.currency);
    const exp = formatMoney(want, d.currency);
    notes.push(
      d.currency === 'USD'
        ? `price differs — LS ${got} vs derived ${exp} (FX ${fx}); USD has no SSOT, verify intended.`
        : `price drift — LS ${got} vs SSOT ${exp}. Fix in dashboard.`,
    );
  }

  const hasDrift = notes.some(
    (n) => n.includes('drift') || n.startsWith('price differs'),
  );
  return {
    desired: d,
    status: hasDrift ? 'drift' : 'ok',
    variantId: v.variantId,
    notes,
  };
}

// ── Webhook upsert (the one API-writable resource) ──────────────────────────

// Events the app cares about. order_* drive one-time pack fulfilment (handled
// today in /api/billing/webhook); subscription_* are registered ahead of B1
// (subscription backend) so the store already emits them when B1 lands.
const DESIRED_WEBHOOK_EVENTS = [
  'order_created',
  'order_refunded',
  'subscription_created',
  'subscription_updated',
  'subscription_cancelled',
  'subscription_resumed',
  'subscription_expired',
  'subscription_paused',
  'subscription_unpaused',
  'subscription_payment_success',
  'subscription_payment_failed',
];

function webhookUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ??
    'https://<NEXT_PUBLIC_SITE_URL missing>';
  return `${base}/api/billing/webhook`;
}

type WebhookPlan = {
  currency: Currency;
  storeId: string;
  action: 'create' | 'patch-events' | 'ok';
  existingId?: string;
  missingEvents: string[];
  url: string;
};

async function planWebhook(
  apiKey: string,
  currency: Currency,
  storeId: string,
): Promise<WebhookPlan> {
  const url = webhookUrl();
  const hooks = await lsGet(
    apiKey,
    `/webhooks?filter[store_id]=${encodeURIComponent(storeId)}&page[size]=100`,
  );
  const match = hooks.find((h) => String(h.attributes.url ?? '') === url);
  if (!match) {
    return { currency, storeId, action: 'create', missingEvents: DESIRED_WEBHOOK_EVENTS, url };
  }
  const events = Array.isArray(match.attributes.events)
    ? (match.attributes.events as string[])
    : [];
  const missing = DESIRED_WEBHOOK_EVENTS.filter((e) => !events.includes(e));
  return {
    currency,
    storeId,
    action: missing.length ? 'patch-events' : 'ok',
    existingId: match.id,
    missingEvents: missing,
    url,
  };
}

async function commitWebhook(
  apiKey: string,
  plan: WebhookPlan,
): Promise<void> {
  if (plan.action === 'ok') return;
  if (plan.action === 'create') {
    const secret = randomBytes(20).toString('hex'); // 40 hex chars (≥16, ≤40)
    const body = {
      data: {
        type: 'webhooks',
        attributes: {
          url: plan.url,
          events: DESIRED_WEBHOOK_EVENTS,
          secret,
        },
        relationships: {
          store: { data: { type: 'stores', id: plan.storeId } },
        },
      },
    };
    const res = await fetch(`${LS_API_BASE}/webhooks`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`webhook_create_failed status=${res.status} body=${text.slice(0, 300)}`);
    }
    console.log(`    ✅ webhook created for ${plan.currency} store.`);
    console.log(
      `    🔑 SET THIS SECRET IN ENV → LEMONSQUEEZY_WEBHOOK_SECRET_${plan.currency}=${secret}`,
    );
    console.log('       (register in Vercel 3 envs + SSOT via add-key.sh; shown ONCE)');
    return;
  }
  // patch-events: union the missing events onto the existing hook. LS PATCH
  // replaces the events array, so send the full desired set.
  const body = {
    data: {
      type: 'webhooks',
      id: plan.existingId,
      attributes: { events: DESIRED_WEBHOOK_EVENTS },
    },
  };
  const res = await fetch(`${LS_API_BASE}/webhooks/${plan.existingId}`, {
    method: 'PATCH',
    headers: {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`webhook_patch_failed status=${res.status} body=${text.slice(0, 300)}`);
  }
  console.log(
    `    ✅ webhook events updated for ${plan.currency} store (+${plan.missingEvents.join(', ')}).`,
  );
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const flags = {
    commit: argv.includes('--commit'),
    dryRun: argv.includes('--dry-run'),
    webhook: argv.includes('--webhook'),
    help: argv.includes('--help') || argv.includes('-h'),
    store: 'all' as 'all' | 'krw' | 'usd',
    fx: DEFAULT_KRW_PER_USD,
  };
  const readValue = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const store = readValue('--store');
  if (store === 'krw' || store === 'usd' || store === 'all') flags.store = store;
  const fxRaw = readValue('--fx');
  if (fxRaw) {
    const n = Number.parseFloat(fxRaw);
    if (Number.isFinite(n) && n > 0) flags.fx = n;
  }
  return flags;
}

function resolveStore(currency: Currency): string | null {
  if (currency === 'KRW') {
    return (
      process.env.LEMONSQUEEZY_STORE_ID_KRW ??
      process.env.LEMONSQUEEZY_STORE_ID ??
      null
    );
  }
  return process.env.LEMONSQUEEZY_STORE_ID_USD ?? null;
}

const STATUS_ICON: Record<MatchStatus, string> = {
  ok: '✅',
  drift: '⚠️',
  missing: '❌',
  ambiguous: '❓',
};

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(
      [
        'provision-lemonsqueezy-products — 신 ₩500/cr 팩·구독 LS 대조 프로비저닝',
        '',
        '  ⚠️ LS API 는 상품/variant 생성 미지원(대시보드 전용). 이 스크립트는',
        '     SSOT(features.ts) ↔ LS 대조 + 대시보드 생성 가이드 + webhook 멱등 관리.',
        '',
        '  (no flag)   대조 리포트 + env 키 블록 출력 (LS GET 만, write 없음)',
        '  --dry-run   위 + webhook 생성/patch plan 출력 (write 없음)',
        '  --commit    위 + webhook 실제 upsert (--webhook 동반 시). 실제 API write',
        '  --webhook   webhook 대조/관리 포함 (구독 이벤트 등록, B1 대비)',
        '  --store <krw|usd|all>   스토어 스코프 (기본 all)',
        '  --fx <KRW_PER_USD>      USD 예상가 환산율 (기본 ' + DEFAULT_KRW_PER_USD + ', SSOT 아님)',
        '',
        '  예) node --experimental-strip-types --env-file=.env.local \\',
        '        scripts/provision-lemonsqueezy-products.ts --webhook --dry-run',
      ].join('\n'),
    );
    return;
  }

  const apiKey = requireEnv('LEMONSQUEEZY_API_KEY');
  const fx = flags.fx;
  const desired = buildDesired(fx);

  console.log('\n═══ Lemon Squeezy 상품 대조 (SSOT: features.ts, ₩' + CREDIT_PRICE_KRW + '/cr) ═══');
  console.log(
    `desired = ${desired.length} variants (팩 ${CREDIT_BUNDLES.length} + 구독 ${SUBSCRIPTION_TIERS.length}) × ${CURRENCIES.length} 통화`,
  );
  console.log(`USD 예상가는 FX ${fx} KRW/USD 로 환산 (SSOT 아님 — 대시보드 실값 우선).\n`);

  const wantCurrencies: Currency[] =
    flags.store === 'krw' ? ['KRW'] : flags.store === 'usd' ? ['USD'] : CURRENCIES;

  const reconciled: Reconciled[] = [];
  for (const currency of wantCurrencies) {
    const storeId = resolveStore(currency);
    console.log(`── ${currency} store ─────────────────────────────`);
    if (!storeId) {
      console.log(
        `  (skip) ${currency} 스토어 env 미설정 — ${
          currency === 'KRW'
            ? 'LEMONSQUEEZY_STORE_ID_KRW / LEMONSQUEEZY_STORE_ID'
            : 'LEMONSQUEEZY_STORE_ID_USD'
        } 없음.\n`,
      );
      // Still emit the desired rows as MISSING so the env block is complete.
      for (const d of desired.filter((x) => x.currency === currency)) {
        reconciled.push({ desired: d, status: 'missing', notes: ['store env unset'] });
      }
      continue;
    }
    const storeVariants = await fetchStoreVariants(apiKey, storeId);
    console.log(`  store=${storeId} · 기존 variant ${storeVariants.length}개 조회.`);
    for (const d of desired.filter((x) => x.currency === currency)) {
      const r = reconcileOne(d, storeVariants, fx);
      reconciled.push(r);
      const want = expectedCents(d, fx);
      const price = formatMoney(want, currency);
      const intervalLabel = d.interval === 'month' ? '/월' : ' 일회성';
      const idPart = `${STATUS_ICON[r.status]} ${d.sku.padEnd(16)} ${price}${intervalLabel} (${d.credits}cr)`;
      console.log(`  ${idPart}${r.variantId ? ` → variant ${r.variantId}` : ''}`);
      for (const n of r.notes) console.log(`       · ${n}`);
    }
    console.log('');
  }

  // ── Summary ──
  const counts = reconciled.reduce(
    (acc, r) => {
      acc[r.status] += 1;
      return acc;
    },
    { ok: 0, drift: 0, missing: 0, ambiguous: 0 } as Record<MatchStatus, number>,
  );
  console.log('── 대조 요약 ─────────────────────────────');
  console.log(
    `  ✅ OK ${counts.ok} · ⚠️ DRIFT ${counts.drift} · ❌ MISSING ${counts.missing} · ❓ AMBIGUOUS ${counts.ambiguous}`,
  );
  if (counts.missing > 0 || counts.ambiguous > 0 || counts.drift > 0) {
    console.log(
      '\n  ⓘ MISSING/AMBIGUOUS/DRIFT 은 대시보드 액션 필요 (LS API 로 상품 생성 불가).',
    );
    console.log('    대시보드에서 아래 Product Name(표시명) · Variant SKU · 가격 · 주기로 생성/수정 후 재실행:');
    for (const r of reconciled.filter((x) => x.status !== 'ok')) {
      const d = r.desired;
      const want = expectedCents(d, fx);
      console.log(
        `      [${r.status}] name="${d.displayName}" · SKU=${d.sku} (${d.currency}) — ${formatMoney(want, d.currency)}${
          d.interval === 'month' ? ' / month (subscription)' : ' one-time'
        } · ${d.credits}cr`,
      );
    }
  }

  // ── Paste-ready env block (A1 keys) ──
  console.log('\n── env 블록 (A1 키 규약, add-key.sh 로 3환경+SSOT 반영) ──────────');
  for (const r of reconciled) {
    if (r.variantId) {
      console.log(`${r.desired.envKey}=${r.variantId}`);
    } else {
      console.log(
        `# ${r.desired.envKey}=  # ${r.status}: 대시보드에서 name="${r.desired.displayName}" · SKU=${r.desired.sku} (${r.desired.currency}) 생성 후 재실행`,
      );
    }
  }

  // ── Webhook management (opt-in) ──
  if (flags.webhook) {
    console.log('\n── webhook 대조 (구독 이벤트, B1 대비) ─────────────────────');
    console.log(`  target url = ${webhookUrl()}`);
    for (const currency of wantCurrencies) {
      const storeId = resolveStore(currency);
      if (!storeId) {
        console.log(`  (skip) ${currency} 스토어 env 미설정.`);
        continue;
      }
      const plan = await planWebhook(apiKey, currency, storeId);
      if (plan.action === 'ok') {
        console.log(`  ✅ ${currency}: webhook 존재 + 이벤트 최신 (변경 없음).`);
        continue;
      }
      if (plan.action === 'create') {
        console.log(`  ${flags.commit ? '▶' : '○'} ${currency}: webhook 없음 → 생성 예정 (${DESIRED_WEBHOOK_EVENTS.length} events).`);
      } else {
        console.log(
          `  ${flags.commit ? '▶' : '○'} ${currency}: 이벤트 누락 → patch 예정 (+${plan.missingEvents.join(', ')}).`,
        );
      }
      if (flags.commit) {
        await commitWebhook(apiKey, plan);
      }
    }
    if (!flags.commit) {
      console.log('\n  ℹ️ 실제 생성/patch 하려면 --commit 을 붙이세요 (실제 LS API write).');
    }
  }

  if (!flags.commit) {
    console.log('\n(dry-run: LS 상품은 read-only 대조만, webhook 미변경. --commit 으로 webhook upsert.)\n');
  } else {
    console.log('\n완료.\n');
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

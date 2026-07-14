import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '@/env';
import type {
  CreditBundleId,
  SubscriptionInterval,
  SubscriptionTierId,
} from '@/lib/features';

// ── Lemon Squeezy ──────────────────────────────────────────────────────────
//
// We talk to the API with plain fetch — the surface we need (create
// checkout + verify webhook signature) is small and adding the official
// SDK would only bring marshalling sugar at the cost of one more dep.

const LS_API_BASE = 'https://api.lemonsqueezy.com/v1';

// Currency = payout rail. KRW lands in the 메테오 국내 KRW 계좌, USD lands
// in the 외환 계좌. Drives store/variant/webhook selection end-to-end.
export type PaymentCurrency = 'KRW' | 'USD';

// Each bundle maps to a pre-created Lemon Squeezy product variant.
// Standard pricing model auto-creates one variant per product, so the
// variant ID is what we attach to the checkout (not the product ID).
//
// 2026-07-13 리프라이스: 신 수량 팩 5종(mini/starter/plus/pro/max) ↔ 신 env 키
// 규약 `LEMONSQUEEZY_VARIANT_PACK_{MINI,STARTER,PLUS,PRO,MAX}_{KRW,USD}`. 441
// LS 상품생성 스크립트가 이 키명으로 variant id 를 출력한다. 구 팩(starter/
// team/studio/enterprise) 단일-스토어 legacy 폴백은 팩 id 재편으로 폐지됐다.
const LS_VARIANT_BY_BUNDLE_KRW: Record<CreditBundleId, string | undefined> = {
  mini: env.LEMONSQUEEZY_VARIANT_PACK_MINI_KRW,
  starter: env.LEMONSQUEEZY_VARIANT_PACK_STARTER_KRW,
  plus: env.LEMONSQUEEZY_VARIANT_PACK_PLUS_KRW,
  pro: env.LEMONSQUEEZY_VARIANT_PACK_PRO_KRW,
  max: env.LEMONSQUEEZY_VARIANT_PACK_MAX_KRW,
};

const LS_VARIANT_BY_BUNDLE_USD: Record<CreditBundleId, string | undefined> = {
  mini: env.LEMONSQUEEZY_VARIANT_PACK_MINI_USD,
  starter: env.LEMONSQUEEZY_VARIANT_PACK_STARTER_USD,
  plus: env.LEMONSQUEEZY_VARIANT_PACK_PLUS_USD,
  pro: env.LEMONSQUEEZY_VARIANT_PACK_PRO_USD,
  max: env.LEMONSQUEEZY_VARIANT_PACK_MAX_USD,
};

// Resolve store + variant for a (bundle, currency) pair. Falls back to the
// legacy single-store env when the dedicated split is not configured for
// that currency — lets us roll dashboard splits out per currency.
export function resolveLemonSqueezyTarget(
  bundleId: CreditBundleId,
  currency: PaymentCurrency,
): { storeId: string; variantId: string } | null {
  if (currency === 'KRW') {
    const storeId = env.LEMONSQUEEZY_STORE_ID_KRW ?? env.LEMONSQUEEZY_STORE_ID;
    const variantId = LS_VARIANT_BY_BUNDLE_KRW[bundleId];
    if (!storeId || !variantId) return null;
    return { storeId, variantId };
  }
  // USD has no legacy fallback — without the USD store/variant configured
  // we refuse to charge in USD so the user can never land on a checkout
  // that pays out to the wrong account.
  const storeId = env.LEMONSQUEEZY_STORE_ID_USD;
  const variantId = LS_VARIANT_BY_BUNDLE_USD[bundleId];
  if (!storeId || !variantId) return null;
  return { storeId, variantId };
}

// Which currencies the checkout API is willing to offer right now. UI
// uses this to hide the toggle when only one rail is provisioned.
export function availableLemonSqueezyCurrencies(): PaymentCurrency[] {
  const out: PaymentCurrency[] = [];
  if (env.LEMONSQUEEZY_STORE_ID_KRW || env.LEMONSQUEEZY_STORE_ID) out.push('KRW');
  if (env.LEMONSQUEEZY_STORE_ID_USD) out.push('USD');
  return out;
}

// ── Subscriptions ───────────────────────────────────────────────────────────
//
// Recurring monthly tiers. Each (tier, currency) maps to a pre-created LS
// subscription variant via env keys `LEMONSQUEEZY_SUB_{SOLO,PLUS,PRO}_{KRW,USD}`
// (441 상품생성 스크립트가 이 키명으로 variant id 를 출력). 포함 크레딧 단가도
// ₩500/cr — 할인이 아니라 편의(무만료·우선처리·시트)가 구독의 가치다.

const LS_SUB_VARIANT_KRW: Record<SubscriptionTierId, string | undefined> = {
  solo: env.LEMONSQUEEZY_SUB_SOLO_KRW,
  plus: env.LEMONSQUEEZY_SUB_PLUS_KRW,
  pro: env.LEMONSQUEEZY_SUB_PRO_KRW,
};

const LS_SUB_VARIANT_USD: Record<SubscriptionTierId, string | undefined> = {
  solo: env.LEMONSQUEEZY_SUB_SOLO_USD,
  plus: env.LEMONSQUEEZY_SUB_PLUS_USD,
  pro: env.LEMONSQUEEZY_SUB_PRO_USD,
};

// Annual variants — USD only (연간은 계좌이체/KRW 미제공, spec §제약). Maps to a
// separate LS variant with a yearly billing interval + 1-month-free pricing.
const LS_SUB_VARIANT_ANNUAL_USD: Record<SubscriptionTierId, string | undefined> = {
  solo: env.LEMONSQUEEZY_SUB_SOLO_ANNUAL_USD,
  plus: env.LEMONSQUEEZY_SUB_PLUS_ANNUAL_USD,
  pro: env.LEMONSQUEEZY_SUB_PRO_ANNUAL_USD,
};

// Resolve store + variant for a (tier, currency, interval) triple. Mirrors the
// credit pack resolver — KRW falls back to the legacy single store, USD refuses
// without a dedicated USD store so we never pay out to the wrong account.
// interval='year' selects the annual variant; annual is USD-only, so a yearly
// KRW request has no target (returns null) rather than silently falling back.
export function resolveLemonSqueezySubscriptionTarget(
  tierId: SubscriptionTierId,
  currency: PaymentCurrency,
  interval: SubscriptionInterval = 'month',
): { storeId: string; variantId: string } | null {
  if (currency === 'KRW') {
    // 연간 KRW 상품은 없다 — 월간만 KRW 폴백을 허용한다.
    if (interval === 'year') return null;
    const storeId = env.LEMONSQUEEZY_STORE_ID_KRW ?? env.LEMONSQUEEZY_STORE_ID;
    const variantId = LS_SUB_VARIANT_KRW[tierId];
    if (!storeId || !variantId) return null;
    return { storeId, variantId };
  }
  const storeId = env.LEMONSQUEEZY_STORE_ID_USD;
  const variantId =
    interval === 'year'
      ? LS_SUB_VARIANT_ANNUAL_USD[tierId]
      : LS_SUB_VARIANT_USD[tierId];
  if (!storeId || !variantId) return null;
  return { storeId, variantId };
}

// Reverse map a LS subscription variant_id (from a webhook payload) back to
// our tier id, across both currency rails + monthly/annual variants. Used as a
// fallback when the checkout custom_data tier is absent on a lifecycle event.
export function subscriptionTierForVariant(
  variantId: string | number | null | undefined,
): SubscriptionTierId | null {
  if (variantId == null) return null;
  const id = String(variantId);
  const tiers: SubscriptionTierId[] = ['solo', 'plus', 'pro'];
  for (const t of tiers) {
    if (
      LS_SUB_VARIANT_KRW[t] === id ||
      LS_SUB_VARIANT_USD[t] === id ||
      LS_SUB_VARIANT_ANNUAL_USD[t] === id
    ) {
      return t;
    }
  }
  return null;
}

// Reverse map a LS subscription variant_id back to its billing interval. An
// annual variant → 'year', a monthly variant → 'month', unknown → null (caller
// falls back to custom_data / persisted org state / a conservative 'month').
export function subscriptionIntervalForVariant(
  variantId: string | number | null | undefined,
): SubscriptionInterval | null {
  if (variantId == null) return null;
  const id = String(variantId);
  const tiers: SubscriptionTierId[] = ['solo', 'plus', 'pro'];
  for (const t of tiers) {
    if (LS_SUB_VARIANT_ANNUAL_USD[t] === id) return 'year';
    if (LS_SUB_VARIANT_KRW[t] === id || LS_SUB_VARIANT_USD[t] === id) {
      return 'month';
    }
  }
  return null;
}

// Shape of the LS subscription resource we care about — returned by the
// GET /subscriptions/:id endpoint and echoed inside subscription webhook
// payloads (`data.attributes`).
export type LemonSqueezySubscriptionAttrs = {
  status: string | null;         // active | cancelled | expired | past_due | ...
  renews_at: string | null;      // ISO — end of the current billing period
  ends_at: string | null;        // ISO — set once cancelled/expired
  variant_id: string | number | null;
  store_id: string | number | null;
};

// Fetch a subscription's current attributes from the LS API. Used by the
// payment_success handler to read the authoritative `renews_at` (the
// subscription-invoice payload doesn't carry it), so the period key stays
// consistent with what the subscription_created/updated events compute.
export async function fetchLemonSqueezySubscription(
  apiKey: string,
  subscriptionId: string,
): Promise<LemonSqueezySubscriptionAttrs | null> {
  const res = await fetch(`${LS_API_BASE}/subscriptions/${subscriptionId}`, {
    headers: {
      Accept: 'application/vnd.api+json',
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as
    | { data?: { attributes?: Partial<LemonSqueezySubscriptionAttrs> } }
    | null;
  const a = json?.data?.attributes;
  if (!a) return null;
  return {
    status: a.status ?? null,
    renews_at: a.renews_at ?? null,
    ends_at: a.ends_at ?? null,
    variant_id: a.variant_id ?? null,
    store_id: a.store_id ?? null,
  };
}

// Fetch the Lemon Squeezy customer-portal signed URL for a subscription.
// This is the self-service page where the customer can update payment
// method, change plan, or cancel — we delegate 관리/취소 to it instead of
// building our own cancel UI (최소 스코프; 자체 취소 API 는 후속 PR). Any
// failure (missing key, network, revoked sub) resolves to null so the
// caller can degrade gracefully to a support-contact fallback.
export async function fetchLemonSqueezyCustomerPortalUrl(
  apiKey: string,
  subscriptionId: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${LS_API_BASE}/subscriptions/${subscriptionId}`, {
      headers: {
        Accept: 'application/vnd.api+json',
        Authorization: `Bearer ${apiKey}`,
      },
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as
      | { data?: { attributes?: { urls?: { customer_portal?: string | null } } } }
      | null;
    return json?.data?.attributes?.urls?.customer_portal ?? null;
  } catch {
    return null;
  }
}

// Billing-period key for idempotent grants: the date portion of `renews_at`
// ('YYYY-MM-DD'). Monthly renewal → each period ends on a distinct date, and
// truncating to the day absorbs sub-second format drift between the webhook
// payload and the API response.
export function subscriptionPeriodKey(renewsAt: string | null | undefined): string | null {
  if (!renewsAt) return null;
  const d = renewsAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

// Map a Lemon Squeezy store_id from a webhook payload back to the
// currency rail that store belongs to. Returns null for unknown stores.
export function currencyForStoreId(storeId: string | null | undefined): PaymentCurrency | null {
  if (!storeId) return null;
  const id = String(storeId);
  if (id === env.LEMONSQUEEZY_STORE_ID_USD) return 'USD';
  if (id === env.LEMONSQUEEZY_STORE_ID_KRW) return 'KRW';
  // Legacy single store was always payed out in KRW.
  if (id === env.LEMONSQUEEZY_STORE_ID) return 'KRW';
  return null;
}

// Choose default currency for a checkout request when the user hasn't
// picked one. Locale ko → KRW; Vercel geo header KR → KRW; otherwise USD.
// The explicit override (request body or `?currency=` query) bypasses
// detection so the manual toggle always wins.
export function determineCurrency(
  headers: Headers,
  locale: string,
  explicit?: string | null,
): PaymentCurrency {
  if (explicit === 'KRW' || explicit === 'USD') return explicit;
  if (locale === 'ko') return 'KRW';
  const country = headers.get('x-vercel-ip-country');
  if (country === 'KR') return 'KRW';
  return 'USD';
}

// Locale supported by Lemon Squeezy's checkout UI. We only ship ko/en so
// the union is narrow; LS supports many more if we add languages later.
export type LemonSqueezyLocale = 'ko' | 'en';

export type LemonSqueezyCheckoutParams = {
  storeId: string;
  variantId: string;
  email: string | null;
  locale: LemonSqueezyLocale;
  // Custom data threaded back to us via the webhook payload's
  // `meta.custom_data`. One-time orders use payment_id to correlate the
  // `payments` row; subscriptions thread org_id + tier so the webhook can
  // grant included credits without a pre-inserted row.
  custom: Record<string, string>;
  redirectUrl: string;
};

export type LemonSqueezyCheckoutResult = {
  id: string;       // checkout session ID (LS returns it as data.id)
  url: string;      // hosted checkout URL the user is sent to
};

/**
 * Create a hosted Lemon Squeezy checkout session for `variantId`. Throws
 * with the LS error body on non-2xx so the caller can mark the payment
 * row as failed and surface a clean 5xx to the client.
 */
export async function createLemonSqueezyCheckout(
  apiKey: string,
  params: LemonSqueezyCheckoutParams,
): Promise<LemonSqueezyCheckoutResult> {
  const body = {
    data: {
      type: 'checkouts',
      attributes: {
        checkout_options: {
          embed: false,
          media: false,
          logo: true,
          locale: params.locale,
        },
        checkout_data: {
          email: params.email ?? undefined,
          custom: params.custom,
        },
        product_options: {
          redirect_url: params.redirectUrl,
        },
      },
      relationships: {
        store:   { data: { type: 'stores',   id: params.storeId   } },
        variant: { data: { type: 'variants', id: params.variantId } },
      },
    },
  };

  const res = await fetch(`${LS_API_BASE}/checkouts`, {
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
    throw new Error(`lemonsqueezy_checkout_failed status=${res.status} body=${text.slice(0, 400)}`);
  }

  const json = (await res.json()) as {
    data: { id: string; attributes: { url: string } };
  };
  return { id: json.data.id, url: json.data.attributes.url };
}

/**
 * Verify a Lemon Squeezy webhook by recomputing HMAC-SHA256 over the raw
 * request body and constant-time comparing against the X-Signature
 * header. Returns false on any mismatch (length, hex parse, signature).
 */
export function verifyLemonSqueezySignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const computed = createHmac('sha256', secret).update(rawBody).digest('hex');
  const sigBuf = Buffer.from(signatureHeader, 'utf8');
  const computedBuf = Buffer.from(computed, 'utf8');
  if (sigBuf.length !== computedBuf.length) return false;
  return timingSafeEqual(sigBuf, computedBuf);
}

// Try every configured webhook secret in turn. Dual-store deployments end
// up with one Lemon Squeezy webhook per store, each with its own signing
// secret — but they all POST to /api/billing/webhook. Returns the matching
// currency rail when a secret verifies, or null when none do.
export function verifyLemonSqueezySignatureAny(
  rawBody: string,
  signatureHeader: string | null,
): { ok: true; currency: PaymentCurrency | null } | { ok: false } {
  if (!signatureHeader) return { ok: false };
  const candidates: { secret: string; currency: PaymentCurrency | null }[] = [];
  if (env.LEMONSQUEEZY_WEBHOOK_SECRET_KRW) {
    candidates.push({ secret: env.LEMONSQUEEZY_WEBHOOK_SECRET_KRW, currency: 'KRW' });
  }
  if (env.LEMONSQUEEZY_WEBHOOK_SECRET_USD) {
    candidates.push({ secret: env.LEMONSQUEEZY_WEBHOOK_SECRET_USD, currency: 'USD' });
  }
  if (env.LEMONSQUEEZY_WEBHOOK_SECRET) {
    // Legacy single-store secret — treat as currency-agnostic; the caller
    // falls back to the payload's store_id when the signature matches.
    candidates.push({ secret: env.LEMONSQUEEZY_WEBHOOK_SECRET, currency: null });
  }
  for (const c of candidates) {
    if (verifyLemonSqueezySignature(rawBody, signatureHeader, c.secret)) {
      return { ok: true, currency: c.currency };
    }
  }
  return { ok: false };
}

// ── Bank transfer ──────────────────────────────────────────────────────────

// Bank-transfer reference shown to the user as 입금자명. Short, unambiguous
// (no easily-confused characters), and uniqueness is enforced by the DB
// unique index — caller retries on collision.
export function generateBankReference(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  let s = 'MR-';
  for (let i = 0; i < 6; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}

// Public read-only billing-account info used to render the bank-transfer
// instructions. Pulled from env so we never put account numbers in source.
export function getBankAccount(): {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
} | null {
  const bankName = env.BILLING_BANK_NAME;
  const accountNumber = env.BILLING_ACCOUNT_NUMBER;
  const accountHolder = env.BILLING_ACCOUNT_HOLDER;
  if (!bankName || !accountNumber || !accountHolder) return null;
  return { bankName, accountNumber, accountHolder };
}

// Tax invoice (세금계산서) payload validated at the API boundary. Keeping
// the field list here as the SSOT lets the UI form, the zod schema, and the
// admin export reference one shape.
export type TaxInvoiceRequest = {
  bizNo: string;        // 사업자등록번호 (formatted or digits-only — we normalize)
  company: string;      // 상호
  ceo: string;          // 대표자명
  managerName: string;  // 담당자명
  managerEmail: string; // 담당자 이메일
  bizCertPath?: string;
};

export function normalizeBizNo(s: string): string {
  return s.replace(/\D/g, '').slice(0, 10);
}

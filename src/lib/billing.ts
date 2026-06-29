import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '@/env';
import type { CreditBundleId } from '@/lib/features';

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
const LS_VARIANT_BY_BUNDLE_LEGACY: Record<CreditBundleId, string | undefined> = {
  starter: env.LEMONSQUEEZY_VARIANT_STARTER,
  team: env.LEMONSQUEEZY_VARIANT_TEAM,
  studio: env.LEMONSQUEEZY_VARIANT_STUDIO,
  enterprise: env.LEMONSQUEEZY_VARIANT_ENTERPRISE,
};

const LS_VARIANT_BY_BUNDLE_KRW: Record<CreditBundleId, string | undefined> = {
  starter: env.LEMONSQUEEZY_VARIANT_STARTER_KRW,
  team: env.LEMONSQUEEZY_VARIANT_TEAM_KRW,
  studio: env.LEMONSQUEEZY_VARIANT_STUDIO_KRW,
  enterprise: env.LEMONSQUEEZY_VARIANT_ENTERPRISE_KRW,
};

const LS_VARIANT_BY_BUNDLE_USD: Record<CreditBundleId, string | undefined> = {
  starter: env.LEMONSQUEEZY_VARIANT_STARTER_USD,
  team: env.LEMONSQUEEZY_VARIANT_TEAM_USD,
  studio: env.LEMONSQUEEZY_VARIANT_STUDIO_USD,
  enterprise: env.LEMONSQUEEZY_VARIANT_ENTERPRISE_USD,
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
    const variantId = LS_VARIANT_BY_BUNDLE_KRW[bundleId] ?? LS_VARIANT_BY_BUNDLE_LEGACY[bundleId];
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
  // `meta.custom_data`. We use payment_id to correlate the order with the
  // `payments` row we inserted before redirecting.
  custom: { payment_id: string; org_id: string };
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

import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '@/env';
import type { CreditBundleId } from '@/lib/features';

// ── Lemon Squeezy ──────────────────────────────────────────────────────────
//
// We talk to the API with plain fetch — the surface we need (create
// checkout + verify webhook signature) is small and adding the official
// SDK would only bring marshalling sugar at the cost of one more dep.

const LS_API_BASE = 'https://api.lemonsqueezy.com/v1';

// Each bundle maps to a pre-created Lemon Squeezy product variant.
// Standard pricing model auto-creates one variant per product, so the
// variant ID is what we attach to the checkout (not the product ID).
const LS_VARIANT_BY_BUNDLE: Record<CreditBundleId, string | undefined> = {
  starter: env.LEMONSQUEEZY_VARIANT_STARTER,
  team: env.LEMONSQUEEZY_VARIANT_TEAM,
  studio: env.LEMONSQUEEZY_VARIANT_STUDIO,
  enterprise: env.LEMONSQUEEZY_VARIANT_ENTERPRISE,
};

export function getLemonSqueezyVariantId(bundleId: CreditBundleId): string | null {
  return LS_VARIANT_BY_BUNDLE[bundleId] ?? null;
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

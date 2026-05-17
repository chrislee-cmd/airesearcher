import { Creem } from 'creem';
import type { CreditBundleId } from '@/lib/features';

// Lazily resolved Creem client. Returns null when the API key is missing so
// the checkout route surfaces a clean 503 instead of crashing at import time.
let _creem: Creem | null = null;
export function getCreem(): Creem | null {
  if (_creem) return _creem;
  const key = process.env.CREEM_API_KEY;
  if (!key) return null;
  _creem = new Creem({ serverURL: 'https://api.creem.io', apiKey: key });
  return _creem;
}

// Each bundle maps to a pre-created Creem product. Set the env vars to the
// product IDs from the Creem dashboard (Products → copy ID).
const CREEM_PRODUCT_ENV: Record<CreditBundleId, string> = {
  starter:    'CREEM_PRODUCT_STARTER',
  team:       'CREEM_PRODUCT_TEAM',
  studio:     'CREEM_PRODUCT_STUDIO',
  enterprise: 'CREEM_PRODUCT_ENTERPRISE',
};

export function getCreemProductId(bundleId: CreditBundleId): string | null {
  const envKey = CREEM_PRODUCT_ENV[bundleId];
  return process.env[envKey] ?? null;
}

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
  const bankName = process.env.BILLING_BANK_NAME;
  const accountNumber = process.env.BILLING_ACCOUNT_NUMBER;
  const accountHolder = process.env.BILLING_ACCOUNT_HOLDER;
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

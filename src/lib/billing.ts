import Stripe from 'stripe';

// Lazily resolved Stripe client. We don't instantiate at module load because
// preview / dev environments may not have keys configured yet — the
// /api/billing/checkout route surfaces a clean 503 in that case.
let _stripe: Stripe | null = null;
export function getStripe(): Stripe | null {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  _stripe = new Stripe(key);
  return _stripe;
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
  // Business registration certificate (사업자등록증) is collected as a
  // Supabase Storage path that the admin can fetch later. Optional because
  // admins can request it after the fact.
  bizCertPath?: string;
};

export function normalizeBizNo(s: string): string {
  return s.replace(/\D/g, '').slice(0, 10);
}

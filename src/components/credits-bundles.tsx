'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  CREDIT_BUNDLES,
  type CreditBundleId,
} from '@/lib/features';
import { track } from '@/components/mixpanel-provider';

function formatKrw(n: number): string {
  return new Intl.NumberFormat('ko-KR').format(n) + '원';
}

const BUNDLE_LABEL_KEY: Record<CreditBundleId, string> = {
  starter: 'bundleStarter',
  team: 'bundleTeam',
  studio: 'bundleStudio',
  enterprise: 'bundleEnterprise',
};

type Method = 'creem' | 'bank_transfer';

type TaxInvoiceState = {
  enabled: boolean;
  bizNo: string;
  company: string;
  ceo: string;
  managerName: string;
  managerEmail: string;
};

const EMPTY_TAX: TaxInvoiceState = {
  enabled: false,
  bizNo: '',
  company: '',
  ceo: '',
  managerName: '',
  managerEmail: '',
};

type BankDetails = {
  paymentId: string;
  bankReference: string;
  bankName: string | null;
  accountNumber: string | null;
  accountHolder: string | null;
  credits: number;
  amountKrw: number;
};

export function CreditsBundles() {
  const t = useTranslations('Credits');
  const [selectedBundle, setSelectedBundle] = useState<CreditBundleId | null>(null);
  const [method, setMethod] = useState<Method>('creem');
  const [tax, setTax] = useState<TaxInvoiceState>(EMPTY_TAX);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [bankDetails, setBankDetails] = useState<BankDetails | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const selected = CREDIT_BUNDLES.find((b) => b.id === selectedBundle) ?? null;

  function open(id: CreditBundleId) {
    setSelectedBundle(id);
    setError(null);
  }
  function close() {
    setSelectedBundle(null);
    setBankDetails(null);
    setTax(EMPTY_TAX);
    setMethod('creem');
    setError(null);
  }

  async function submit() {
    if (!selected || selected.priceKrw == null) return;
    track(
      method === 'creem' ? 'credits_pay_card_click' : 'credits_bank_transfer_click',
      {
        bundle: selected.id,
        credits: selected.credits,
        price_krw: selected.priceKrw,
        tax_invoice: tax.enabled,
      },
    );

    const taxPayload = tax.enabled
      ? {
          bizNo: tax.bizNo,
          company: tax.company,
          ceo: tax.ceo,
          managerName: tax.managerName,
          managerEmail: tax.managerEmail,
        }
      : undefined;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bundleId: selected.id, method, taxInvoice: taxPayload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      if (method === 'creem' && json.checkoutUrl) {
        window.location.href = json.checkoutUrl;
        return;
      }
      if (method === 'bank_transfer') {
        setBankDetails({
          paymentId: json.paymentId,
          bankReference: json.bankReference,
          bankName: json.bankName ?? null,
          accountNumber: json.accountNumber ?? null,
          accountHolder: json.accountHolder ?? null,
          credits: selected.credits,
          amountKrw: selected.priceKrw!,
        });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const taxValid =
    !tax.enabled ||
    (tax.bizNo.replace(/\D/g, '').length === 10 &&
      tax.company.trim() &&
      tax.ceo.trim() &&
      tax.managerName.trim() &&
      /\S+@\S+\.\S+/.test(tax.managerEmail));

  return (
    <>
      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CREDIT_BUNDLES.map((b) => {
          const labelKey = BUNDLE_LABEL_KEY[b.id];
          const isContact = b.priceKrw === null;
          return (
            <div
              key={b.id}
              className={`relative flex flex-col border bg-paper p-5 [border-radius:14px] ${
                b.popular ? 'border-amore' : 'border-line'
              }`}
            >
              {b.popular && (
                <span className="absolute -top-2 left-4 bg-amore px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.22em] text-paper [border-radius:2px]">
                  {t('popular')}
                </span>
              )}
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
                {t(labelKey)}
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-[28px] font-bold tracking-[-0.02em] text-ink tabular-nums">
                  {b.credits.toLocaleString()}
                </span>
                <span className="text-[11px] text-mute-soft">{t('creditsUnit')}</span>
              </div>
              <div className="mt-4 text-[15px] font-semibold text-ink-2 tabular-nums">
                {isContact ? '—' : formatKrw(b.priceKrw!)}
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10.5px] text-mute-soft tabular-nums">
                {b.perCreditKrw !== null && (
                  <span>
                    {formatKrw(b.perCreditKrw)} {t('perCredit')}
                  </span>
                )}
                {b.discountPct > 0 && (
                  <span className="border border-amore px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-amore [border-radius:2px]">
                    {t('discountOff', { percent: b.discountPct })}
                  </span>
                )}
              </div>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => {
                  if (isContact) {
                    track('credits_contact_sales_click', { bundle: b.id });
                    window.location.href = `mailto:${t('contactEmail')}?subject=Enterprise%20plan`;
                  } else {
                    track('credits_bundle_purchase_click', {
                      bundle: b.id,
                      credits: b.credits,
                      price_krw: b.priceKrw,
                    });
                    open(b.id);
                  }
                }}
                className={`mt-5 px-4 py-2 text-[11.5px] font-semibold uppercase tracking-[0.18em] transition-colors duration-[120ms] [border-radius:14px] ${
                  b.popular
                    ? 'border border-ink bg-ink text-paper hover:bg-ink-2'
                    : 'border border-line text-mute hover:border-ink hover:text-ink-2'
                }`}
              >
                {isContact ? t('contactSales') : t('purchase')}
              </button>
            </div>
          );
        })}
      </div>

      {toast && (
        <div
          className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2"
          role="status"
          aria-live="polite"
        >
          <div className="border border-ink bg-ink px-4 py-2 text-[12px] font-semibold text-paper [border-radius:14px]">
            {toast}
          </div>
        </div>
      )}

      {/* Checkout modal */}
      {selected && selected.priceKrw != null && !bankDetails && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
          onClick={close}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[560px] border border-line bg-paper [border-radius:14px]"
          >
            <header className="flex items-center justify-between border-b border-line px-5 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amore">
                {t('checkoutEyebrow')}
              </div>
              <button
                type="button"
                onClick={close}
                className="text-[18px] leading-none text-mute-soft hover:text-ink-2"
              >
                ×
              </button>
            </header>
            <div className="max-h-[calc(100vh-120px)] overflow-y-auto px-5 py-5">
                  <h3 className="text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
                    {t(BUNDLE_LABEL_KEY[selected.id])} ·{' '}
                    {selected.credits.toLocaleString()} {t('creditsUnit')}
                  </h3>
                  <p className="mt-1 text-[12.5px] text-mute tabular-nums">
                    {formatKrw(selected.priceKrw!)}
                  </p>

                  {/* Method selection */}
                  <div className="mt-5">
                    <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
                      {t('methodLabel')}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <MethodOption
                        active={method === 'creem'}
                        onClick={() => setMethod('creem')}
                        label={t('methodCard')}
                        hint={t('methodCardHint')}
                      />
                      <MethodOption
                        active={method === 'bank_transfer'}
                        onClick={() => setMethod('bank_transfer')}
                        label={t('methodBank')}
                        hint={t('methodBankHint')}
                      />
                    </div>
                  </div>

                  {/* Tax invoice */}
                  <div className="mt-5">
                    <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
                      <input
                        type="checkbox"
                        checked={tax.enabled}
                        onChange={(e) => setTax((s) => ({ ...s, enabled: e.target.checked }))}
                        className="accent-amore"
                      />
                      {t('taxInvoiceLabel')}
                    </label>
                    {tax.enabled && (
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <Field
                          label={t('taxBizNo')}
                          value={tax.bizNo}
                          onChange={(v) => setTax((s) => ({ ...s, bizNo: v }))}
                          placeholder="123-45-67890"
                        />
                        <Field
                          label={t('taxCompany')}
                          value={tax.company}
                          onChange={(v) => setTax((s) => ({ ...s, company: v }))}
                        />
                        <Field
                          label={t('taxCeo')}
                          value={tax.ceo}
                          onChange={(v) => setTax((s) => ({ ...s, ceo: v }))}
                        />
                        <Field
                          label={t('taxManagerName')}
                          value={tax.managerName}
                          onChange={(v) => setTax((s) => ({ ...s, managerName: v }))}
                        />
                        <Field
                          label={t('taxManagerEmail')}
                          value={tax.managerEmail}
                          onChange={(v) => setTax((s) => ({ ...s, managerEmail: v }))}
                          full
                          type="email"
                        />
                      </div>
                    )}
                  </div>

                  {error && (
                    <p className="mt-4 text-[11.5px] text-warning">{error}</p>
                  )}

                  <div className="mt-6 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={close}
                      className="border border-line bg-paper px-4 py-1.5 text-[12px] text-ink-2 hover:text-amore [border-radius:14px]"
                    >
                      {t('cancel')}
                    </button>
                    <button
                      type="button"
                      disabled={submitting || !taxValid}
                      onClick={submit}
                      className="border border-ink bg-ink px-4 py-1.5 text-[12px] font-semibold text-paper hover:bg-ink-2 disabled:opacity-40 [border-radius:14px]"
                    >
                      {submitting
                        ? t('submitting')
                        : method === 'creem'
                        ? t('payWithCard')
                        : t('issueBankReference')}
                    </button>
                  </div>
            </div>
          </div>
        </div>
      )}

      {/* Bank transfer instruction panel */}
      {bankDetails && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
          onClick={close}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[480px] border border-line bg-paper [border-radius:14px]"
          >
            <header className="flex items-center justify-between border-b border-line px-5 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amore">
                {t('checkoutEyebrow')}
              </div>
              <button
                type="button"
                onClick={close}
                className="text-[18px] leading-none text-mute-soft hover:text-ink-2"
              >
                ×
              </button>
            </header>
            <div className="px-5 py-5">
              <h3 className="text-[14px] font-semibold text-ink-2">{t('bankTitle')}</h3>
              <p className="mt-1.5 text-[12px] leading-[1.7] text-mute">{t('bankBody')}</p>

              <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3">
                {bankDetails.bankName && (
                  <>
                    <dt className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-mute-soft">{t('bankBankName')}</dt>
                    <dd className="text-[13px] font-medium text-ink-2">{bankDetails.bankName}</dd>
                  </>
                )}
                {bankDetails.accountNumber && (
                  <>
                    <dt className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-mute-soft">{t('bankAccountNumber')}</dt>
                    <dd className="text-[13px] font-medium text-ink-2 tabular-nums">{bankDetails.accountNumber}</dd>
                  </>
                )}
                {bankDetails.accountHolder && (
                  <>
                    <dt className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-mute-soft">{t('bankAccountHolder')}</dt>
                    <dd className="text-[13px] font-medium text-ink-2">{bankDetails.accountHolder}</dd>
                  </>
                )}
                <dt className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-mute-soft">{t('bankAmount')}</dt>
                <dd className="text-[13px] font-medium text-ink-2 tabular-nums">{formatKrw(bankDetails.amountKrw)}</dd>
                <dt className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-mute-soft">{t('bankReference')}</dt>
                <dd className="font-mono text-[15px] font-bold tracking-[0.08em] text-amore">{bankDetails.bankReference}</dd>
              </dl>

              <p className="mt-4 text-[11px] leading-[1.6] text-mute-soft">{t('bankFootnote')}</p>

              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={close}
                  className="border border-ink bg-ink px-5 py-1.5 text-[12px] font-semibold text-paper hover:bg-ink-2 [border-radius:14px]"
                >
                  {t('done')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MethodOption({
  active,
  onClick,
  label,
  hint,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        'flex flex-col items-start gap-0.5 border px-3 py-2.5 text-left [border-radius:14px] ' +
        (disabled
          ? 'cursor-not-allowed border-line-soft bg-paper text-mute-soft'
          : active
          ? 'border-ink bg-paper text-ink-2'
          : 'border-line bg-paper text-mute hover:text-ink-2')
      }
    >
      <span className="text-[12.5px] font-semibold">{label}</span>
      <span className="text-[10.5px] text-mute-soft">{hint}</span>
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type,
  full,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  full?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-1 ${full ? 'col-span-2' : ''}`}>
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-mute-soft">
        {label}
      </span>
      <input
        type={type ?? 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="border border-line bg-paper px-2.5 py-1.5 text-[12.5px] text-ink-2 [border-radius:14px]"
      />
    </label>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  CREDIT_BUNDLES,
  type CreditBundleId,
} from '@/lib/features';

function formatKrw(n: number): string {
  return new Intl.NumberFormat('ko-KR').format(n) + '원';
}

const BUNDLE_LABEL_KEY: Record<CreditBundleId, string> = {
  starter: 'bundleStarter',
  team: 'bundleTeam',
  studio: 'bundleStudio',
  enterprise: 'bundleEnterprise',
};

type Method = 'stripe' | 'bank_transfer';

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

export function CreditsBundles() {
  const t = useTranslations('Credits');
  const [selectedBundle, setSelectedBundle] = useState<CreditBundleId | null>(null);
  const [method, setMethod] = useState<Method>('stripe');
  const [tax, setTax] = useState<TaxInvoiceState>(EMPTY_TAX);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bankResult, setBankResult] = useState<{
    bankReference: string;
    bankName?: string;
    accountNumber?: string;
    accountHolder?: string;
    amountKrw: number;
  } | null>(null);

  const selected = CREDIT_BUNDLES.find((b) => b.id === selectedBundle) ?? null;

  function open(id: CreditBundleId) {
    setSelectedBundle(id);
    setError(null);
    setBankResult(null);
  }
  function close() {
    setSelectedBundle(null);
    setBankResult(null);
    setTax(EMPTY_TAX);
    setMethod('stripe');
    setError(null);
  }

  async function submit() {
    if (!selected || selected.priceKrw == null) return;
    setSubmitting(true);
    setError(null);
    try {
      const taxPayload = tax.enabled
        ? {
            bizNo: tax.bizNo,
            company: tax.company,
            ceo: tax.ceo,
            managerName: tax.managerName,
            managerEmail: tax.managerEmail,
          }
        : undefined;
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
      if (json.method === 'stripe' && json.checkoutUrl) {
        window.location.href = json.checkoutUrl;
        return;
      }
      if (json.method === 'bank_transfer') {
        setBankResult({
          bankReference: json.bankReference,
          bankName: json.bankName,
          accountNumber: json.accountNumber,
          accountHolder: json.accountHolder,
          amountKrw: selected.priceKrw,
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
              className={`relative flex flex-col border bg-paper p-5 [border-radius:4px] ${
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
                onClick={() =>
                  isContact
                    ? (window.location.href = `mailto:${t('contactEmail')}?subject=Enterprise%20plan`)
                    : open(b.id)
                }
                className={`mt-5 px-4 py-2 text-[11.5px] font-semibold uppercase tracking-[0.18em] transition-colors duration-[120ms] [border-radius:4px] ${
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

      {selected && selected.priceKrw != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
          onClick={close}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[560px] border border-line bg-paper [border-radius:4px]"
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
              {bankResult ? (
                <BankTransferReceipt
                  bankResult={bankResult}
                  formatKrw={formatKrw}
                  onClose={close}
                />
              ) : (
                <>
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
                        active={method === 'stripe'}
                        onClick={() => setMethod('stripe')}
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
                      className="border border-line bg-paper px-4 py-1.5 text-[12px] text-ink-2 hover:text-amore [border-radius:4px]"
                    >
                      {t('cancel')}
                    </button>
                    <button
                      type="button"
                      disabled={submitting || !taxValid}
                      onClick={submit}
                      className="border border-ink bg-ink px-4 py-1.5 text-[12px] font-semibold text-paper hover:bg-ink-2 disabled:opacity-40 [border-radius:4px]"
                    >
                      {submitting
                        ? t('submitting')
                        : method === 'stripe'
                        ? t('payWithCard')
                        : t('issueBankReference')}
                    </button>
                  </div>
                </>
              )}
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
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex flex-col items-start gap-0.5 border px-3 py-2.5 text-left [border-radius:4px] ' +
        (active
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
        className="border border-line bg-paper px-2.5 py-1.5 text-[12.5px] text-ink-2 [border-radius:4px]"
      />
    </label>
  );
}

function BankTransferReceipt({
  bankResult,
  formatKrw,
  onClose,
}: {
  bankResult: {
    bankReference: string;
    bankName?: string;
    accountNumber?: string;
    accountHolder?: string;
    amountKrw: number;
  };
  formatKrw: (n: number) => string;
  onClose: () => void;
}) {
  const t = useTranslations('Credits');
  return (
    <div>
      <h3 className="text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
        {t('bankTitle')}
      </h3>
      <p className="mt-2 text-[12.5px] leading-[1.7] text-mute">{t('bankBody')}</p>
      <dl className="mt-4 space-y-2 border border-line bg-paper p-4 text-[12.5px] [border-radius:4px]">
        {bankResult.bankName && (
          <Row label={t('bankBankName')} value={bankResult.bankName} />
        )}
        {bankResult.accountNumber && (
          <Row label={t('bankAccountNumber')} value={bankResult.accountNumber} />
        )}
        {bankResult.accountHolder && (
          <Row label={t('bankAccountHolder')} value={bankResult.accountHolder} />
        )}
        <Row label={t('bankAmount')} value={formatKrw(bankResult.amountKrw)} />
        <Row
          label={t('bankReference')}
          value={bankResult.bankReference}
          accent
        />
      </dl>
      <p className="mt-3 text-[11px] text-mute-soft">{t('bankFootnote')}</p>
      <div className="mt-5 flex items-center justify-end">
        <button
          type="button"
          onClick={onClose}
          className="border border-ink bg-ink px-4 py-1.5 text-[12px] font-semibold text-paper hover:bg-ink-2 [border-radius:4px]"
        >
          {t('done')}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-mute-soft">{label}</dt>
      <dd className={`tabular-nums ${accent ? 'font-bold text-amore' : 'text-ink-2'}`}>
        {value}
      </dd>
    </div>
  );
}

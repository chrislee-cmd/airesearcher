'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  CREDIT_BUNDLES,
  type CreditBundleId,
} from '@/lib/features';
import { track } from '@/components/mixpanel-provider';
import { formatCurrency, type CurrencyCode } from '@/lib/currency';
import type { PaymentCurrency } from '@/lib/billing';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';

// Plain KRW formatter — used only for the bank-transfer "deposit this
// exact amount" detail row, since that's the literal sum the customer
// has to wire. All other prices on the page render through
// `formatCurrency` keyed off the user's locale so foreign-locale users
// see USD / JPY / THB display values.
function formatKrw(n: number): string {
  return new Intl.NumberFormat('ko-KR').format(n) + '원';
}

const BUNDLE_LABEL_KEY: Record<CreditBundleId, string> = {
  starter: 'bundleStarter',
  team: 'bundleTeam',
  studio: 'bundleStudio',
  enterprise: 'bundleEnterprise',
};

// PR-D17 pop 톤: Outfit display stack + Memphis CTA / 카드. /credits 라우트는
// (app)/layout 의 Outfit 변수 안에 있어 var(--font-outfit) 가 그대로 해석됨.
const outfitStack = 'var(--font-outfit), var(--font-sans)';

function memphisCta(tone: 'pink' | 'paper' | 'ink'): CSSProperties {
  // Bundle/modal CTA: 3px black border + 4px offset shadow + Outfit display.
  // 결제 흐름 회귀 0 — 시각 layer 만 덮어쓰고 Button primitive 의 hover/disabled
  // wiring 은 그대로.
  const bg =
    tone === 'pink' ? 'var(--canvas-accent)' : tone === 'ink' ? '#000' : '#fff';
  const fg = tone === 'paper' ? '#000' : '#fff';
  return {
    background: bg,
    color: fg,
    border: '3px solid var(--canvas-card-border)',
    borderRadius: '10px',
    boxShadow: '4px 4px 0 var(--canvas-card-border)',
    fontFamily: outfitStack,
    fontWeight: 800,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
  };
}

function memphisGhost(active: boolean): CSSProperties {
  // Method picker / inactive toggles: 2.5px border, no shadow, white card.
  return {
    background: '#fff',
    color: '#000',
    border: '2.5px solid var(--canvas-card-border)',
    borderRadius: '10px',
    boxShadow: active ? '3px 3px 0 var(--canvas-card-border)' : 'none',
    fontFamily: outfitStack,
    fontWeight: 700,
  };
}

type Method = 'lemonsqueezy' | 'bank_transfer';

// Payment currency = which Lemon Squeezy payout rail to settle on.
// KRW lands in 메테오 국내 KRW 계좌, USD lands in the 외환 계좌. The
// display formatter (`formatCurrency`) follows this same value so the
// user sees the price in the currency they're actually charged in.
const CURRENCY_TO_DISPLAY: Record<PaymentCurrency, CurrencyCode> = {
  KRW: 'KRW',
  USD: 'USD',
};

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

type CreditsBundlesProps = {
  // Lemon Squeezy currencies the server can actually route. When only
  // one is configured the toggle hides and we settle on that single rail.
  availableCurrencies?: PaymentCurrency[];
  // Default rail server-side picked from locale + Vercel geo header.
  initialCurrency?: PaymentCurrency;
};

export function CreditsBundles({
  availableCurrencies,
  initialCurrency,
}: CreditsBundlesProps = {}) {
  const t = useTranslations('Credits');
  const locale = useLocale();

  // Currency state — drives display formatting *and* the LS payout rail.
  // The previous implementation drove display purely from `locale`; now
  // the toggle is the source of truth so a Korean user shopping in USD
  // sees USD prices that match the LS checkout they're about to land on.
  const supported = useMemo<PaymentCurrency[]>(
    () =>
      availableCurrencies && availableCurrencies.length > 0
        ? availableCurrencies
        : ['KRW'],
    [availableCurrencies],
  );
  const initial: PaymentCurrency =
    initialCurrency && supported.includes(initialCurrency)
      ? initialCurrency
      : supported[0];
  const [currency, setCurrency] = useState<PaymentCurrency>(initial);
  const displayCurrency = CURRENCY_TO_DISPLAY[currency];
  const formatPrice = (krw: number) => formatCurrency(krw, displayCurrency);

  const [selectedBundle, setSelectedBundle] = useState<CreditBundleId | null>(null);
  const [method, setMethod] = useState<Method>('lemonsqueezy');
  const [tax, setTax] = useState<TaxInvoiceState>(EMPTY_TAX);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [bankDetails, setBankDetails] = useState<BankDetails | null>(null);

  // Bank transfer = 국내 KRW only. The currency toggle's onClick flips
  // the method back to card when the user picks USD so they never end
  // up submitting a bank_transfer the server would have to reject.

  function selectCurrency(c: PaymentCurrency) {
    if (c === currency) return;
    setCurrency(c);
    if (c === 'USD' && method === 'bank_transfer') setMethod('lemonsqueezy');
    track('credits_currency_toggle', { currency: c });
  }

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
    setMethod('lemonsqueezy');
    setError(null);
  }

  async function submit() {
    if (!selected || selected.priceKrw == null) return;
    track(
      method === 'lemonsqueezy' ? 'credits_pay_card_click' : 'credits_bank_transfer_click',
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
        body: JSON.stringify({
          bundleId: selected.id,
          method,
          locale: locale === 'ko' ? 'ko' : 'en',
          currency,
          taxInvoice: taxPayload,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          json.error === 'service_unavailable'
            ? t('errorServiceUnavailable')
            : json.error ?? `HTTP ${res.status}`,
        );
        return;
      }
      if (method === 'lemonsqueezy' && json.checkoutUrl) {
        window.location.assign(json.checkoutUrl);
        return;
      }
      if (method === 'bank_transfer') {
        // Primary path: server emailed bank details to admin + requester CC.
        // Show confirmation toast and close the modal.
        // Fallback (json.emailed === false): SMTP failed, server returned
        // bank info inline — keep the instruction panel so the user can
        // still complete the wire.
        if (json.emailed) {
          setToast(t('bankEmailSent'));
          close();
        } else {
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

  const showCurrencyToggle = supported.length > 1;

  return (
    <>
      {showCurrencyToggle && (
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <span
            style={{ fontFamily: outfitStack }}
            className="text-xs-soft font-semibold uppercase tracking-[0.22em] text-mute-soft"
          >
            {t('currencyLabel')}
          </span>
          <div className="inline-flex gap-2">
            {supported.map((c) => {
              const active = c === currency;
              return (
                <Button
                  key={c}
                  variant="ghost"
                  size="sm"
                  onClick={() => selectCurrency(c)}
                  style={{
                    ...memphisGhost(active),
                    background: active ? '#fff0f4' : '#fff',
                    color: '#000',
                  }}
                  className="px-3 py-1.5 text-xs font-extrabold uppercase tracking-[0.18em] rounded-sm"
                >
                  {t(c === 'KRW' ? 'currencyKrw' : 'currencyUsd')}
                </Button>
              );
            })}
          </div>
        </div>
      )}
      <div className="mt-10 grid grid-cols-1 gap-6 pt-3 sm:grid-cols-2 lg:grid-cols-4">
        {CREDIT_BUNDLES.map((b) => {
          const labelKey = BUNDLE_LABEL_KEY[b.id];
          const isContact = b.priceKrw === null;
          return (
            <div
              key={b.id}
              style={{
                background: b.popular ? '#fff0f4' : '#ffffff',
                border: `${b.popular ? '4px' : '3px'} solid var(--canvas-card-border)`,
                borderRadius: 'var(--canvas-card-radius)',
                boxShadow: 'var(--canvas-card-shadow)',
              }}
              className="relative flex flex-col p-5 rounded-sm"
            >
              {b.popular && (
                <span
                  style={{
                    background: 'var(--canvas-accent)',
                    border: '2.5px solid var(--canvas-card-border)',
                    boxShadow: 'var(--memphis-shadow-xs)',
                    transform: 'rotate(-3deg)',
                    fontFamily: outfitStack,
                  }}
                  className="absolute -top-3 left-4 rounded-full px-3 py-1 text-xs font-extrabold uppercase tracking-[0.18em] text-paper"
                >
                  {t('popular')}
                </span>
              )}
              <div
                style={{ fontFamily: outfitStack }}
                className="text-xs font-bold uppercase tracking-[0.22em] text-ink-2"
              >
                {t(labelKey)}
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span
                  style={{
                    fontFamily: outfitStack,
                    fontWeight: 800,
                    fontSize: '44px',
                    lineHeight: 1,
                    letterSpacing: '-0.035em',
                  }}
                  className="text-ink-2 tabular-nums"
                >
                  {b.credits.toLocaleString()}
                </span>
                <span className="text-sm font-semibold text-mute-soft">
                  {t('creditsUnit')}
                </span>
              </div>
              <div className="mt-4 text-xl font-bold text-ink-2 tabular-nums">
                {isContact ? '—' : formatPrice(b.priceKrw!)}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs-soft text-mute tabular-nums">
                {b.perCreditKrw !== null && (
                  <span>
                    {formatPrice(b.perCreditKrw)} {t('perCredit')}
                  </span>
                )}
                {b.discountPct > 0 && (
                  <span
                    style={{
                      background: 'var(--color-sun)',
                      border: '2px solid var(--canvas-card-border)',
                      boxShadow: '2px 2px 0 var(--canvas-card-border)',
                      fontFamily: outfitStack,
                    }}
                    className="rounded-xs px-1.5 py-0.5 text-xs font-bold uppercase tracking-[0.18em] text-ink-2"
                  >
                    {t('discountOff', { percent: b.discountPct })}
                  </span>
                )}
              </div>
              <div className="flex-1" />
              <Button
                variant="primary"
                size="md"
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
                style={memphisCta(b.popular ? 'pink' : 'paper')}
                className="mt-6 uppercase"
              >
                {isContact ? t('contactSales') : t('purchase')}
              </Button>
            </div>
          );
        })}
      </div>

      {toast && (
        <div
          className="pointer-events-none fixed bottom-6 left-1/2 z-toast -translate-x-1/2"
          role="status"
          aria-live="polite"
        >
          <div
            style={{
              background: '#000',
              border: '3px solid #000',
              boxShadow: '4px 4px 0 var(--canvas-accent)',
              fontFamily: outfitStack,
            }}
            className="px-4 py-2 text-md font-bold text-paper rounded-sm"
          >
            {toast}
          </div>
        </div>
      )}

      {/* Checkout modal — Memphis container */}
      {selected && selected.priceKrw != null && !bankDetails && (
        <div
          className="fixed inset-0 z-modal flex items-center justify-center bg-ink/40 px-4"
          onClick={close}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              border: '3px solid var(--canvas-card-border)',
              borderRadius: 'var(--canvas-card-radius)',
              boxShadow: 'var(--canvas-card-shadow)',
            }}
            className="w-full max-w-[560px] rounded-sm"
          >
            <header
              style={{
                background: 'var(--canvas-bg)',
                borderBottom: '2.5px solid var(--canvas-card-border)',
                borderTopLeftRadius: 'var(--canvas-card-radius)',
                borderTopRightRadius: 'var(--canvas-card-radius)',
              }}
              className="flex items-center justify-between px-5 py-3"
            >
              <div
                style={{ fontFamily: outfitStack }}
                className="text-xs font-extrabold uppercase tracking-[0.22em] text-ink-2"
              >
                {t('checkoutEyebrow')}
              </div>
              <IconButton
                onClick={close}
                aria-label="결제 창 닫기"
                className="text-2xl leading-none"
              >
                ×
              </IconButton>
            </header>
            <div className="max-h-[calc(100vh-120px)] overflow-y-auto px-5 py-5">
                  <h3
                    style={{ fontFamily: outfitStack, letterSpacing: '-0.02em' }}
                    className="text-2xl font-extrabold text-ink-2"
                  >
                    {t(BUNDLE_LABEL_KEY[selected.id])} ·{' '}
                    {selected.credits.toLocaleString()} {t('creditsUnit')}
                  </h3>
                  <p className="mt-1 text-md text-mute tabular-nums">
                    {formatPrice(selected.priceKrw!)}
                    {displayCurrency !== 'KRW' && (
                      <span className="ml-2 text-mute-soft">
                        ({t('billedInKrwNote', {
                          krw: formatKrw(selected.priceKrw!),
                        })})
                      </span>
                    )}
                  </p>

                  {/* Method selection — bank_transfer is 국내 KRW only, so the
                      toggle to USD hides it and locks the user into card. */}
                  <div className="mt-5">
                    <p className="text-xs-soft font-semibold uppercase tracking-[0.22em] text-mute-soft">
                      {t('methodLabel')}
                    </p>
                    <div
                      className={
                        currency === 'KRW'
                          ? 'mt-2 grid grid-cols-2 gap-2'
                          : 'mt-2 grid grid-cols-1 gap-2'
                      }
                    >
                      <MethodOption
                        active={method === 'lemonsqueezy'}
                        onClick={() => setMethod('lemonsqueezy')}
                        label={t('methodCard')}
                        hint={t('methodCardHint')}
                      />
                      {currency === 'KRW' && (
                        <MethodOption
                          active={method === 'bank_transfer'}
                          onClick={() => setMethod('bank_transfer')}
                          label={t('methodBank')}
                          hint={t('methodBankHint')}
                        />
                      )}
                    </div>
                  </div>

                  {/* Tax invoice */}
                  <div className="mt-5">
                    <label className="flex items-center gap-2 text-md text-ink-2">
                      <Checkbox
                        checked={tax.enabled}
                        onChange={(e) => setTax((s) => ({ ...s, enabled: e.target.checked }))}
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
                    <p className="mt-4 text-sm text-warning">{error}</p>
                  )}

                  <div className="mt-6 flex items-center justify-end gap-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={close}
                      className="text-md text-ink-2 hover:text-amore"
                    >
                      {t('cancel')}
                    </Button>
                    <Button
                      variant="primary"
                      size="md"
                      disabled={submitting || !taxValid}
                      onClick={submit}
                      style={memphisCta('pink')}
                    >
                      {submitting
                        ? t('submitting')
                        : method === 'lemonsqueezy'
                        ? t('payWithCard')
                        : t('issueBankReference')}
                    </Button>
                  </div>
            </div>
          </div>
        </div>
      )}

      {/* Bank transfer instruction panel — Memphis container */}
      {bankDetails && (
        <div
          className="fixed inset-0 z-modal flex items-center justify-center bg-ink/40 px-4"
          onClick={close}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              border: '3px solid var(--canvas-card-border)',
              borderRadius: 'var(--canvas-card-radius)',
              boxShadow: 'var(--canvas-card-shadow)',
            }}
            className="w-full max-w-[480px] rounded-sm"
          >
            <header
              style={{
                background: 'var(--canvas-bg)',
                borderBottom: '2.5px solid var(--canvas-card-border)',
                borderTopLeftRadius: 'var(--canvas-card-radius)',
                borderTopRightRadius: 'var(--canvas-card-radius)',
              }}
              className="flex items-center justify-between px-5 py-3"
            >
              <div
                style={{ fontFamily: outfitStack }}
                className="text-xs font-extrabold uppercase tracking-[0.22em] text-ink-2"
              >
                {t('checkoutEyebrow')}
              </div>
              <IconButton
                onClick={close}
                aria-label="계좌이체 안내 닫기"
                className="text-2xl leading-none"
              >
                ×
              </IconButton>
            </header>
            <div className="px-5 py-5">
              <h3
                style={{ fontFamily: outfitStack, letterSpacing: '-0.02em' }}
                className="text-2xl font-extrabold text-ink-2"
              >
                {t('bankTitle')}
              </h3>
              <p className="mt-2 text-md leading-[1.7] text-mute">{t('bankBody')}</p>

              <dl
                style={{
                  background: 'var(--canvas-bg)',
                  border: '2.5px solid var(--canvas-card-border)',
                  borderRadius: '10px',
                  boxShadow: 'var(--memphis-shadow-xs)',
                }}
                className="mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 px-4 py-4"
              >
                {bankDetails.bankName && (
                  <>
                    <dt
                      style={{ fontFamily: outfitStack }}
                      className="text-xs-soft font-bold uppercase tracking-[0.18em] text-ink-2"
                    >
                      {t('bankBankName')}
                    </dt>
                    <dd className="text-lg font-semibold text-ink-2">{bankDetails.bankName}</dd>
                  </>
                )}
                {bankDetails.accountNumber && (
                  <>
                    <dt
                      style={{ fontFamily: outfitStack }}
                      className="text-xs-soft font-bold uppercase tracking-[0.18em] text-ink-2"
                    >
                      {t('bankAccountNumber')}
                    </dt>
                    <dd className="text-lg font-semibold text-ink-2 tabular-nums">{bankDetails.accountNumber}</dd>
                  </>
                )}
                {bankDetails.accountHolder && (
                  <>
                    <dt
                      style={{ fontFamily: outfitStack }}
                      className="text-xs-soft font-bold uppercase tracking-[0.18em] text-ink-2"
                    >
                      {t('bankAccountHolder')}
                    </dt>
                    <dd className="text-lg font-semibold text-ink-2">{bankDetails.accountHolder}</dd>
                  </>
                )}
                <dt
                  style={{ fontFamily: outfitStack }}
                  className="text-xs-soft font-bold uppercase tracking-[0.18em] text-ink-2"
                >
                  {t('bankAmount')}
                </dt>
                <dd className="text-lg font-semibold text-ink-2 tabular-nums">{formatKrw(bankDetails.amountKrw)}</dd>
                <dt
                  style={{ fontFamily: outfitStack }}
                  className="text-xs-soft font-bold uppercase tracking-[0.18em] text-ink-2"
                >
                  {t('bankReference')}
                </dt>
                <dd
                  style={{
                    background: 'var(--canvas-accent)',
                    border: '2px solid var(--canvas-card-border)',
                    boxShadow: 'var(--memphis-shadow-xs)',
                    borderRadius: '6px',
                  }}
                  className="inline-block self-start px-2 py-0.5 font-mono text-xl font-bold tracking-[0.08em] text-paper"
                >
                  {bankDetails.bankReference}
                </dd>
              </dl>

              <p className="mt-4 text-sm leading-[1.6] text-mute-soft">{t('bankFootnote')}</p>

              <div className="mt-6 flex justify-end">
                <Button
                  variant="primary"
                  size="md"
                  onClick={close}
                  style={memphisCta('pink')}
                >
                  {t('done')}
                </Button>
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
  // PR-D17 pop: Memphis card-style toggle. Active = pink-tinted bg + offset
  // shadow; inactive = white paper. Reuses Button primitive for hover /
  // disabled wiring; style overrides drop the centered BASE flex into a
  // left-aligned stacked layout.
  const layout =
    '!justify-start !items-start text-left !px-3 !py-2.5 !font-normal';
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...memphisGhost(active && !disabled),
        background: disabled
          ? '#f3f3f3'
          : active
          ? '#fff0f4'
          : '#fff',
        color: disabled ? 'var(--color-mute-soft)' : '#000',
        opacity: 1,
      }}
      className={layout}
    >
      <span className="flex flex-col items-start gap-0.5 w-full">
        <span
          style={{ fontFamily: outfitStack }}
          className="text-md font-extrabold uppercase tracking-[0.08em]"
        >
          {label}
        </span>
        <span className="text-xs-soft text-mute-soft normal-case tracking-normal">
          {hint}
        </span>
      </span>
    </Button>
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
      <span className="text-xs-soft font-semibold uppercase tracking-[0.18em] text-mute-soft">
        {label}
      </span>
      <Input
        type={type ?? 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="px-2.5 py-1.5 text-md text-ink-2"
      />
    </label>
  );
}

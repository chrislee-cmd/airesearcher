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
//      각 스토어의 기존 Product/Variant 를 GET 으로 나열 → **안정 이름 규약**으로
//      매칭 → 각 항목을 OK(variant id 확보) / MISSING(대시보드 생성 필요) /
//      DRIFT(가격·주기 불일치 → 대시보드 수정) 로 판정. read-only 라 재실행해도
//      결과 동일(멱등). 매칭된 variant id 를 A1 env 키명으로 paste-ready 출력.
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
  productName: string; // stable idempotent match key
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

// Stable product-name convention = the idempotent match key. This exact string
// is what the operator names the product in the Lemon Squeezy dashboard; the
// script matches on it (normalized) on every re-run.
function productNameFor(kind: Kind, id: string): string {
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
        productName: productNameFor('pack', b.id),
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
        productName: productNameFor('sub', t.id),
      });
    }
  }
  // fx only affects the *display/drift* of USD; keep it referenced so the
  // derivation stays visible at the call site.
  void fx;
  return out;
}

// Expected price in Lemon Squeezy's integer minor unit ("cents"). For KRW (a
// zero-decimal currency) LS stores the whole-won amount; for USD it is cents.
function expectedCents(d: Desired, fx: number): number {
  if (d.currency === 'KRW') return d.priceKrw; // zero-decimal → won == unit
  return Math.round((d.priceKrw / fx) * 100); // USD cents, derived via FX
}

function formatMoney(cents: number, currency: Currency): string {
  if (currency === 'KRW') return `₩${cents.toLocaleString('en-US')}`;
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
      result.push({
        variantId: v.id,
        productId: p.id,
        productName,
        variantName: String(a.name ?? ''),
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

function reconcileOne(
  d: Desired,
  storeVariants: StoreVariant[],
  fx: number,
): Reconciled {
  const wantNorm = normalizeName(d.productName);
  const wantTokens = wantNorm.split(' '); // ['air', kind, id]
  // Primary: exact normalized product-name match. Secondary: product name
  // contains all tokens (air + kind + id) — tolerant to added suffixes.
  const candidates = storeVariants.filter((v) => {
    const pn = normalizeName(v.productName);
    if (pn === wantNorm) return true;
    return wantTokens.every((t) => pn.split(' ').includes(t));
  });

  const notes: string[] = [];
  if (d.priceKrw === 0) {
    notes.push(
      'SSOT priceKrw is null/0 ("contact sales") — not a fixed provisionable variant.',
    );
  }

  if (candidates.length === 0) {
    return { desired: d, status: 'missing', notes };
  }
  if (candidates.length > 1) {
    notes.push(
      `${candidates.length} products matched "${d.productName}" — narrow the naming so exactly one matches. Candidates: ${candidates
        .map((c) => `${c.productName}#${c.variantId}`)
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
      const idPart = `${STATUS_ICON[r.status]} ${d.productName.padEnd(18)} ${price}${intervalLabel} (${d.credits}cr)`;
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
    console.log('    대시보드에서 아래 이름·가격·주기로 생성/수정 후 이 스크립트를 재실행하세요:');
    for (const r of reconciled.filter((x) => x.status !== 'ok')) {
      const d = r.desired;
      const want = expectedCents(d, fx);
      console.log(
        `      [${r.status}] "${d.productName}" (${d.currency}) — ${formatMoney(want, d.currency)}${
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
        `# ${r.desired.envKey}=  # ${r.status}: 대시보드에서 "${r.desired.productName}" (${r.desired.currency}) 생성 후 재실행`,
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

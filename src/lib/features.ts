export type FeatureKey =
  | 'quotes'
  | 'transcripts'
  | 'interviews'
  | 'reports'
  | 'scheduler'
  | 'moderator'
  | 'analyzer'
  | 'desk'
  | 'keywords'
  | 'recruiting'
  | 'survey'
  | 'quant'
  | 'affinity_bubble'
  | 'video'
  | 'translate'
  // 프로빙 어시스턴트 — 인터뷰 진행 중 응답자 성찰 + 검증 질문 제안 위젯.
  // 세션 lifecycle 기반 차감: 시작 lump 25 credit (첫 1시간 포함) + 1시간
  // 단위 heartbeat 25 credit (₩50,000/hr). 4시간 = 100 credit cap
  // (server-side tick_index ≤ 3 강제). canvas widget 으로 entry,
  // 별도 페이지 라우트 없음 — href 는 canvas focus 쿼리.
  | 'probing'
  // PPT 생성기 (SlideGen) — 보고서 텍스트를 도식 슬라이드 덱으로 변환. PR1 은
  // 결정론적 뼈대(`##` 헤딩 분할 + bullet_body 폴백)만. LLM 분류기 / 편집기 /
  // PptxGenJS export 는 후속 PR. PREVIEW 게이트로 super-admin 만 노출.
  | 'slidegen'
  // Unified Insights Analyzer — merges the existing interview-result and
  // full-report generators into one upload → dashboard → chat surface.
  // Stays in PREVIEW_FEATURES until the dashboard/viz/chat PRs land; the
  // GA flip + legacy route redirect is the last PR in the series.
  | 'insights_analyzer'
  // Autocontents (enko) native migration — canvas-only entry point.
  // PR-1 ships the placeholder widget + API shells; PR-2 ports the UI;
  // PR-3 wires real generation/deploy. Stays in PREVIEW_FEATURES across
  // the whole 3-PR sequence; credit cost finalized in PR-3.
  | 'autocontents'
  // Canvas placeholder widgets — 우측 열 3장 (3×3 그리드). 실제 backend 없이
  // "🚧 준비 중" placeholder 만. 각 위젯의 실 스키마/API/본문은 후속 spec 에서.
  // 'moderator_ai' 는 옛 'moderator' (감수자/휴먼 모더레이터) 와 별개 키.
  | 'guideline'
  | 'moderator_ai'
  | 'ppt_report';

// Credit costs are scaled around 1 credit ≈ ₩2,000.
// Three marquee features carry the value: 전사록 / 인터뷰 결과 / 데스크 리서치.
// All other utility-style generations sit at 1 credit so they don't gate exploration.
// `cost` is the canonical (most common) price displayed in headers.
// For features with conditional pricing (e.g. scheduler — only the CSV
// upload path charges), the cost is the *base* price; the conditional
// surcharge is described in the locale `Features.<key>.cost` string and
// enforced on the server when applicable.
export const FEATURES: { key: FeatureKey; href: string; cost: number }[] = [
  { key: 'quotes', href: '/quotes', cost: 25 },
  { key: 'transcripts', href: '/transcripts', cost: 1 },
  { key: 'interviews', href: '/interviews', cost: 10 },
  { key: 'reports', href: '/reports', cost: 50 },
  { key: 'scheduler', href: '/scheduler', cost: 0 },
  { key: 'moderator', href: '/moderator', cost: 1 },
  { key: 'analyzer', href: '/analyzer', cost: 1 },
  { key: 'desk', href: '/desk', cost: 75 },
  { key: 'keywords', href: '/keywords', cost: 1 },
  { key: 'recruiting', href: '/recruiting', cost: 10 },
  { key: 'survey', href: '/survey', cost: 1 },
  { key: 'quant', href: '/quant', cost: 15 },
  // Affinity Bubble is a partner showcase, not an in-app generator;
  // cost stays 0, the page just previews the offering and links out.
  { key: 'affinity_bubble', href: '/affinity-bubble', cost: 0 },
  // video is priced dynamically by duration (2 credits per started 10min);
  // the value here is the minimum charge surfaced in sidebar / cost pills.
  { key: 'video', href: '/video', cost: 2 },
  // AI 동시통역. 실 오디오-분 과금(E1, docs/pricing-scheme.md §6): 실 녹음
  // 오디오 길이(`translate_recordings.duration_sec`) 기준으로 75cr(첫 10분
  // 포함) + 실 오디오 10분당 10cr, 여기에 75% 마진 floor 클램프
  // (`translateCreditsForAudioSeconds` · `TRANSLATE_METERING`). wall-clock
  // 이 아니라 실 오디오라 좀비/침묵 세션이 과금을 부풀리지 않는다. 과금은
  // 세션 종료 후 recording finalize(PATCH) 시점에 정산된다.
  //
  // `cost` 75 는 sidebar/cost pill 헤드라인(첫 블록 = base 65 + 1블록 10)
  // 이고, 분당 세부는 locale `Features.translate.cost` 문자열에 있다. 저장은
  // 항상 ON(체크박스 제거) · 다운로드 무료 — 시작가가 저장+다운로드를 흡수.
  { key: 'translate', href: '/live', cost: 75 },
  // probing — canvas widget (no dedicated page route). cost 25 is the
  // *per-hour* unit price (₩50,000/hr); the session start charges one
  // lump (25 = first hour), then a client heartbeat charges 25 every
  // hour up to a 3-tick cap (100 credit / 4 hour total). `cost` here
  // is the headline number for sidebar / cost pill / paywall; the
  // lifecycle detail lives in the locale `Features.probing.cost` string.
  { key: 'probing', href: '/canvas?focus=probing', cost: 25 },
  // SlideGen — PR1 skeleton; cost is a placeholder until the LLM-backed
  // classifier/storyline PRs land. Free during PREVIEW (super-admin only).
  { key: 'slidegen', href: '/slidegen', cost: 0 },
  // Insights Analyzer — one upload produces the interview matrix +
  // consolidated insights + auto-generated visualizations + full report,
  // all searchable via chat. Cost reflects the bundle discount vs. running
  // interviews (10) + reports (50) separately; viz extraction is included.
  { key: 'insights_analyzer', href: '/insights-analyzer', cost: 30 },
  // Autocontents — canvas-only entry (no dedicated page route in PR-1).
  // Cost 0 during migration; final pricing lands with PR-3 (generate /
  // image cost models). href points back to canvas so any sidebar/dialog
  // fallback resolves cleanly.
  { key: 'autocontents', href: '/canvas', cost: 0 },
  // Canvas placeholder widgets — cost 0 (아직 과금 없음). 전용 페이지 라우트
  // 없이 canvas entry 로만 노출되지만, sidebar/dialog fallback 이 깨끗이
  // resolve 하도록 각자 예정 route path 를 href 로 둔다. 실 가격/route 는
  // 각 위젯 후속 spec 에서 확정.
  { key: 'guideline', href: '/guideline', cost: 0 },
  { key: 'moderator_ai', href: '/moderator-ai', cost: 0 },
  { key: 'ppt_report', href: '/ppt-report', cost: 0 },
];

// Features still in development — hidden from the sidebar and gated at
// the route level for everyone except super-admin orgs (organizations
// with `is_unlimited = true`). Move a key out of this list to GA the
// feature for all users.
export const PREVIEW_FEATURES: ReadonlySet<FeatureKey> = new Set<FeatureKey>([
  'transcripts',  // 스크립트 생성기 (audio→script). The 전사록 path is `quotes`.
  'survey',
  'analyzer',
  'scheduler',
  'quant',
  'video',
  'insights_analyzer',
  'slidegen',
  'autocontents',
]);

// Single source of truth for credit pricing — read by both the
// purchase page and the sidebar copy.
//
// 2026-07-13 리프라이스: ₩2,000/cr → ₩500/cr (4배 인하). 위젯 크레딧 비용
// (FEATURE_COSTS) 자체는 불변이라 체감 가격만 1/4 로 떨어진다. 이 상수가
// 가격 SSOT — 팩(CREDIT_BUNDLES)·구독(SUBSCRIPTION_TIERS)·플로어(MIN_CREDITS)
// 가 모두 여기 ₩500/cr 기준을 따른다.
export const CREDIT_PRICE_KRW = 500;

// 무할인 수량 팩 5종. 할인율 차등을 폐지하고 전 팩 ₩500/cr 균일가로 재편.
// LS variant 매핑(billing.ts resolveLemonSqueezyTarget)이 이 id 를 신 env 키
// `LEMONSQUEEZY_VARIANT_PACK_{MINI,STARTER,PLUS,PRO,MAX}_{KRW,USD}` 로 정합.
export type CreditBundleId = 'mini' | 'starter' | 'plus' | 'pro' | 'max';

export type CreditBundle = {
  id: CreditBundleId;
  credits: number;
  // Total list price in KRW (null = "contact sales"). 현 팩은 전부 실가격.
  priceKrw: number | null;
  // Effective per-credit price (computed). 전 팩 ₩500 균일 — 무할인.
  perCreditKrw: number | null;
  popular?: boolean;
};

export const CREDIT_BUNDLES: CreditBundle[] = [
  {
    id: 'mini',
    credits: 50,
    priceKrw: 25_000,
    perCreditKrw: 500,
  },
  {
    id: 'starter',
    credits: 100,
    priceKrw: 50_000,
    perCreditKrw: 500,
    popular: true,
  },
  {
    id: 'plus',
    credits: 300,
    priceKrw: 150_000,
    perCreditKrw: 500,
  },
  {
    id: 'pro',
    credits: 600,
    priceKrw: 300_000,
    perCreditKrw: 500,
  },
  {
    id: 'max',
    credits: 1_500,
    priceKrw: 750_000,
    perCreditKrw: 500,
  },
];

// 구독 티어 — B1(결제/지급 wiring)이 소비. 여기선 상수/타입만 정의한다.
// 전 티어 ₩500/cr 무할인 (monthlyPriceKrw / includedCredits = 500).
// LS 구독 variant 는 env 키 `LEMONSQUEEZY_SUB_{SOLO,PLUS,PRO}_{KRW,USD}` 규약.
export type SubscriptionTierId = 'solo' | 'plus' | 'pro';

export type SubscriptionTier = {
  id: SubscriptionTierId;
  monthlyPriceKrw: number;
  includedCredits: number;
};

export const SUBSCRIPTION_TIERS: SubscriptionTier[] = [
  { id: 'solo', monthlyPriceKrw: 10_000, includedCredits: 20 },
  { id: 'plus', monthlyPriceKrw: 30_000, includedCredits: 60 },
  { id: 'pro', monthlyPriceKrw: 80_000, includedCredits: 160 },
];

export const FEATURE_COSTS: Record<FeatureKey, number> = Object.fromEntries(
  FEATURES.map((f) => [f.key, f.cost]),
) as Record<FeatureKey, number>;

// ── 위젯 최소 크레딧 플로어 (75% 마진 불변식) ──────────────────────────────
//
// 각 위젯의 크레딧 비용이 절대 내려가면 안 되는 하한선. 공식:
//   MIN_CREDITS[f] = ceil(COGS_f / 95)
// 유도: ₩500/cr 명목가에서 결제수수료·부가세를 빼면 순수취 ≈ ₩380/cr.
// 목표 마진 75% → COGS 는 순매출의 25% = 순매출당 ₩95/cr 이하여야 한다.
// 따라서 어떤 위젯이 원가 COGS_f(₩)를 태우면 최소 ceil(COGS_f/95) 크레딧을
// 받아야 75% 를 지킨다. SSOT 는 docs/pricing-scheme.md 의 COGS 표.
//
// ⚠️ 보수적 구현 노트 (spec writer 지목 SSOT docs/pricing-scheme.md 가 현재
// 리포 트리에 부재 → 전-위젯 COGS 표를 직접 못 읽음). 질문 금지 룰에 따라
// 가장 보수적으로 해석: 명시 앵커가 있는 위젯만 override 로 계산된 플로어를
// 두고, 나머지는 현재 FEATURE_COSTS 값을 플로어로 채택("현 비용이 이미 75%
// 불변식을 만족한다"는 가정 — 현 비용이 곧 상한이자 하한). COGS 표가 확정되면
// 이 override 맵만 갱신하면 된다. D1(min-credit-floor-guard)이 cost < floor
// 위젯을 감지하고, translate 는 E1 이 실오디오-분 기준으로 강제한다.
const MIN_CREDIT_OVERRIDES: Partial<Record<FeatureKey, number>> = {
  // interviews: COGS ≈ ₩950–1,045 가정 → ceil(≈1000/95) = 11. 현 비용 10cr 은
  // 이 플로어를 1 밑돎 → 문서화된 경계 예외(코스트는 10 유지, D1 이 감지).
  interviews: 11,
  // translate: 실오디오-분 종속이라 정적 플로어를 여기서 확정 못 한다.
  // placeholder 0(=정적 플로어 미설정 플래그) — E1 이 실측 분 기준으로 강제.
  // 실제 분당 floor 는 `TRANSLATE_METERING.floorCogsKrwPerMinute` +
  // `translateCreditsForAudioSeconds()` 가 finalize 시점에 동적 강제한다.
  translate: 0,
};

export const MIN_CREDITS: Record<FeatureKey, number> = Object.fromEntries(
  FEATURES.map((f) => [f.key, MIN_CREDIT_OVERRIDES[f.key] ?? f.cost]),
) as Record<FeatureKey, number>;

// ── 동시통역 실오디오-분 메터링 (E1 가드레일) ─────────────────────────────
//
// SSOT: docs/pricing-scheme.md §6. 통역은 realtime 원가가 변동비 대부분이라
// ₩500/cr 에서 순마진 ~72–81%(75% 경계선). 그래서 두 겹의 가드로 마진을
// 자동 보장한다:
//
//   1) 실 오디오-분 과금 (wall-clock 아님) — `translate_recordings.duration_sec`
//      기반. 좀비 세션 · 침묵 구간으로 새는 매출/원가를 실 오디오에 정렬.
//   2) 분당 cr floor = ceil(audioMin × COGS_per_min / 95) — 어떤 세션도
//      75% 마진선(§3.1) 아래로 못 내려가게 상향 클램프.
//
// 과금식: credits = max(metered, floor)
//   metered = baseCredits + ceil(audioMin / blockMinutes) × blockCredits
//   floor   = ceil(audioMin × floorCogsKrwPerMinute / 95)
//
// baseCredits(65) + 첫 블록(10) = 75 = 현행 헤드라인("시작 75cr"). 60분 =
// 65 + 6×10 = 125cr(=125cr/hr), docs §4.1 "125cr/hr 수준"과 일치.
//
// floorCogsKrwPerMinute: docs §4.1/§6 실측 COGS 미확정 → **보수적 상한**
// $13/hr(전액 통역 귀속 극단 가정) = ₩18,000/hr = ₩300/min 채택. 이 값에서
// 60분 floor = ceil(60 × 300 / 95) = 190cr, docs §6 "상한 ~180–190cr/hr =
// $13/hr 대응"과 일치. 실측이 들어오면 이 한 상수만 갱신하면 된다(마진
// floor 의 목적이 마진 보호이므로 미확정 구간에서는 높은 COGS 가 보수적).
export const TRANSLATE_METERING = {
  baseCredits: 65,
  blockMinutes: 10,
  blockCredits: 10,
  floorCogsKrwPerMinute: 300,
} as const;

/**
 * 통역 세션 1건의 실 오디오 길이(초)를 크레딧 비용으로 환산한다.
 * `translate_recordings.duration_sec`(실 녹음 오디오 길이) 를 입력으로 받아
 * wall-clock 이 아닌 실 오디오-분으로 과금한다.
 *
 * - 실 오디오가 없으면(≤0) 0 크레딧 — 좀비/침묵 세션이 base 로 부풀지 않게.
 * - metered(base + 블록) 와 마진 floor 중 큰 값을 취해 75% 불변식을 강제.
 * - floor 는 분당 ceil 이 아니라 총량에 한 번만 ceil — docs §6 의 시간당
 *   floor(~190cr/hr)와 일치시키기 위함(분당 ceil 은 과도 상향).
 */
export function translateCreditsForAudioSeconds(durationSec: number): number {
  const minutes = durationSec / 60;
  if (!(minutes > 0)) return 0;
  const { baseCredits, blockMinutes, blockCredits, floorCogsKrwPerMinute } =
    TRANSLATE_METERING;
  const metered =
    baseCredits + Math.ceil(minutes / blockMinutes) * blockCredits;
  const floor = Math.ceil((minutes * floorCogsKrwPerMinute) / 95);
  return Math.max(metered, floor);
}

// 위젯별 동시사용 게이트(/api/gate/*) 가 body 의 widget 파라미터가 실제
// FeatureKey 인지 서버 검증할 때 사용. 임의 문자열이 widget_active_uses/
// widget_use_queue 에 쓰레기 키로 쌓이는 것을 라우트에서 차단한다.
export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === 'string' && value in FEATURE_COSTS;
}

// Sidebar grouping. Features not listed here are still routable but
// hidden from the sidebar — useful for legacy or work-in-progress flows.
// `/canvas` 의 6장 widget (desk · quotes · moderator · translate · reports ·
// slidegen) 은 PR3 에서 사이드바 항목 제거 — 캔버스 entry 가 진입점이고
// 페이지 라우트는 그대로 유지 (deep-link 호환). Sidebar 라벨은 페이지
// 헤더 등 다른 곳에서 여전히 참조될 수 있어 messages/*.json 의
// Sidebar 섹션은 변경 X.
export type FeatureGroupKey = 'design' | 'conduct' | 'analysis';

export const FEATURE_GROUPS: {
  key: FeatureGroupKey;
  features: FeatureKey[];
}[] = [
  { key: 'design', features: ['recruiting', 'scheduler', 'transcripts'] },
  { key: 'conduct', features: ['survey'] },
  {
    key: 'analysis',
    features: [
      'insights_analyzer',
      'interviews',
      'analyzer',
      'quant',
      'video',
      'affinity_bubble',
    ],
  },
];

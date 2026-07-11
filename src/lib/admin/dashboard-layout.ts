import { z } from 'zod';

/* ────────────────────────────────────────────────────────────────────
   /status 구성형 위젯 보드 — 레이아웃 SSOT (순수 모듈, client-safe).

   위젯 id 화이트리스트 · zod 스키마 · 기본 레이아웃 · 정규화 헬퍼만 담는다.
   여기엔 어떤 서버 전용 import(service-role client, env 등)도 두지 않는다 —
   그래야 서버(status/page.tsx, write API)와 클라이언트(위젯 보드) 양쪽이 같은
   화이트리스트/스키마를 공유하면서도 service-role 키가 client 번들로 새지 않는다.
   DB 읽기/쓰기(service-role)는 이 모듈이 아니라 호출부(RSC / API route)에 있다.
   ──────────────────────────────────────────────────────────────────── */

// 저장 공유 레이아웃의 단일 row key. 과설계 금지 — 단일 공유 보드 하나.
export const PUBLIC_STATUS_LAYOUT_KEY = 'public-status';

// 배치 가능한 위젯 id 화이트리스트. 임의 키 저장을 막는 방어선이자, 위젯
// 레지스트리(analytics-widgets.tsx)의 매핑 대상이기도 하다. 새 위젯을 추가하면
// 여기 + 레지스트리 두 곳만 갱신하면 된다.
export const WIDGET_IDS = [
  'dau_wau', // DAU/WAU 추이 (report.activity)
  'cumulative_users', // 누적 가입 유저 (report.totals.users, #583)
  'revenue', // 누적 결제금액 (report.totals.revenueKrwPaid, #583)
  'feature_usage', // 기능별 사용량 (report.featureUsage)
  'widget_health', // 위젯 성공/실패율 (report.widgetHealth)
  'funnel', // 인터뷰 추가질문 퍼널 (report.interviewFunnel)
  'landing_traffic', // 랜딩 접속자 추이 (report.landing)
  'landing_source', // 랜딩 유입 소스 (report.landing)
  'landing_retention', // 랜딩 → 활성 리텐션 퍼널 (report.landing)
] as const;

export type WidgetId = (typeof WIDGET_IDS)[number];

// 컬럼 span — 최소 1, 최대 3(데스크 상한). md/sm 에서는 CSS grid 가 가용 컬럼 수로
// 자동 clamp 하므로(span 3 → 2컬럼에선 2, 1컬럼에선 1) 저장값은 항상 lg 기준 1~3.
export const MIN_SPAN = 1;
export const MAX_SPAN = 3;

export const WidgetPlacementSchema = z.object({
  id: z.enum(WIDGET_IDS),
  span: z.number().int().min(MIN_SPAN).max(MAX_SPAN),
});

export type WidgetPlacement = z.infer<typeof WidgetPlacementSchema>;

export const DashboardLayoutSchema = z.object({
  version: z.literal(1),
  // 위젯 수는 화이트리스트 크기를 넘을 수 없다(중복은 normalize 가 제거).
  widgets: z.array(WidgetPlacementSchema).max(WIDGET_IDS.length),
});

export type DashboardLayout = z.infer<typeof DashboardLayoutSchema>;

// 코드 상수 기본 레이아웃 — 저장된 row 가 없을 때(최초) 렌더 기준. 현재 /status 의
// 세로 카드 순서를 3컬럼 보드에 자연스럽게 편 배치: 누적 지표(작은 stat 2개) →
// DAU/WAU 넓게 → 기능/위젯건강 → 퍼널 → 랜딩 3종.
export const DEFAULT_LAYOUT: DashboardLayout = {
  version: 1,
  widgets: [
    { id: 'cumulative_users', span: 1 },
    { id: 'revenue', span: 1 },
    { id: 'dau_wau', span: 3 },
    { id: 'feature_usage', span: 2 },
    { id: 'widget_health', span: 1 },
    { id: 'funnel', span: 1 },
    { id: 'landing_traffic', span: 2 },
    { id: 'landing_source', span: 1 },
    { id: 'landing_retention', span: 3 },
  ],
};

// 저장/수신 레이아웃을 안전한 canonical 형태로 정규화한다:
//   - 알 수 없는 id 는 이미 zod 가 걸러냄. 여기선 중복 id 제거(첫 등장 우선)와
//     span clamp(1..3)만 추가로 보장한다.
// zod 통과 후에도 한 번 더 통과시키는 이유: 클라이언트가 보낸 배열에 같은 위젯이
// 두 번 들어오는 상태(드래그 버그 등)를 서버가 조용히 정리해 저장하기 위함.
export function normalizeLayout(layout: DashboardLayout): DashboardLayout {
  const seen = new Set<WidgetId>();
  const widgets: WidgetPlacement[] = [];
  for (const w of layout.widgets) {
    if (seen.has(w.id)) continue;
    seen.add(w.id);
    widgets.push({
      id: w.id,
      span: Math.min(MAX_SPAN, Math.max(MIN_SPAN, Math.round(w.span))),
    });
  }
  return { version: 1, widgets };
}

// 임의 jsonb(예: DB row.layout, 최초 '{}' 포함)를 안전하게 파싱해 DashboardLayout
// 으로 변환. 무효/빈 값이면 기본 레이아웃으로 fallback — 절대 throw 하지 않는다
// (벽 모니터가 파싱 에러로 죽으면 안 됨).
export function parseLayoutOrDefault(raw: unknown): DashboardLayout {
  const parsed = DashboardLayoutSchema.safeParse(raw);
  if (!parsed.success) return DEFAULT_LAYOUT;
  const normalized = normalizeLayout(parsed.data);
  // 전부 걸러져 빈 배열이 되면(예: 손상 데이터) 기본 배치로.
  return normalized.widgets.length > 0 ? normalized : DEFAULT_LAYOUT;
}

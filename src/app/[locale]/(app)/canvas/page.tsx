import { setRequestLocale } from 'next-intl/server';
import { CanvasBoard } from './canvas-board';
import {
  CANVAS_ORDER,
  CANVAS_VISIBILITY,
  CANVAS_NORMAL_HIDDEN,
  type CanvasWidgetKey,
} from '@/lib/canvas/visibility';
import { PREVIEW_FEATURES, type FeatureKey } from '@/lib/features';
import { getActiveOrg, getOrgFlags } from '@/lib/org';
import { recruitingCard } from '@/components/canvas/widgets/recruiting-card';
import { quotesCard } from '@/components/canvas/widgets/quotes-card';
import { deskCard } from '@/components/canvas/widgets/desk-card';
import { interviewsCard } from '@/components/canvas/widgets/interviews-card';
import { moderatorCard } from '@/components/canvas/widgets/moderator-card';
import { translateCard } from '@/components/canvas/widgets/translate-card';
import { probingCard } from '@/components/canvas/widgets/probing-card';
import { toplineCard } from '@/components/canvas/widgets/topline-card';
import { slidegenCard } from '@/components/canvas/widgets/slidegen-card';
import { guidelineCard } from '@/components/canvas/widgets/guideline-card';
import { moderatorAiCard } from '@/components/canvas/widgets/moderator-ai-card';
import { pptReportCard } from '@/components/canvas/widgets/ppt-report-card';
import { RealtimeTranscriptProvider } from '@/components/realtime-transcript-provider';
import type { WidgetContent } from '@/components/canvas/widget-types';
import { DESIGN_BRAND_OVERRIDE_KEYS } from '@/lib/design-brands';

// CanvasWidgetKey → WidgetContent 매핑. visibility 가 true 인 키만
// page 가 board 로 전달 → board 가 vertical stack 으로 렌더.
const CARD_REGISTRY: Record<CanvasWidgetKey, WidgetContent> = {
  recruiting: recruitingCard,
  quotes: quotesCard,
  desk: deskCard,
  interviews: interviewsCard,
  moderator: moderatorCard,
  translate: translateCard,
  probing: probingCard,
  topline: toplineCard,
  slidegen: slidegenCard,
  guideline: guidelineCard,
  moderator_ai: moderatorAiCard,
  ppt_report: pptReportCard,
};

// 일반(비-unlimited) 계정에게 라이브로 열리는 canvas 위젯. OPEN 외의 visible
// 위젯은 body 를 WidgetComingSoonGate 로 치환해 "준비중 + 수요투표" 로 렌더한다
// (unlimited 계정은 lockedKeys 가 비어 전부 라이브 — 회귀 0). hidden 위젯
// (moderator/topline/slidegen) 은 CANVAS_VISIBILITY=false 로 이미 제외돼 범위 밖.
const OPEN_FOR_NORMAL: ReadonlySet<CanvasWidgetKey> = new Set<CanvasWidgetKey>([
  'probing',
  'translate',
  'quotes', // 전사록
  'moderator_ai', // AI UT — placeholder 교체 후 실기능 활성(dimmed 제거 동반)
]);

// org gate 를 한 번만 해석 — preview 게이트(isUnlimited)와 vote 저장 컨텍스트
// (orgId)를 함께 반환. org 미소속이면 비-unlimited + orgId null.
async function resolveOrgGate(): Promise<{
  isUnlimited: boolean;
  orgId: string | null;
}> {
  const org = await getActiveOrg();
  if (!org) return { isUnlimited: false, orgId: null };
  const flags = await getOrgFlags(org.org_id);
  return { isUnlimited: flags.isUnlimited, orgId: org.org_id };
}

// Design-system override allowlist for `?design=<name>`. Keys are sourced
// from src/lib/design-brands.ts (SSOT shared with the /design grid). Adding
// a new reference brand only needs: (1) its `[data-design="<key>"]` block
// in globals.css, (2) a row in DESIGN_BRANDS — this set picks it up
// automatically. Default (no param) keeps the bento tone.
const DESIGN_OVERRIDES = DESIGN_BRAND_OVERRIDE_KEYS;

export default async function CanvasPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ focus?: string; design?: string }>;
}) {
  const { locale } = await params;
  const { focus, design } = await searchParams;
  setRequestLocale(locale);

  const { isUnlimited, orgId } = await resolveOrgGate();

  // server-side visibility resolve — hard-coded map + preview gate.
  // 후속 PR 에서 org flags / per-widget db visibility 로 일반화 예정.
  // 3단 필터: (1) hard-coded visibility → (2) preview 게이트(FeatureKey 인
  // recruiting·desk·interviews·video 등 일반계정 숨김) → (3) 캔버스 전용
  // placeholder 키(guideline·ppt_report) 일반계정 숨김. unlimited(관리자)는
  // (2)(3) 모두 우회 → 9개 그대로(회귀 0). 일반계정 결과 = probing·translate·
  // moderator_ai·quotes 정확히 4개.
  const visibleKeys = CANVAS_ORDER.filter((k) => CANVAS_VISIBILITY[k])
    .filter((k) => !PREVIEW_FEATURES.has(k as FeatureKey) || isUnlimited)
    .filter((k) => isUnlimited || !CANVAS_NORMAL_HIDDEN.has(k));
  const widgets = visibleKeys.map((k) => CARD_REGISTRY[k]);

  // 일반계정 게이트 대상 = visible 중 OPEN 아닌 키. unlimited 는 빈 배열 →
  // board 가 body 를 그대로 렌더 (회귀 0). 직렬화 가능한 string[] 로 넘겨
  // 클라(board)에서 ExpandedBody 를 WidgetComingSoonGate 로 치환한다
  // (서버→클라 closure 전달 불가 회피).
  const lockedKeys = isUnlimited
    ? []
    : visibleKeys.filter((k) => !OPEN_FOR_NORMAL.has(k));

  const designOverride = design && DESIGN_OVERRIDES.has(design) ? design : null;

  // RealtimeTranscriptProvider — translate 위젯이 publisher, probing 등
  // 다른 위젯이 consumer. canvas 안에서만 의미 있어 layout 이 아니라 page
  // 레벨에서 마운트. /live 페이지에는 영향 없음.
  const board = (
    <RealtimeTranscriptProvider>
      <CanvasBoard
        widgets={widgets}
        initialFocus={focus}
        lockedKeys={lockedKeys}
        orgId={orgId}
      />
    </RealtimeTranscriptProvider>
  );

  return designOverride ? (
    <div data-design={designOverride} className="contents">
      {board}
    </div>
  ) : (
    board
  );
}

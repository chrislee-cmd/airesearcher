import { setRequestLocale } from 'next-intl/server';
import { CanvasBoard } from './canvas-board';
import {
  CANVAS_ORDER,
  CANVAS_NORMAL_HIDDEN,
  type CanvasWidgetKey,
} from '@/lib/canvas/visibility';
import { getCanvasVisibility } from '@/lib/canvas/visibility-server';
import { getPublishedCanvasLayout } from '@/lib/canvas/layout-publish-server';
import { getCurrentUser } from '@/lib/supabase/user';
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
  'interviews', // 인터뷰 결과 생성기 — GA 해제(card 676), 실기능 라이브
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

  // DB 기반 위젯 노출 해석 — widget_visibility 플래그를 코드 기본값 위에 override.
  // 슈퍼어드민이면 전 위젯 노출(visible 전부 true) + hiddenForNormal 로 "숨김"
  // 뱃지 대상 전달. 조회 실패 시 코드 기본값 fallback(제약 1).
  const user = await getCurrentUser();
  const vis = await getCanvasVisibility(user?.email);

  // 발행된 캔버스 배치(전역 단일 row). 없으면 null → board 는 종전
  // defaultPositions 폴백(회귀 0). 조회 실패도 null 로 삼켜 렌더를 막지 않는다.
  const published = await getPublishedCanvasLayout();

  // 3단 필터: (1) **DB 기반 visibility**(옛 하드코딩 CANVAS_VISIBILITY 대체) →
  // (2) preview 게이트(FeatureKey 인 recruiting·desk·interviews 등 일반계정
  // 숨김) → (3) 캔버스 전용 placeholder 키(guideline·ppt_report) 일반계정 숨김.
  // (2)(3)은 이 PR 범위 밖의 기존 preview-게이트 관심사라 그대로 두되, 슈퍼어드민
  // (isSuperAdmin)도 unlimited 와 동일하게 우회시켜 "슈퍼어드민은 전 위젯 표시"
  // 를 보장(제약 2, 회귀 0 — 우회 집합에 슈퍼어드민만 추가한 strict superset).
  const bypassGate = isUnlimited || vis.isSuperAdmin;
  const visibleKeys = CANVAS_ORDER.filter((k) => vis.visible[k])
    .filter((k) => !PREVIEW_FEATURES.has(k as FeatureKey) || bypassGate)
    .filter((k) => bypassGate || !CANVAS_NORMAL_HIDDEN.has(k));
  const widgets = visibleKeys.map((k) => CARD_REGISTRY[k]);

  // 슈퍼어드민 캔버스에서 "숨김" 뱃지를 달 위젯(일반 유저에게 off) — 실제 렌더
  // 되는 위젯으로 한정. 일반 유저는 빈 배열(뱃지 없음).
  const hiddenBadgeKeys = vis.isSuperAdmin
    ? visibleKeys.filter((k) => vis.hiddenForNormal.includes(k))
    : [];

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
        hiddenBadgeKeys={hiddenBadgeKeys}
        orgId={orgId}
        publishedLayout={published?.positions ?? null}
        publishedVersion={published?.version ?? null}
        // 슈퍼어드민이면 발행 컨트롤 노출. 발행 baseline 적용은 일반계정(비-
        // 슈퍼어드민·비-unlimited)만 — 슈퍼어드민/unlimited 는 개인 배치 유지.
        canPublish={vis.isSuperAdmin}
        applyPublished={!vis.isSuperAdmin && !isUnlimited}
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

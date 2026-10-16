import { setRequestLocale } from 'next-intl/server';
import { CanvasBoard } from './canvas-board';
import {
  CANVAS_ORDER,
  CANVAS_NORMAL_HIDDEN,
  type CanvasWidgetKey,
} from '@/lib/canvas/visibility';
import { getCanvasVisibility } from '@/lib/canvas/visibility-server';
import {
  getCanvasOnboardingPending,
  getCurrentUser,
} from '@/lib/supabase/user';
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
import { WidgetChainProvider } from '@/components/canvas/chain/widget-chain-provider';
import { ChainLaneProvider } from '@/components/canvas/chain/chain-lane-provider';
import type { WidgetContent } from '@/components/canvas/widget-types';

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

export default async function CanvasPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  const { locale } = await params;
  const { focus } = await searchParams;
  setRequestLocale(locale);

  const { isUnlimited, orgId } = await resolveOrgGate();

  // DB 기반 위젯 노출 해석 — widget_visibility 플래그를 코드 기본값 위에 override.
  // 슈퍼어드민이면 전 위젯 노출(visible 전부 true) + hiddenForNormal 로 "숨김"
  // 뱃지 대상 전달. 조회 실패 시 코드 기본값 fallback(제약 1).
  const user = await getCurrentUser();
  const vis = await getCanvasVisibility(user?.email);

  // 전환 온보딩 대상 여부(P4). 유저 단위이고 cache() 라 layout 의 중복
  // 조회와 dedupe 된다. 팔레트 사용자 줄에 쓰던 표시 이름 조회는 2026-10-16
  // CD 결정(질의 ① A — 브랜드·사용자·크레딧은 Topbar 단독 소유)으로 그 줄과
  // 함께 사라졌다(`getDisplayName` 정의까지 제거 — 소비처가 이 한 곳이었다).
  // 이름 표시는 Topbar 가 자기 경로로 읽는다.
  const onboardingPending = await getCanvasOnboardingPending();

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

  // RealtimeTranscriptProvider — translate 위젯이 publisher, probing 등
  // 다른 위젯이 consumer. canvas 안에서만 의미 있어 layout 이 아니라 page
  // 레벨에서 마운트. /live 페이지에는 영향 없음.
  return (
    <RealtimeTranscriptProvider>
      {/* 위젯 체인 — 캔버스 전역 단일 컨테이너(조회·realtime·액션). 체인 바는
          캔버스에 하나뿐이고(CD §0 Q1) 카드 칩도 같은 상태를 읽으므로 board 보다
          한 겹 위에 둔다 — board 와 카드 어디서나 useWidgetChain() 으로 읽는다. */}
      <WidgetChainProvider>
      {/* 레인(도킹) 클라 상태 — 체인 데이터 위에 얹히므로 안쪽에 둔다. */}
      <ChainLaneProvider>
      {/* 그리드 좌표 **발행 배치의 소비**(publishedLayout/version · canPublish ·
          applyPublished)는 그리드 캔버스와 함께 퇴역했다 — 위젯이 작업면에
          펼쳐져 있지 않으니 적용할 좌표가 없다. 발행 데이터 자체는 파괴하지
          않는다: `widget_canvas_layout` 테이블 · `lib/canvas/layout-publish-
          server.ts` · `/api/admin/canvas-layout` 은 그대로 남아 있고, 팔레트
          로스터·순서는 `CANVAS_ORDER × widget_visibility` 에서 온다(§2 규칙 5).
          어드민 노출/순서 전환은 후속 확인 항목(스펙 "발행 전환"). */}
      <CanvasBoard
        widgets={widgets}
        initialFocus={focus}
        lockedKeys={lockedKeys}
        hiddenBadgeKeys={hiddenBadgeKeys}
        orgId={orgId}
        onboardingPending={onboardingPending}
      />
      </ChainLaneProvider>
      </WidgetChainProvider>
    </RealtimeTranscriptProvider>
  );
}

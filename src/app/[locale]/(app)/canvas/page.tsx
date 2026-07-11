import { setRequestLocale } from 'next-intl/server';
import { CanvasBoard } from './canvas-board';
import {
  CANVAS_ORDER,
  CANVAS_VISIBILITY,
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

  // server-side visibility resolve — hard-coded map + preview gate.
  // 후속 PR 에서 org flags / per-widget db visibility 로 일반화 예정.
  const visibleKeys = CANVAS_ORDER.filter((k) => CANVAS_VISIBILITY[k]).filter(
    (k) => !PREVIEW_FEATURES.has(k as FeatureKey) || isUnlimited,
  );
  const widgets = visibleKeys.map((k) => CARD_REGISTRY[k]);

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
      <CanvasBoard
        widgets={widgets}
        initialFocus={focus}
        lockedKeys={lockedKeys}
        orgId={orgId}
      />
    </RealtimeTranscriptProvider>
  );
}

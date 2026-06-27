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
};

// preview-gated widgets — 일반 유저에게는 숨김, is_unlimited org 만 노출.
// CanvasWidgetKey 와 FeatureKey 가 같은 문자열일 때만 게이트 발동 (topline 처럼
// FeatureKey 에 없는 키는 미체크 — 단순 visibility map 만 적용).
async function hasPreviewAccess(): Promise<boolean> {
  const org = await getActiveOrg();
  if (!org) return false;
  const flags = await getOrgFlags(org.org_id);
  return flags.isUnlimited;
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

  const previewOk = await hasPreviewAccess();

  // server-side visibility resolve — hard-coded map + preview gate.
  // 후속 PR 에서 org flags / per-widget db visibility 로 일반화 예정.
  const widgets = CANVAS_ORDER.filter((k) => CANVAS_VISIBILITY[k])
    .filter(
      (k) =>
        !PREVIEW_FEATURES.has(k as FeatureKey) || previewOk,
    )
    .map((k) => CARD_REGISTRY[k]);

  // RealtimeTranscriptProvider — translate 위젯이 publisher, probing 등
  // 다른 위젯이 consumer. canvas 안에서만 의미 있어 layout 이 아니라 page
  // 레벨에서 마운트. /live 페이지에는 영향 없음.
  return (
    <RealtimeTranscriptProvider>
      <CanvasBoard widgets={widgets} initialFocus={focus} />
    </RealtimeTranscriptProvider>
  );
}

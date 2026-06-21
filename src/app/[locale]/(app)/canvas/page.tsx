import { setRequestLocale } from 'next-intl/server';
import { CanvasBoard } from './canvas-board';
import {
  CANVAS_ORDER,
  CANVAS_VISIBILITY,
  type CanvasWidgetKey,
} from '@/lib/canvas/visibility';
import { quotesCard } from '@/components/canvas/widgets/quotes-card';
import { deskCard } from '@/components/canvas/widgets/desk-card';
import { moderatorCard } from '@/components/canvas/widgets/moderator-card';
import { translateCard } from '@/components/canvas/widgets/translate-card';
import { toplineCard } from '@/components/canvas/widgets/topline-card';
import { slidegenCard } from '@/components/canvas/widgets/slidegen-card';
import type { WidgetContent } from '@/components/canvas/widget-types';

// CanvasWidgetKey → WidgetContent 매핑. visibility 가 true 인 키만
// page 가 board 로 전달 → board 가 vertical stack 으로 렌더.
const CARD_REGISTRY: Record<CanvasWidgetKey, WidgetContent> = {
  quotes: quotesCard,
  desk: deskCard,
  moderator: moderatorCard,
  translate: translateCard,
  topline: toplineCard,
  slidegen: slidegenCard,
};

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

  // server-side visibility resolve — PR1 hard-coded map.
  // PR3 에서 org flags / super-admin db 조회로 교체.
  const widgets = CANVAS_ORDER.filter((k) => CANVAS_VISIBILITY[k]).map(
    (k) => CARD_REGISTRY[k],
  );

  return <CanvasBoard widgets={widgets} initialFocus={focus} />;
}

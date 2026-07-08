'use client';

import { useTranslations } from 'next-intl';
import { StageFlow, type Stage } from '@/components/ui/stage-flow';
import type { ToplineStatus } from '@/lib/interview-v2/types';
import { deriveToplineFlow } from '@/lib/interview-v2/topline-stages';

// 탑라인 생성 스트리밍의 hero — StageFlow primitive(#438) 를 탑라인 공정에
// wire 한 얇은 어댑터. 상태 파생은 deriveToplineFlow(SSOT) 에 위임하고, 여기서는
// i18n 라벨/hint 부착 + orientation 만 책임진다. 카드 ambient 밴드(vertical, 좁은
// 카드)와 fullview(horizontal) 가 이 컴포넌트를 공유해 단계 표현을 일관되게 유지.
export function ToplineStageFlow({
  status,
  mapTotal,
  mapDone,
  hasBlocks,
  orientation = 'horizontal',
  onResult,
  className,
}: {
  status: ToplineStatus;
  mapTotal?: number | null;
  mapDone?: number | null;
  hasBlocks: boolean;
  orientation?: 'horizontal' | 'vertical';
  // 완료 hero 의 "결과 보기" — 탑라인 보고서/fullview 진입. 없으면 CTA 미노출.
  onResult?: () => void;
  className?: string;
}) {
  const t = useTranslations('InterviewsV2');
  const { stages, complete } = deriveToplineFlow(
    status,
    mapTotal,
    mapDone,
    hasBlocks,
  );

  const total = mapTotal ?? 0;
  const done = Math.max(0, Math.min(mapDone ?? 0, total > 0 ? total : mapDone ?? 0));
  const label: Record<string, string> = {
    map: t('toplineStageMap'),
    reduce: t('toplineStageReduce'),
    finalize: t('toplineStageFinalize'),
  };

  const stageObjs: Stage[] = stages.map((s) => ({
    id: s.key,
    label: label[s.key],
    status: s.status,
    // map 단계 active 일 때만 "N/M 문서" hint (StageFlow 는 active hint 만 노출).
    hint:
      s.key === 'map' && s.status === 'active' && total > 0
        ? t('toplineStageMapHint', { done, total })
        : undefined,
  }));

  return (
    <StageFlow
      stages={stageObjs}
      orientation={orientation}
      complete={complete}
      completeLabel={complete ? t('toplineStageComplete') : undefined}
      onResult={onResult}
      resultLabel={t('toplineStageResultCta')}
      className={className}
    />
  );
}

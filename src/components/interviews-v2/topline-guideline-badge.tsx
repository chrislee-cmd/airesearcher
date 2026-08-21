'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

// 분석 가이드라인 배지 — 프로젝트에 가이드가 있을 때 파일명 + 교체/삭제 액션을
// 노출한다. 탑라인 카드(topline-view)와 상세 보고서(interview-read-detail) 두
// 표면이 공유한다(로직 복붙 방지). 가이드가 없을 때(filename === null)의 업로드
// 버튼은 각 표면 레이아웃이 자체 처리한다 — 이 컴포넌트는 "가이드 존재" 상태만.
export function ToplineGuidelineBadge({
  filename,
  uploading,
  deleting,
  onReplace,
  onDelete,
}: {
  // '' = 파일명 미상, 문자열 = 파일명. (null 이면 부모가 렌더하지 않음.)
  filename: string;
  uploading: boolean;
  deleting: boolean;
  onReplace: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  const name =
    filename && filename.trim() ? filename : t('toplineGuidelineUnnamed');
  const busy = uploading || deleting;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-sm border border-line-soft bg-paper-soft px-3 py-1.5">
      <span className="shrink-0 text-xs-soft font-semibold uppercase tracking-[0.16em] text-mute-soft">
        📋 {t('toplineGuidelineLabel')}
      </span>
      <span className="min-w-0 truncate text-sm text-ink-2" title={name}>
        {name}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="xs"
          onClick={onReplace}
          disabled={busy}
          title={t('toplineGuidelineReplace')}
        >
          {uploading
            ? t('toplineGuidelineUploading')
            : t('toplineGuidelineReplace')}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={onDelete}
          disabled={busy}
          title={t('toplineGuidelineDelete')}
        >
          {deleting
            ? t('toplineGuidelineDeleting')
            : t('toplineGuidelineDelete')}
        </Button>
      </div>
    </div>
  );
}

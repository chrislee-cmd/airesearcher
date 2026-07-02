'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { WidgetFullviewPanel } from '@/components/canvas/shell/widget-fullview-panel';
import { ProjectList } from './project-list';
import { ProjectDetail } from './project-detail';

// Interview V2 fullview — the widget card body stays the legacy
// InterviewAnalyzer (사용자 결정), while "전체 보기" opens this V2 shell:
// a project list ↔ project detail stack. Rendered into the shared
// FullviewShell slot by interviews-card (renderInSlot); onClose closes the
// shared modal. The list/detail toggle is local state, so re-opening the
// fullview returns to the list.

export function InterviewV2Fullview({ onClose }: { onClose: () => void }) {
  const t = useTranslations('InterviewsV2');
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);

  return (
    <WidgetFullviewPanel
      title={t('fullviewTitle')}
      subtitle={t('fullviewSubtitle')}
      onClose={onClose}
      closeLabel={t('close')}
    >
      {currentProjectId ? (
        <ProjectDetail
          projectId={currentProjectId}
          onBack={() => setCurrentProjectId(null)}
        />
      ) : (
        <ProjectList onOpenProject={(id) => setCurrentProjectId(id)} />
      )}
    </WidgetFullviewPanel>
  );
}

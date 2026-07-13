'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { WidgetFullviewPanel } from '@/components/canvas/shell/widget-fullview-panel';
import { Button } from '@/components/ui/button';
import { ProjectList } from './project-list';
import { ProjectDetail } from './project-detail';
import { SearchChat } from './search-chat';

// Interview V2 fullview — the widget card body stays the legacy
// InterviewAnalyzer (사용자 결정), while "전체 보기" opens this V2 shell:
// a project list ↔ project detail stack, plus an opt-in cross-project search
// surface. Rendered into the shared FullviewShell slot by interviews-card
// (renderInSlot); onClose closes the shared modal. The view toggle is local
// state, so re-opening the fullview returns to the list.
//
// view state: 'list' (default) · a project id string (detail) · 'cross'
// (전체 프로젝트 검색, SearchChat scoped to the picked project ids).
type View =
  | { kind: 'list' }
  | { kind: 'detail'; id: string }
  | { kind: 'cross'; projectIds: string[] };

// Cross-project search — a thin shell (back header + full-width SearchChat)
// since there's no single project's file list to show. The picked project
// ids (from CrossProjectPicker) fix the search scope.
function CrossSearch({
  projectIds,
  onBack,
}: {
  projectIds: string[];
  onBack: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line-soft px-6 py-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← {t('back')}
        </Button>
        <span className="truncate text-md font-semibold text-ink-2">
          🌐 {t('crossSearch')}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <SearchChat projectIds={projectIds} />
      </div>
    </div>
  );
}

export function InterviewV2Fullview({
  onClose,
  initialProjectId,
}: {
  onClose: () => void;
  // When opened straight into a project (e.g. right after a widget-view
  // upload), land on that project's detail instead of the list. The
  // fullview remounts on every open (portal returns null while closed), so
  // this initial value is honoured each time it opens.
  initialProjectId?: string | null;
}) {
  const t = useTranslations('InterviewsV2');
  const [view, setView] = useState<View>(
    initialProjectId
      ? { kind: 'detail', id: initialProjectId }
      : { kind: 'list' },
  );

  return (
    <WidgetFullviewPanel
      title={t('fullviewTitle')}
      subtitle={t('fullviewSubtitle')}
      onClose={onClose}
      closeLabel={t('close')}
    >
      {view.kind === 'detail' ? (
        <ProjectDetail
          projectId={view.id}
          onBack={() => setView({ kind: 'list' })}
          onOpenCrossSearch={(projectIds) =>
            setView({ kind: 'cross', projectIds })
          }
        />
      ) : view.kind === 'cross' ? (
        <CrossSearch
          projectIds={view.projectIds}
          onBack={() => setView({ kind: 'list' })}
        />
      ) : (
        <ProjectList
          onOpenProject={(id) => setView({ kind: 'detail', id })}
          onOpenCrossSearch={(projectIds) =>
            setView({ kind: 'cross', projectIds })
          }
        />
      )}
    </WidgetFullviewPanel>
  );
}

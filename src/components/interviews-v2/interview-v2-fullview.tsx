'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';
import { ProjectList } from './project-list';
import { SearchChat } from './search-chat';
import { InterviewReadDetail } from './report/interview-read-detail';

// Interview V2 fullview — 공유 <FullviewShell> 우 슬롯 본문 (fullviewV2 수렴,
// pr-iv-fullview-shell-read §0.1). 구형 WidgetFullviewPanel 경로 폐기: 셸이
// 프레임·240px 사이드바·헤더밴드(rose)·닫기✕ 를 소유하므로 이 본문은 슬롯
// 콘텐츠만 렌더한다(자체 헤더 없음). 상세는 fresh 읽기 모드(InterviewReadDetail).
//
// view state: 'list'(기본) · project id(detail) · 'cross'(전체 프로젝트 검색).
type View =
  | { kind: 'list' }
  | { kind: 'detail'; id: string }
  | { kind: 'cross'; projectIds: string[] };

// 크로스 검색 — 얇은 셸(뒤로 헤더 + 전폭 SearchChat). 리스킨은 C3 — 기존
// 컴포넌트 그대로 마운트.
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
      <div className="flex shrink-0 items-center gap-2 border-b-2 border-ink bg-paper px-6 py-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← {t('back')}
        </Button>
        <span className="truncate text-md font-semibold text-ink-2">
          {t('crossSearch')}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <SearchChat projectIds={projectIds} />
      </div>
    </div>
  );
}

export function InterviewV2Fullview({
  initialProjectId,
}: {
  // 셸이 닫기✕ 를 소유하므로 onClose 는 더 이상 본문이 쓰지 않는다(카드 호출
  // 시그니처 유지용으로만 optional 로 남긴다).
  onClose?: () => void;
  initialProjectId?: string | null;
}) {
  const { projects } = useInterviewV2Projects();
  const [view, setView] = useState<View>(
    initialProjectId
      ? { kind: 'detail', id: initialProjectId }
      : { kind: 'list' },
  );

  const detailName = useMemo(
    () =>
      view.kind === 'detail'
        ? (projects.find((p) => p.id === view.id)?.name ?? '')
        : '',
    [projects, view],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {view.kind === 'detail' ? (
        <InterviewReadDetail
          projectId={view.id}
          projectName={detailName}
          onBack={() => setView({ kind: 'list' })}
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
    </div>
  );
}

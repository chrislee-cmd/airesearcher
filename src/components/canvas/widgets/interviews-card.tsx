'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WidgetContent } from '../widget-types';
import { useFullview } from '../shell/fullview-shell-context';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import {
  DropdownMenu,
  type DropdownItem,
} from '@/components/ui/dropdown-menu';
import {
  useInterviewV2Projects,
  type InterviewProject,
} from '@/hooks/use-interview-v2-projects';
import { useInterviewV2Documents } from '@/hooks/use-interview-v2-documents';
import { CreateProjectModal } from '@/components/interviews-v2/create-project-modal';
import { UploadModal } from '@/components/interviews-v2/upload-modal';
import { SearchChat } from '@/components/interviews-v2/search-chat';
import { InterviewV2Fullview } from '@/components/interviews-v2/interview-v2-fullview';
import { track as trackEvent } from '@/lib/analytics/events';

// 카드가 "안에 들어가 있는" V2 프로젝트 id. null = idle 컨트롤 보드.
// localStorage 로 persist — 새로고침해도 카드가 같은 프로젝트의 active
// 뷰로 복귀 (프로젝트 자체는 DB-backed 이므로 id 만 기억).
const CARD_PROJECT_KEY = 'interview-v2-card-active-project';

// ────────────────────────────────────────────────────────────────────
// Idle 컨트롤 보드 (Phase 1) — 프로젝트 선택 dropdown + CTA.
//   · 프로젝트 미선택 → 📤 파일 업로드 (프로젝트-설정 gate 모달)
//   · 선택한 프로젝트에 파일 있음 → 🔍 검색 시작 (즉시 active)
//   · 선택한 프로젝트에 파일 없음 → 📤 파일 업로드 (해당 프로젝트로 preset)
// (사용자 결정 1 — CTA=파일 업로드, 파일 있으면 자동 active)
// ────────────────────────────────────────────────────────────────────
function IdleControlBoard({ onEnter }: { onEnter: (id: string) => void }) {
  const t = useTranslations('InterviewsV2');
  const { projects, isLoading, create } = useInterviewV2Projects();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const picked = useMemo(
    () => projects.find((p) => p.id === pickedId) ?? null,
    [projects, pickedId],
  );
  // 선택한 프로젝트의 파일 수로 CTA 를 분기 (파일 있으면 검색 시작).
  const { documents, isLoading: docsLoading } =
    useInterviewV2Documents(pickedId);

  const handleCreate = async (name: string, description?: string) => {
    const { project } = await create(name, description);
    if (project) {
      trackEvent('widget_action', {
        widget: 'interviews',
        action: 'project_create',
      });
      setCreateOpen(false);
      onEnter(project.id);
      return project.id;
    }
    return null;
  };

  const projectItems: DropdownItem[] = [
    ...projects.map((p) => ({
      key: p.id,
      label: p.name,
      onSelect: () => setPickedId(p.id),
    })),
    {
      key: '__new',
      label: <span className="text-amore">＋ {t('newProject')}</span>,
      onSelect: () => setCreateOpen(true),
    },
  ];

  const hasFiles = !!picked && !docsLoading && documents.length > 0;

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-8 text-center">
      <div className="w-full max-w-[360px] space-y-5">
        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-ink-2">
            {t('cardIdleTitle')}
          </h3>
          <p className="text-sm leading-[1.6] text-mute">{t('cardIdleHint')}</p>
        </div>

        {/* 프로젝트 선택 dropdown (또는 새로 만들기). */}
        <DropdownMenu
          align="start"
          items={projectItems}
          trigger={({ open, onClick, ...aria }) => (
            <Button
              {...aria}
              data-open={open}
              variant="secondary"
              size="md"
              onClick={onClick}
              disabled={isLoading}
              rightIcon={<span aria-hidden>▼</span>}
              fullWidth
            >
              {picked ? picked.name : t('cardSelectProject')}
            </Button>
          )}
        />

        {/* CTA — 파일 있으면 검색 시작, 없으면 업로드. */}
        {picked && docsLoading ? (
          <Skeleton className="h-11 w-full rounded-sm" />
        ) : hasFiles ? (
          <Button
            variant="primary"
            size="md"
            onClick={() => onEnter(picked!.id)}
            leftIcon={<span aria-hidden>🔍</span>}
            fullWidth
          >
            {t('cardSearchStart')}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="md"
            onClick={() => setUploadOpen(true)}
            leftIcon={<span aria-hidden>📤</span>}
            fullWidth
          >
            {t('cardUpload')}
          </Button>
        )}
      </div>

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
      />

      {/* 프로젝트 미선택 업로드 → 모달이 Step 2(프로젝트 설정)를 강제,
          완료 시 해당 프로젝트로 즉시 active 진입. 프로젝트 선택 상태면
          그 프로젝트로 preset (Step 2 skip). */}
      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        projectId={pickedId}
        onUploaded={(id) => {
          setUploadOpen(false);
          onEnter(id);
        }}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Slim bar (Phase 2 상단) — ⚙ 프로젝트: <name> ▼. ▼ 는 프로젝트 dropdown
// 을 재노출 (다른 프로젝트로 스위치 / 새 프로젝트 / 프로젝트 선택 화면).
// (사용자 결정 3 — slim bar = 프로젝트 전환)
// ────────────────────────────────────────────────────────────────────
function ProjectSlimBar({
  projectId,
  projectName,
  projects,
  onEnter,
  onExit,
  onUpload,
}: {
  projectId: string;
  projectName: string;
  projects: InterviewProject[];
  onEnter: (id: string) => void;
  onExit: () => void;
  onUpload: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  const [createOpen, setCreateOpen] = useState(false);
  const { create } = useInterviewV2Projects();

  const handleCreate = async (name: string, description?: string) => {
    const { project } = await create(name, description);
    if (project) {
      setCreateOpen(false);
      onEnter(project.id);
      return project.id;
    }
    return null;
  };

  const switchItems: DropdownItem[] = [
    ...projects
      .filter((p) => p.id !== projectId)
      .map((p) => ({
        key: p.id,
        label: p.name,
        onSelect: () => onEnter(p.id),
      })),
    {
      key: '__new',
      label: <span className="text-amore">＋ {t('newProject')}</span>,
      onSelect: () => setCreateOpen(true),
    },
    {
      key: '__list',
      label: t('cardBackToPicker'),
      onSelect: onExit,
    },
  ];

  return (
    <div className="flex shrink-0 items-center gap-2 border-b-[2px] border-ink bg-paper-soft px-4 py-2">
      <DropdownMenu
        align="start"
        items={switchItems}
        label={t('cardSwitchProject')}
        trigger={({ open, onClick, ...aria }) => (
          <Button
            {...aria}
            data-open={open}
            variant="ghost"
            size="sm"
            onClick={onClick}
            leftIcon={<span aria-hidden>⚙</span>}
            rightIcon={<span aria-hidden>▼</span>}
            className="min-w-0"
          >
            <span className="truncate">
              {t('cardProjectLabel')}:{' '}
              <span className="font-semibold text-ink-2">{projectName}</span>
            </span>
          </Button>
        )}
      />
      <Button
        variant="secondary"
        size="sm"
        onClick={onUpload}
        leftIcon={<span aria-hidden>📤</span>}
        className="ml-auto shrink-0"
      >
        {t('upload')}
      </Button>

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Active 뷰 (Phase 2) — slim bar + 파일 리스트 요약 + 검색 chat.
// 상세(2-panel 파일 그리드 등)는 "전체 보기" fullview 가 담당.
// (사용자 결정 2 — active = 파일 리스트 + chat 요약)
// ────────────────────────────────────────────────────────────────────
function ActiveView({
  projectId,
  onEnter,
  onExit,
}: {
  projectId: string;
  onEnter: (id: string) => void;
  onExit: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  const { projects } = useInterviewV2Projects();
  const { documents, isLoading, mutate } = useInterviewV2Documents(projectId);
  const [uploadOpen, setUploadOpen] = useState(false);

  const projectName = useMemo(
    () => projects.find((p) => p.id === projectId)?.name ?? '',
    [projects, projectId],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ProjectSlimBar
        projectId={projectId}
        projectName={projectName}
        projects={projects}
        onEnter={onEnter}
        onExit={onExit}
        onUpload={() => setUploadOpen(true)}
      />

      {/* 파일 리스트 요약 — 파일명 chip + 개수. 상세는 전체 보기. */}
      <div className="shrink-0 border-b border-line-soft px-4 py-3">
        {isLoading ? (
          <div className="flex gap-2">
            <Skeleton className="h-6 w-24 rounded-sm" />
            <Skeleton className="h-6 w-20 rounded-sm" />
          </div>
        ) : documents.length === 0 ? (
          <EmptyState
            tone="subtle"
            title={t('noFilesTitle')}
            description={t('noFilesDescription')}
          />
        ) : (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mute-soft">
              {t('cardFilesCount', { count: documents.length })}
            </div>

            {/* 인덱싱 중인 파일 — chunk 단위 progress bar + "N/M (X%)".
                (fullview FileCard 와 동일한 신호. 위젯 요약 뷰에서도 "언제
                끝날지" 를 볼 수 있도록.) hook 이 indexing 있을 때 2초 폴링. */}
            {documents
              .filter((d) => d.index_status === 'indexing')
              .map((d) => {
                const hasProg =
                  d.total_chunks != null && d.total_chunks > 0;
                const pct = hasProg
                  ? Math.min(
                      100,
                      Math.round((d.processed_chunks / d.total_chunks!) * 100),
                    )
                  : 0;
                return (
                  <div key={d.id} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-ink-2" title={d.filename}>
                        {d.filename}
                      </span>
                      <span className="shrink-0 tabular-nums text-mute-soft">
                        {hasProg
                          ? `${d.processed_chunks}/${d.total_chunks} (${pct}%)`
                          : t('statusIndexing')}
                      </span>
                    </div>
                    {hasProg && (
                      <div className="h-1 w-full overflow-hidden rounded-xs bg-line-soft">
                        <div
                          className="h-full bg-amore transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}

            {/* 나머지 파일 (완료 / 대기 / 오류) — 파일명 chip 요약. */}
            {documents.some((d) => d.index_status !== 'indexing') && (
              <div className="flex flex-wrap gap-1.5">
                {documents
                  .filter((d) => d.index_status !== 'indexing')
                  .map((d) => (
                    <span
                      key={d.id}
                      className="max-w-[180px] truncate rounded-sm border border-line-soft bg-paper px-2 py-0.5 text-xs text-mute"
                      title={d.filename}
                    >
                      {d.filename}
                    </span>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 검색 chat — 현재 프로젝트 스코프 (project-detail 과 동일 컴포넌트). */}
      <div className="min-h-0 flex-1">
        <SearchChat
          projectIds={null}
          currentProject={{ id: projectId, name: projectName }}
        />
      </div>

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        projectId={projectId}
        onUploaded={() => void mutate()}
      />
    </div>
  );
}

function ExpandedBody() {
  // "전체 보기" → InterviewV2Fullview (공유 FullviewShell slot 으로 portal).
  // idle 이면 프로젝트 목록부터, active 면 해당 프로젝트 상세로 진입.
  const { renderInSlot, close } = useFullview('interviews');

  // 카드가 들어가 있는 프로젝트. null = idle. SSR 기본 null → 하이드레이션
  // 후 localStorage 값 복원 (use-consent.ts 와 동일 패턴).
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration storage probe
    setActiveProjectId(
      window.localStorage.getItem(CARD_PROJECT_KEY) || null,
    );
  }, []);

  const enterProject = (id: string) => {
    setActiveProjectId(id);
    window.localStorage.setItem(CARD_PROJECT_KEY, id);
  };
  const exitToIdle = () => {
    setActiveProjectId(null);
    window.localStorage.removeItem(CARD_PROJECT_KEY);
  };

  // Analytics — 카드 body mount 시 1회 view.
  useEffect(() => {
    trackEvent('widget_viewed', { widget: 'interviews' });
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {activeProjectId === null ? (
        <IdleControlBoard onEnter={enterProject} />
      ) : (
        <ActiveView
          projectId={activeProjectId}
          onEnter={enterProject}
          onExit={exitToIdle}
        />
      )}

      {/* 공유 전체보기 모달 slot. 헤더 "전체보기" 버튼(shell)이 열면
          현재 프로젝트(active) 또는 목록(idle)으로 진입. */}
      {renderInSlot(
        <InterviewV2Fullview
          onClose={close}
          initialProjectId={activeProjectId}
        />,
      )}
    </div>
  );
}

// 인터뷰 결과 생성기 canvas widget — V2 컨트롤 보드. Phase 1(idle) = 프로젝트
// 선택 + 업로드, Phase 2(active) = slim bar + 파일 리스트 요약 + 검색 chat.
// 상세는 "전체 보기" (InterviewV2Fullview). accent 는 moderator 와 같은 peach
// 재사용 (썸네일이 시각 식별자 우선).
export const interviewsCard: WidgetContent = {
  key: 'interviews',
  meta: {
    label: '인터뷰 결과 생성기',
    accent: 'peach',
    cost: 10,
    thumbnail: '/thumbnail/analysis.png',
    description:
      '여러 인터뷰 파일을 프로젝트에 올리고, 코퍼스에 자연어로 질문해 근거 인용과 함께 답을 받습니다.',
    expandedCols: 3,
  },
  state: 'idle',
  ExpandedBody,
};

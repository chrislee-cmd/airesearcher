'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WidgetContent } from '../widget-types';
import { useFullview } from '../shell/fullview-shell-context';
import { Button } from '@/components/ui/button';
import { WidgetPrimaryCta } from '@/components/canvas/shell/widget-primary-cta';
import { ControlBoardPanel } from '@/components/canvas/shell/control-board-panel';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import {
  ProcessTimeline,
  buildLinearPhases,
} from '@/components/ui/process-timeline';
import {
  DropdownMenu,
  type DropdownItem,
} from '@/components/ui/dropdown-menu';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';
import { useInterviewV2Documents } from '@/hooks/use-interview-v2-documents';
import { CreateProjectModal } from '@/components/interviews-v2/create-project-modal';
import { UploadModal } from '@/components/interviews-v2/upload-modal';
import { InterviewV2Fullview } from '@/components/interviews-v2/interview-v2-fullview';
import { track as trackEvent } from '@/lib/analytics/events';

// 카드가 "안에 들어가 있는" V2 프로젝트 id. null = idle 컨트롤 보드.
// localStorage 로 persist — 새로고침해도 카드가 같은 프로젝트의 active
// 뷰로 복귀 (프로젝트 자체는 DB-backed 이므로 id 만 기억).
const CARD_PROJECT_KEY = 'interview-v2-card-active-project';

// ────────────────────────────────────────────────────────────────────
// 프로젝트 선택 컨트롤 — 옛 border-b 슬림 바 폐기 (메인 패널 규격 통일:
// 컨트롤은 transparent 그룹 안에 배치). 프로젝트 선택/전환 dropdown
// (선택 즉시 active 진입) + 새 프로젝트 + (active 시) 목록으로 나가기.
// idle(activeProjectId=null) 에서는 "프로젝트 선택" 라벨, active 에서는
// "프로젝트: <name>" 라벨.
// ────────────────────────────────────────────────────────────────────
function ProjectSelectControl({
  activeProjectId,
  activeProjectName,
  onEnter,
  onExit,
}: {
  activeProjectId: string | null;
  activeProjectName: string | null;
  onEnter: (id: string) => void;
  onExit: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  const { projects, isLoading, create } = useInterviewV2Projects();
  const [createOpen, setCreateOpen] = useState(false);

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

  const items: DropdownItem[] = [
    ...projects
      .filter((p) => p.id !== activeProjectId)
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
    // active 상태에서만 "프로젝트 목록으로" (idle 로 복귀) 를 노출.
    ...(activeProjectId
      ? [{ key: '__list', label: t('cardBackToPicker'), onSelect: onExit }]
      : []),
  ];

  return (
    <>
      <DropdownMenu
        align="start"
        items={items}
        label={activeProjectId ? t('cardSwitchProject') : t('cardSelectProject')}
        trigger={({ open, onClick, ...aria }) => (
          <Button
            {...aria}
            data-open={open}
            variant="ghost"
            size="sm"
            onClick={onClick}
            disabled={isLoading}
            leftIcon={<span aria-hidden>⚙</span>}
            rightIcon={<span aria-hidden>▼</span>}
            className="min-w-0"
          >
            <span className="truncate">
              {activeProjectName != null ? (
                <>
                  {t('cardProjectLabel')}:{' '}
                  <span className="font-semibold text-ink-2">
                    {activeProjectName}
                  </span>
                </>
              ) : (
                t('cardSelectProject')
              )}
            </span>
          </Button>
        )}
      />

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
      />
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// Idle 본문 — 메인 패널 규격 통일 (데스크/프로빙 idle 기준): 컨트롤을
// 카드 정중앙(수직+수평 center)에 transparent 로 띄우고, 주요 CTA
// (📤 파일 업로드 = ChromeButton default lg)는 컨트롤 아래 gap-8.
// 프로젝트를 선택하거나 새로 만들거나 파일을 올리면 active 로 진입한다.
// ────────────────────────────────────────────────────────────────────
function IdleBody({ onEnter }: { onEnter: (id: string) => void }) {
  const t = useTranslations('InterviewsV2');
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* idle 컨트롤보드 = ControlBoardPanel SSOT (wrapper/폭/정렬/간격 박제).
          첫 클러스터의 items-center/text-center 제거 = 좌정렬 통일 (spec 편차
          제거 — 데스크/프로빙/전사록과 동일). 주 액션(📤 업로드)은 하단 액션
          바로 이동 (6 위젯 통일). */}
      <ControlBoardPanel>
        {/* 컨트롤 그룹 — 안내 + 프로젝트 선택. transparent (회색 패널 X). 좌정렬. */}
        <div className="flex flex-col gap-4 bg-transparent">
          <div className="space-y-2">
            <p className="text-sm leading-[1.6] text-mute">
              {t('cardIdleHint')}
            </p>
          </div>
          <ProjectSelectControl
            activeProjectId={null}
            activeProjectName={null}
            onEnter={onEnter}
            onExit={() => {}}
          />
        </div>
      </ControlBoardPanel>

      {/* 주 CTA(업로드) — 바디 최하단 고정 액션 바 (6 위젯 통일). idle 의 주요
          액션은 업로드 (모달이 프로젝트 설정을 강제 → active 진입). */}
      <WidgetPrimaryCta
        label={t('cardUpload')}
        icon="📤"
        onClick={() => setUploadOpen(true)}
      />

      {/* 프로젝트 미선택 업로드 → 모달이 Step 2(프로젝트 설정)를 강제,
          완료 시 해당 프로젝트로 즉시 active 진입. */}
      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        projectId={null}
        onUploaded={(id) => {
          setUploadOpen(false);
          onEnter(id);
        }}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Active 본문 — 컨트롤 패널을 상단 고정 (데스크 active 패턴: shrink-0 +
// border-b)하고, 아래는 파일 리스트 요약 (인덱싱 타임라인 + 파일 chip)
// 만. 산출물(검색 chat/결과)은 카드에서 제거 — "검색 시작" CTA 가
// fullview (InterviewV2Fullview, SearchChat 보유) 로 일원화한다 (R5).
// ────────────────────────────────────────────────────────────────────
function ActiveBody({
  projectId,
  onEnter,
  onExit,
  onOpenFullview,
}: {
  projectId: string;
  onEnter: (id: string) => void;
  onExit: () => void;
  onOpenFullview: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  const tProcess = useTranslations('Process');
  const { projects } = useInterviewV2Projects();
  const { documents, isLoading, mutate } = useInterviewV2Documents(projectId);
  const [uploadOpen, setUploadOpen] = useState(false);

  // 인덱싱 중인 문서의 공정 과정 타임라인 (사용자 결정 R3/R5). 인터뷰V2 는
  // 단일-잡 lifecycle 이 아니라 프로젝트 워크스페이스 + 문서별 인덱싱이라,
  // 스펙의 "컨트롤 전체 대체" 대신 인덱싱 문서의 진행을 타임라인으로 시각화
  // 한다(멀티-문서 UX 보존 — 보수적 해석). index_status 는 coarse
  // (pending/indexing/done/error) 라, indexing 중 관측 가능한 chunk embedding
  // 을 active 로 두고 앞 단계(업로드/파싱/청크)는 done 으로 표기한다.
  const INT_PHASES = ['uploading', 'parsing', 'chunking', 'embedding'] as const;
  const docTimelinePhases = (d: (typeof documents)[number]) => {
    const hasProg = d.total_chunks != null && d.total_chunks > 0;
    return buildLinearPhases(
      INT_PHASES.map((k) => ({
        key: k,
        label: tProcess(`interviews.${k}` as never),
        detail:
          k === 'embedding' && hasProg
            ? `${d.processed_chunks}/${d.total_chunks} chunks`
            : undefined,
      })),
      'embedding',
    );
  };

  const projectName = useMemo(
    () => projects.find((p) => p.id === projectId)?.name ?? '',
    [projects, projectId],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 컨트롤 패널 — 상단 고정 (데스크 active 패턴). 프로젝트 전환 +
          📤 업로드(sub-action, Button 유지). 주 CTA 는 위 앵커로 이동. */}
      <div className="shrink-0 overflow-y-auto border-b border-line-soft px-5 py-5">
        <div className="flex flex-col gap-4 bg-transparent">
          <div className="flex flex-wrap items-center gap-2">
            <ProjectSelectControl
              activeProjectId={projectId}
              activeProjectName={projectName}
              onEnter={onEnter}
              onExit={onExit}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setUploadOpen(true)}
              leftIcon={<span aria-hidden>📤</span>}
              className="ml-auto shrink-0"
            >
              {t('upload')}
            </Button>
          </div>

        </div>
      </div>

      {/* 파일 리스트 요약 — 파일명 chip + 개수 + 인덱싱 진행. 상세/검색은
          전체 보기 (fullview). */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
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
              .map((d) => (
                <div
                  key={d.id}
                  className="rounded-sm border border-line-soft bg-paper px-3 py-2"
                >
                  <div
                    className="truncate text-xs font-semibold text-ink-2"
                    title={d.filename}
                  >
                    {d.filename}
                  </div>
                  <ProcessTimeline
                    phases={docTimelinePhases(d)}
                    padding="py-1"
                  />
                </div>
              ))}

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

      {/* 주 CTA(검색 시작) — 바디 최하단 고정 액션 바 (6 위젯 통일) → fullview.
          파일 리스트가 위 flex-1 영역에서 스크롤 → CTA 와 겹침 0. */}
      <WidgetPrimaryCta label={t('cardSearchStart')} onClick={onOpenFullview} />

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
  const { renderInSlot, openFullview, close } = useFullview('interviews');

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

  // "검색 시작" CTA → 통일 "전체 보기" 진입 계측 — 표준 이벤트 (데스크와
  // 동일 pattern).
  const handleOpenFullview = () => {
    trackEvent('widget_action', { widget: 'interviews', action: 'fullview_open' });
    trackEvent('widget_viewed', { widget: 'interviews', fullview: true });
    openFullview();
  };

  // Analytics — 카드 body mount 시 1회 view.
  useEffect(() => {
    trackEvent('widget_viewed', { widget: 'interviews' });
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {activeProjectId === null ? (
        <IdleBody onEnter={enterProject} />
      ) : (
        <ActiveBody
          projectId={activeProjectId}
          onEnter={enterProject}
          onExit={exitToIdle}
          onOpenFullview={handleOpenFullview}
        />
      )}

      {/* 공유 전체보기 모달 slot. 헤더 "전체보기" 버튼(shell) 또는 카드의
          "검색 시작" CTA 가 열면 현재 프로젝트(active) 또는 목록(idle)으로
          진입. */}
      {renderInSlot(
        <InterviewV2Fullview
          onClose={close}
          initialProjectId={activeProjectId}
        />,
      )}
    </div>
  );
}

// 인터뷰 결과 생성기 canvas widget — 메인 패널 규격 통일 (데스크/프로빙
// 규칙): idle 은 컨트롤(프로젝트 선택 + 업로드 CTA)을 카드 정중앙에
// transparent 로 배치, active 는 컨트롤 상단 고정 + 파일 리스트 요약만.
// 산출물(검색 chat/결과)은 "전체 보기" (InterviewV2Fullview) 로 일원화.
// accent 는 moderator 와 같은 peach 재사용.
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

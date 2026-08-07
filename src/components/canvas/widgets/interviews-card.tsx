'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { WidgetContent } from '../widget-types';
import { useFullview } from '../shell/fullview-shell-context';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  type DropdownItem,
} from '@/components/ui/dropdown-menu';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';
import { useInterviewV2Documents } from '@/hooks/use-interview-v2-documents';
import { useInterviewToplineStatus } from '@/hooks/use-interview-topline';
import { deriveToplineAbstract } from '@/lib/interview-v2/topline-abstract';
import type { ToplineStatus } from '@/lib/interview-v2/types';
import { useToast } from '@/components/toast-provider';
import { CreateProjectModal } from '@/components/interviews-v2/create-project-modal';
import { UploadModal } from '@/components/interviews-v2/upload-modal';
import {
  InlineUploadProgress,
  useHasInterviewUploadFor,
  useHasActiveInterviewUploadFor,
} from '@/components/interviews-v2/upload-progress-artifact';
import { InterviewV2Fullview } from '@/components/interviews-v2/interview-v2-fullview';
import { track as trackEvent } from '@/lib/analytics/events';
// ── S1 fresh 프레젠테이션 (BUILD-SPEC §1.1) ──────────────────────────────────
import {
  CardControlBar,
  CardScroll,
  CardFooter,
  CardFooterCta,
  ProjectPillTrigger,
  ProjectFieldTrigger,
  UploadPill,
} from './interviews/card-parts';
import { InterviewDropzone } from './interviews/interview-dropzone';
import {
  IdleModeBody,
  EmptyModeBody,
  GeneratingModeBody,
  AnalyzePromptModeBody,
  AbstractModeBody,
} from './interviews/mode-bodies';

// 카드가 "안에 들어가 있는" V2 프로젝트 id. null = idle 컨트롤 보드.
// localStorage 로 persist — 새로고침해도 카드가 같은 프로젝트의 active
// 뷰로 복귀 (프로젝트 자체는 DB-backed 이므로 id 만 기억).
const CARD_PROJECT_KEY = 'interview-v2-card-active-project';

// 인라인 dropzone accept/최대 크기 — UploadModal 과 동일 규격 (SSOT 는 모달이
// 최종 검증하지만, 카드 dropzone 도 같은 필터/한도를 걸어 UX 를 맞춘다).
const UPLOAD_ACCEPT =
  '.txt,.md,.markdown,.csv,.json,.log,.doc,.docx,.pdf,audio/*,video/*';
const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
// 크레딧 차감 — features.ts SSOT(interviews cost 10) 미러 (푸터 "💎 N 차감" 표기용).
const CARD_CREDIT_COST = 10;

// ────────────────────────────────────────────────────────────────────
// 프로젝트 선택 컨트롤 — 로직(dropdown + 생성 모달)은 그대로, 트리거만 CD
// 프레젠테이션(pill: 컨트롤바 / field: idle 대형 셀렉트)으로 분기한다.
// ────────────────────────────────────────────────────────────────────
function ProjectSelectControl({
  variant,
  activeProjectId,
  activeProjectName,
  onEnter,
  onExit,
}: {
  variant: 'pill' | 'field';
  activeProjectId: string | null;
  activeProjectName: string | null;
  onEnter: (id: string) => void;
  onExit: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  const { projects, create } = useInterviewV2Projects();
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

  // 존재하는 프로젝트 선택 항목 (현재 active 제외).
  const projectItems: DropdownItem[] = projects
    .filter((p) => p.id !== activeProjectId)
    .map((p) => ({ key: p.id, label: p.name, onSelect: () => onEnter(p.id) }));

  // pill 변형(컨트롤바) — 드롭다운에 "＋ 새 프로젝트" + (active) "목록으로" 포함.
  // field 변형(idle) — 드롭다운은 존재 프로젝트만, "＋ 새 프로젝트"는 아래 링크로.
  const items: DropdownItem[] =
    variant === 'pill'
      ? [
          ...projectItems,
          {
            key: '__new',
            label: <span className="text-amore-deep">＋ {t('newProject')}</span>,
            onSelect: () => setCreateOpen(true),
          },
          ...(activeProjectId
            ? [{ key: '__list', label: t('cardBackToPicker'), onSelect: onExit }]
            : []),
        ]
      : projectItems;

  return (
    <>
      {variant === 'pill' ? (
        <DropdownMenu
          align="start"
          items={items}
          label={activeProjectName ?? t('cardSelectProject')}
          trigger={({ open, onClick, ...aria }) => (
            <ProjectPillTrigger
              {...aria}
              open={open}
              onClick={onClick}
              name={activeProjectName ?? t('cardSelectProject')}
            />
          )}
        />
      ) : (
        <>
          <DropdownMenu
            align="start"
            fullWidth
            items={items}
            label={t('cardSelectProject')}
            trigger={({ open, onClick, ...aria }) => (
              <ProjectFieldTrigger
                {...aria}
                open={open}
                onClick={onClick}
                label={activeProjectName}
                placeholder={t('idleSelectPlaceholder')}
              />
            )}
          />
          <span
            role="button"
            tabIndex={0}
            onClick={() => setCreateOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setCreateOpen(true);
              }
            }}
            className="inline-flex w-fit cursor-pointer items-center gap-1.5 font-bold text-amore-deep"
            style={{ fontSize: 12.5 }}
          >
            ＋ {t('newProject')}
          </span>
        </>
      )}

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
      />
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// Idle 본문 (S1 1a) — 컨트롤바 없음. 대형 프로젝트 셀렉트(field) + 비활성
// 드롭존 + 안내 카드. 파일을 올리려면 먼저 프로젝트를 선택/생성해야 한다.
// ────────────────────────────────────────────────────────────────────
function IdleBody({ onEnter }: { onEnter: (id: string) => void }) {
  const t = useTranslations('InterviewsV2');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <IdleModeBody
        projectSelect={
          <ProjectSelectControl
            variant="field"
            activeProjectId={null}
            activeProjectName={null}
            onEnter={onEnter}
            onExit={() => {}}
          />
        }
        dropzone={
          <InterviewDropzone
            disabled
            title={t('idleDropDisabledTitle')}
            helper={t('idleDropDisabledHelper')}
            onFiles={() => {}}
          />
        }
      />

      {/* 프로젝트 미선택 업로드 진입점은 idle 에선 비활성(드롭존 disabled). 모달은
          프로젝트 생성 후 진입 경로로만 열린다 — 여기선 pre-stage 폴백만 유지. */}
      <UploadModal
        open={uploadOpen}
        onClose={() => {
          setUploadOpen(false);
          setPendingFiles(null);
        }}
        projectId={null}
        initialFiles={pendingFiles ?? undefined}
        onUploaded={(id) => {
          setUploadOpen(false);
          setPendingFiles(null);
          onEnter(id);
        }}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Active 본문 (S1 1b–1e) — 컨트롤바(프로젝트 pill + 업로드) 고정 + status 로
// 분기한 본문. 로직(업로드·인덱싱 폴링·abstract 파생·풀뷰 열기)은 그대로.
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
  const { projects } = useInterviewV2Projects();
  const { documents, isLoading, mutate } = useInterviewV2Documents(projectId);
  // 탑라인 상태 + blocks 단일 소스 (격리 채널 — fullview ToplineView 와 이중 구독
  // 금지). GET(읽기 전용)만 부르므로 과금 없음.
  const {
    status: toplineStatus,
    blocks: toplineBlocks,
    mapTotal,
    mapDone,
    generatedAt,
    model,
    outputLang,
    loading: toplineLoading,
  } = useInterviewToplineStatus(projectId);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const hasUpload = useHasInterviewUploadFor(projectId);
  // In-flight batch (not yet settled) — keeps the card in its indexing view so
  // the "N files ready · ALL READY" prompt can't flash a partial count (40)
  // before the upload settles at its true total (61).
  const uploadInFlight = useHasActiveInterviewUploadFor(projectId);
  const toast = useToast();

  const openWithFiles = (files: File[]) => {
    setPendingFiles(files);
    setUploadOpen(true);
  };

  const projectName = useMemo(
    () => projects.find((p) => p.id === projectId)?.name ?? '',
    [projects, projectId],
  );

  // 탑라인 blocks → abstract(제목 + 핵심 요약) 파생. 요약 소스가 없으면 null.
  const abstract = useMemo(
    () => deriveToplineAbstract(toplineBlocks, projectName),
    [toplineBlocks, projectName],
  );

  // generating → done|error 전이에서만 toast (초기 로드/재열람은 무음). projectId
  // 가 바뀌면 새 프로젝트 기준 재추적. (구 ToplineAmbientProgress 의 알림 로직 보존.)
  const prevStatusRef = useRef<ToplineStatus | null>(null);
  useEffect(() => {
    prevStatusRef.current = null;
  }, [projectId]);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = toplineStatus;
    if (prev === 'generating' && toplineStatus === 'done') {
      toast.push(t('toplineDoneToast'), { tone: 'amore' });
    } else if (prev === 'generating' && toplineStatus === 'error') {
      toast.push(t('toplineErrorToast'), { tone: 'warn' });
    }
  }, [toplineStatus, toast, t]);

  // 파생 상태 게이트.
  const canAnalyze = documents.some((d) => d.index_status === 'done');
  const anyProcessing = documents.some(
    (d) => d.index_status === 'indexing' || d.index_status === 'pending',
  );
  const hasReport = toplineBlocks.length > 0;
  const isGenerating = toplineStatus === 'generating';

  // 업로드 진행 중이면 스크롤 상단에 기존 진행 아티팩트를 유지 (§제약4 — 발명 금지,
  // 기존 시각 최소 유지). CD 는 개별 업로드 진행률을 그리지 않았다.
  const uploadProgress = hasUpload ? (
    <InlineUploadProgress projectId={projectId} />
  ) : undefined;

  let modeBody: ReactNode;
  if (isLoading || toplineLoading) {
    // SKELETON — status='none' 순간 깜빡임 방지.
    modeBody = (
      <>
        <CardScroll>
          <Skeleton className="h-6 w-24 rounded-sm" />
          <Skeleton className="h-24 w-full rounded-sm" />
        </CardScroll>
        <CardFooter
          note={t('cardFilesCount', { count: documents.length })}
          cta={<CardFooterCta label={t('cardAnalyze')} trailing="→" disabled />}
        />
      </>
    );
  } else if (documents.length === 0) {
    // 1b empty — 활성 드롭존 + 4단 안내.
    modeBody = (
      <EmptyModeBody
        uploadProgress={uploadProgress}
        dropzone={
          <InterviewDropzone
            title={t('emptyDropTitle')}
            helper={
              <>
                {t('emptyDropHelper')}
                <br />
                <span className="text-mute-soft">{t('emptyDropFormats')}</span>
              </>
            }
            actionLabel={t('emptyDropAction')}
            accept={UPLOAD_ACCEPT}
            maxSizeBytes={UPLOAD_MAX_BYTES}
            onFiles={openWithFiles}
          />
        }
      />
    );
  } else if (abstract) {
    // 1e abstract — 완료 요약.
    modeBody = (
      <AbstractModeBody
        abstract={abstract}
        documents={documents}
        generatedAt={generatedAt}
        model={model}
        outputLang={outputLang}
        blockCount={toplineBlocks.length}
        onOpenFullview={onOpenFullview}
      />
    );
  } else if (isGenerating || anyProcessing || uploadInFlight) {
    // 1c generating — 탑라인 생성 중 · 파일 인덱싱 중 · 업로드 배치 진행 중.
    // uploadInFlight 를 포함해야 DB 에 아직 안 들어온 변환 중 파일 때문에 "전부
    // READY" 프롬프트가 조기 노출(40개)되지 않고 배치 정착(61개)까지 진행 뷰 유지.
    // 밴드는 generating 일 때만.
    modeBody = (
      <GeneratingModeBody
        documents={documents}
        mapTotal={mapTotal}
        mapDone={mapDone}
        blockCount={toplineBlocks.length}
        showBand={isGenerating}
        footerNote={isGenerating ? t('toplineGenerating') : t('indexingInProgress')}
        footerLabel={t('cardAbstractViewAll')}
        footerTrailing="→"
        onFooterCta={onOpenFullview}
        footerDisabled={!canAnalyze}
        uploadProgress={uploadProgress}
      />
    );
  } else if (hasReport) {
    // 보고서는 있으나 요약 파생 불가(표·인용만) — 파일 목록 + "보고서 열기".
    modeBody = (
      <GeneratingModeBody
        documents={documents}
        mapTotal={mapTotal}
        mapDone={mapDone}
        blockCount={toplineBlocks.length}
        showBand={false}
        footerNote={t('reportReadyNote')}
        footerLabel={t('openReport')}
        footerTrailing="⤢"
        onFooterCta={onOpenFullview}
        uploadProgress={uploadProgress}
      />
    );
  } else {
    // 1d analyze-prompt — 파일 준비됨, 보고서 없음.
    modeBody = (
      <AnalyzePromptModeBody
        documents={documents}
        creditCost={CARD_CREDIT_COST}
        canAnalyze={canAnalyze}
        onAnalyze={onOpenFullview}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CardControlBar>
        <ProjectSelectControl
          variant="pill"
          activeProjectId={projectId}
          activeProjectName={projectName}
          onEnter={onEnter}
          onExit={onExit}
        />
        <UploadPill
          label={t('cardUpload')}
          accept={UPLOAD_ACCEPT}
          maxSizeBytes={UPLOAD_MAX_BYTES}
          onFiles={openWithFiles}
        />
      </CardControlBar>

      {modeBody}

      <UploadModal
        open={uploadOpen}
        onClose={() => {
          setUploadOpen(false);
          setPendingFiles(null);
        }}
        projectId={projectId}
        existingFilenames={documents.map((d) => d.filename)}
        initialFiles={pendingFiles ?? undefined}
        onUploaded={() => void mutate()}
      />
    </div>
  );
}

function ExpandedBody() {
  // "전체 보기" → InterviewV2Fullview (공유 FullviewShell slot 으로 portal).
  const { renderInSlot, openFullview, close } = useFullview('interviews');

  // 카드가 들어가 있는 프로젝트. null = idle. SSR 기본 null → 하이드레이션
  // 후 localStorage 값 복원.
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration storage probe
    setActiveProjectId(window.localStorage.getItem(CARD_PROJECT_KEY) || null);
  }, []);

  const enterProject = (id: string) => {
    setActiveProjectId(id);
    window.localStorage.setItem(CARD_PROJECT_KEY, id);
  };
  const exitToIdle = () => {
    setActiveProjectId(null);
    window.localStorage.removeItem(CARD_PROJECT_KEY);
  };

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

      {renderInSlot(
        <InterviewV2Fullview
          onClose={close}
          initialProjectId={activeProjectId}
        />,
      )}
    </div>
  );
}

// 인터뷰 결과 생성기 canvas widget — S1 리디자인(rose 정체성 + 5모드 fresh +
// ambient 밴드). 헤더밴드/툴바/프레임은 WidgetShell 소유(무변경), 본문만 교체.
// accent = rose (peach 는 AI UT 로 복귀 — TOKEN-DECISIONS §E).
// fullviewV2 = 공유 <FullviewShell> 수렴(pr-iv-fullview-shell-read §0.1).
export const interviewsCard: WidgetContent = {
  key: 'interviews',
  meta: {
    label: '인터뷰 결과 생성기',
    accent: 'rose',
    cost: CARD_CREDIT_COST,
    thumbnail: '/thumbnail/analysis.png',
    description:
      '여러 인터뷰 파일을 프로젝트에 올리고, 코퍼스에 자연어로 질문해 근거 인용과 함께 답을 받습니다.',
    expandedCols: 3,
    // Canvas 1c 카드 프레임 opt-in — desk·moderator-ai·probing·quotes·recruiting·
    // translate 와 동일 공유 셸(파스텔 rose 헤더밴드 + 통합 툴바 💎10). 이 플래그가
    // 없으면 구형 banner-top chrome(140px) 로 폴백 → accent 미소비(행 위치 색으로
    // 폴백)라 rose 정체성이 카드에 안 보였다. S1 5모드 본문은 이미 cardFrame 규약
    // (CardScroll flex-1 스크롤 host + CardFooter shrink-0 pinned)에 맞춰 지어졌다.
    cardFrame: true,
    // 풀뷰 V2 — 구형 WidgetFullviewPanel 폐기, 공유 FullviewShell 로 렌더
    // (프레임+240px 사이드바+§F3 헤더 스캐폴드, 헤더밴드 톤 = accent rose).
    fullviewV2: true,
    fullviewFootnoteKey: 'InterviewsV2.fullviewSidebarNote',
  },
  state: 'idle',
  ExpandedBody,
};

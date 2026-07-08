'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { WidgetContent } from '../widget-types';
import { useFullview } from '../shell/fullview-shell-context';
import { WidgetPrimaryCta } from '@/components/canvas/shell/widget-primary-cta';
import { ControlBoardPanel } from '@/components/canvas/shell/control-board-panel';
import { Field } from '@/components/canvas/shell/field';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ChromeButton } from '@/components/ui/chrome-button';
import { ControlTrigger } from '@/components/ui/control-trigger';
import { FileDropZone, FILE_DROP_ZONE_PY } from '@/components/ui/file-drop-zone';
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
import { useInterviewToplineStatus } from '@/hooks/use-interview-topline';
import { deriveToplineAbstract } from '@/lib/interview-v2/topline-abstract';
import type { ToplineStatus } from '@/lib/interview-v2/types';
import { ToplineMapProgress } from '@/components/interviews-v2/topline-view';
import { useToast } from '@/components/toast-provider';
import { CreateProjectModal } from '@/components/interviews-v2/create-project-modal';
import { UploadModal } from '@/components/interviews-v2/upload-modal';
import { InterviewV2Fullview } from '@/components/interviews-v2/interview-v2-fullview';
import { track as trackEvent } from '@/lib/analytics/events';

// 카드가 "안에 들어가 있는" V2 프로젝트 id. null = idle 컨트롤 보드.
// localStorage 로 persist — 새로고침해도 카드가 같은 프로젝트의 active
// 뷰로 복귀 (프로젝트 자체는 DB-backed 이므로 id 만 기억).
const CARD_PROJECT_KEY = 'interview-v2-card-active-project';

// 인라인 dropzone accept/최대 크기 — UploadModal 과 동일 규격 (SSOT 는 모달이
// 최종 검증하지만, 카드 dropzone 도 같은 필터/한도를 걸어 UX 를 맞춘다).
const UPLOAD_ACCEPT =
  '.txt,.md,.markdown,.csv,.json,.log,.doc,.docx,.pdf,audio/*,video/*';
const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

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
          // 전사록 언어 트리거와 동일 primitive(ControlTrigger) — 컨트롤
          // 드롭다운 트리거 height/패딩/타이포를 6 위젯에서 픽셀 정합.
          // 공용 chevron(▼)은 ControlTrigger 가 소유하므로 rightIcon 제거.
          // ⚙ 어포던스는 라벨 앞 글리프로 보존 (content 무변경).
          <ControlTrigger
            {...aria}
            data-open={open}
            onClick={onClick}
            disabled={isLoading}
            className="min-w-0"
          >
            <span aria-hidden className="mr-1.5">
              ⚙
            </span>
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
          </ControlTrigger>
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
  // 카드 인라인 dropzone 이 드롭/선택한 파일 — 모달을 열며 pre-stage 로 넘긴다.
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);

  const openWithFiles = (files: File[]) => {
    setPendingFiles(files);
    setUploadOpen(true);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* idle 컨트롤 (전사록 동형): 짧은 "프로젝트" Field 라벨 + 인라인
          dropzone + 하단 "분석 시작" CTA. ControlBoardPanel SSOT
          (wrapper/폭/정렬/간격/gap). 설명 문장형 헤더 금지 — 컨트롤 상단은
          라벨만 (전사록 <Field label="언어"> 미러). 업로드 안내는 dropzone
          카피(label/helperText)로 흡수. */}
      <ControlBoardPanel gap="field">
        <Field label={t('cardProjectLabel')}>
          <ProjectSelectControl
            activeProjectId={null}
            activeProjectName={null}
            onEnter={onEnter}
            onExit={() => {}}
          />
        </Field>
        {/* 인라인 업로드 — 옛 📤 업로드 CTA(모달 진입)를 대체 (전사록 미러).
            드래그드롭 + 클릭 업로드. 프로젝트 미선택이라 모달이 프로젝트 설정
            gate(Step 2)를 강제하고, 완료 시 해당 프로젝트로 active 진입. */}
        <FileDropZone
          accept={UPLOAD_ACCEPT}
          multiple
          maxSizeBytes={UPLOAD_MAX_BYTES}
          onFiles={openWithFiles}
          label={t('uploadDropLabel')}
          helperText={t('uploadDropHelper')}
          className={`w-full ${FILE_DROP_ZONE_PY}`}
        />
      </ControlBoardPanel>

      {/* 주 CTA "분석 시작" — 바디 최하단 고정 액션 바 (6 위젯 통일). idle 은
          아직 진입한 프로젝트가 없어 비활성 (파일을 올려 프로젝트에 진입하면
          active 에서 인덱싱 완료 후 활성화 → fullview). */}
      <WidgetPrimaryCta label={t('cardAnalyze')} onClick={() => {}} disabled />

      {/* 프로젝트 미선택 업로드 → 모달이 Step 2(프로젝트 설정)를 강제,
          완료 시 해당 프로젝트로 즉시 active 진입. dropzone 이 드롭한 파일은
          initialFiles 로 pre-stage. */}
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
// 팝업 밖 ambient 탑라인 진행률 (card #434). 탑라인 생성은 오래 걸리는데
// realtime 구독이 fullview(팝업) 안에 있어, 팝업을 닫으면 진행률이 사라져
// "멈춘 것처럼" 보였다. 백엔드는 after()+DB 로 이미 계속 도는데 화면만 침묵.
// 여기서는 항상 마운트되는 카드 본문에서 경량 read-only 구독을 유지해:
//  - status='generating' 이면 N/M 진행률(ToplineMapProgress 재사용) 상시 노출
//  - generating→done / →error 전이 시 toast 로 완료/실패를 알림
// 팝업이 열려 fullview 자체 구독과 동시에 살아도 별도 채널명이라 충돌 없음.
// ────────────────────────────────────────────────────────────────────
function ToplineAmbientProgress({
  projectId,
  status,
  mapTotal,
  mapDone,
}: {
  projectId: string;
  status: ToplineStatus;
  mapTotal: number | null;
  mapDone: number | null;
}) {
  const t = useTranslations('InterviewsV2');
  const toast = useToast();

  // status/map 진행률은 ActiveBody 가 useInterviewToplineStatus 로 단일 구독해 prop
  // 으로 내려준다 (abstract 파생과 progress 가 같은 소스를 공유 — 이중 구독 제거).

  // generating → done|error 전이에서만 toast. 초기 로드(null→done/none)나
  // 이미 완료된 보고서를 다시 열 때는 무음(오탐 방지). projectId 가 바뀌면
  // 새 프로젝트 기준으로 다시 추적.
  const prevStatusRef = useRef<ToplineStatus | null>(null);
  useEffect(() => {
    prevStatusRef.current = null;
  }, [projectId]);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev === 'generating' && status === 'done') {
      toast.push(t('toplineDoneToast'), { tone: 'amore' });
    } else if (prev === 'generating' && status === 'error') {
      toast.push(t('toplineErrorToast'), { tone: 'warn' });
    }
  }, [status, toast, t]);

  if (status !== 'generating') return null;
  return (
    <div className="shrink-0 border-t border-line-soft px-4 py-3">
      <div className="mb-1.5 flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-amore">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
        {t('toplineGenerating')}
      </div>
      <ToplineMapProgress mapTotal={mapTotal} mapDone={mapDone} />
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
  // 탑라인 상태 + blocks 단일 소스 — 프로젝트 선택 시 하단 영역을 status 로 분기
  // (done=abstract / generating=진행률 / 미생성=분석 프롬프트). GET(읽기 전용)만
  // 부르므로 과금 없음. blocks 는 abstract 파생, status/map 진행률은 ambient 밴드로.
  // ⚠️ 반드시 useInterviewToplineStatus(격리 채널 interview-topline-status-*)를 쓴다 —
  // useInterviewTopline 을 쓰면 팝업(fullview)의 ToplineView 와 같은 채널명으로
  // 이중 구독돼 Supabase realtime 이 크래시한다(동일 토픽 재구독 금지).
  const {
    status: toplineStatus,
    blocks: toplineBlocks,
    mapTotal,
    mapDone,
    loading: toplineLoading,
  } = useInterviewToplineStatus(projectId);
  const [uploadOpen, setUploadOpen] = useState(false);
  // 카드 인라인 dropzone 이 드롭/선택한 파일 — 모달을 열며 pre-stage 로 넘긴다.
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);

  const openWithFiles = (files: File[]) => {
    setPendingFiles(files);
    setUploadOpen(true);
  };

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

  // 탑라인 blocks → abstract(제목 + 핵심 요약 2~4문장) 파생. 요약 소스가 없으면
  // null → 파일 리스트 폴백(빈 blocks / quote·table 만 있는 보고서 방어).
  const abstract = useMemo(
    () => deriveToplineAbstract(toplineBlocks, projectName),
    [toplineBlocks, projectName],
  );

  // "분석 시작" 은 인덱싱이 최소 1건 완료된 뒤에만 활성 (인덱싱 중/미업로드
  // 상태에서 빈 검색 fullview 로 들어가지 않도록).
  const canAnalyze = documents.some((d) => d.index_status === 'done');

  // 파일 요약 조각(인덱싱 타임라인 + 파일명 chip) — done abstract 의 접기 토글
  // 안, generating 본문, 분석 전 프롬프트 아래에서 공용으로 재사용. count 헤더는
  // 바깥에서(토글 라벨 vs. countHeader) 별도로 붙인다.
  const indexingDocs = documents.filter((d) => d.index_status === 'indexing');
  const restDocs = documents.filter((d) => d.index_status !== 'indexing');
  const fileChips = (
    <div className="space-y-2">
      {/* 인덱싱 중인 파일 — chunk 단위 progress bar + "N/M". */}
      {indexingDocs.map((d) => (
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
          <ProcessTimeline phases={docTimelinePhases(d)} padding="py-1" />
        </div>
      ))}

      {/* 나머지 파일 (완료 / 대기 / 오류) — 파일명 chip 요약. */}
      {restDocs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {restDocs.map((d) => (
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
  );

  // 파일 개수 헤더(캡션) — generating/미생성 본문에서 파일 목록 위에 붙는다.
  const filesCountHeader = (
    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mute-soft">
      {t('cardFilesCount', { count: documents.length })}
    </div>
  );

  // "파일 N개 ▸" 접기 토글 — abstract/프롬프트 모드에서 파일 목록을 숨기되
  // 접근성은 보존(사용자 결정 1 — 파일은 제거가 아니라 이동/토글). native
  // <details>/<summary> 는 forbid-elements(button/input/textarea) 밖이라 허용.
  const filesToggle = (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-mute-soft [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden
          className="inline-block transition-transform duration-[var(--dur-fast)] group-open:rotate-90"
        >
          ▸
        </span>
        {t('cardFilesCount', { count: documents.length })}
      </summary>
      <div className="mt-2">{fileChips}</div>
    </details>
  );

  // 프로젝트 선택 시 하단 영역 — 탑라인 "보고서 존재" 여부로 분기. fullview 의
  // ToplineView 는 status 가 아니라 hasBlocks(blocks.length>0)로 보고서를 렌더하므로,
  // 카드도 같은 기준을 써야 한다 — 안 그러면 status 가 idle/stale 이지만 보고서가
  // 있는 프로젝트에서 fullview 는 보고서를, 카드는 "분석 전" 프롬프트를 띄우는
  // 불일치가 난다. 그래서 abstract(=blocks 파생) 유무를 우선 게이트로 쓴다.
  const hasReport = toplineBlocks.length > 0;
  let projectBody: ReactNode;
  if (isLoading || toplineLoading) {
    projectBody = (
      <div className="flex gap-2">
        <Skeleton className="h-6 w-24 rounded-sm" />
        <Skeleton className="h-6 w-20 rounded-sm" />
      </div>
    );
  } else if (documents.length === 0) {
    // 파일 자체가 없는 프로젝트 — 업로드 안내(회귀 없음).
    projectBody = (
      <EmptyState
        tone="subtle"
        title={t('noFilesTitle')}
        description={t('noFilesDescription')}
      />
    );
  } else if (abstract) {
    // B. 보고서 존재(blocks) → 핵심 요약 abstract(제목 + 요약 + 수치 + 전체 보기).
    // status 가 done/idle/stale 이든 보고서가 있으면 요약을 보여준다(fullview 정합).
    // 재생성 중(generating)이라도 이전 blocks 로 요약을 유지하고, 진행률은 하단
    // ambient 밴드가 표시.
    projectBody = (
      <div className="space-y-4">
        <div className="space-y-2">
          <h3 className="line-clamp-2 text-md font-semibold leading-snug text-ink">
            {abstract.title}
          </h3>
          <p className="line-clamp-5 whitespace-pre-wrap text-md leading-[1.7] text-ink-2">
            {abstract.summary}
          </p>
          {/* 핵심 포인트 3~5 — executive_summary 블록이 있을 때만(신버전 보고서).
              구버전 파생 fallback 은 keyPoints 가 비어 렌더 생략. 카드 공간 방어로
              최대 4개만 노출(전체는 전체 보기). */}
          {abstract.keyPoints.length > 0 && (
            <ul className="space-y-1 pt-0.5">
              {abstract.keyPoints.slice(0, 4).map((point, i) => (
                <li
                  key={i}
                  className="flex gap-1.5 text-xs-soft leading-[1.6] text-mute"
                >
                  <span aria-hidden className="text-amore">
                    ·
                  </span>
                  <span className="line-clamp-2">{point}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <span className="rounded-sm border border-line-soft bg-paper px-2 py-0.5 text-xs text-mute">
              {t('cardAbstractDocsMetric', { count: documents.length })}
            </span>
            <ChromeButton
              size="sm"
              variant="mute"
              onClick={onOpenFullview}
              rightIcon={<span aria-hidden>→</span>}
            >
              {t('cardAbstractViewAll')}
            </ChromeButton>
          </div>
        </div>
        {filesToggle}
      </div>
    );
  } else if (hasReport || toplineStatus === 'generating') {
    // C. 보고서는 있으나 요약 파생 불가(표·인용만) OR 최초 생성 중 — 파일 목록을
    // 보여준다. "분석 전" 프롬프트는 fullview 가 보고서를 렌더하거나 곧 렌더하므로
    // 부정확 → 여기서 배제. 생성 진행률은 하단 ambient 밴드(#434)가 표시.
    projectBody = (
      <div className="space-y-2">
        {filesCountHeader}
        {fileChips}
      </div>
    );
  } else {
    // D. 보고서 없음(none/idle/error & blocks 없음) & 생성 중 아님 → "분석 시작"
    // 프롬프트(하단 CTA 로 유도) + 파일 토글.
    projectBody = (
      <div className="space-y-3">
        <div className="rounded-sm border border-line-soft bg-paper-soft px-3 py-3">
          <div className="text-sm font-semibold text-ink-2">
            {t('cardAnalyzePromptTitle')}
          </div>
          <p className="mt-1 text-xs-soft leading-[1.6] text-mute">
            {t('cardAnalyzePromptHint')}
          </p>
        </div>
        {filesToggle}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 컨트롤 패널 — 상단 고정 (데스크 active 패턴). 여백은 ControlBoardPanel
          active 상수 SSOT 경유 (직접 px-5 py-5 지정 제거 — 6 위젯 여백 정합).
          컨트롤 헤더 = 짧은 "프로젝트" Field 라벨 (전사록 미러, 설명 문장 금지).
          옛 우측 상단 📤 업로드 버튼은 인라인 dropzone 이 대체. 주 CTA(분석
          시작)는 하단 앵커. */}
      <ControlBoardPanel active gap="field">
        <Field label={t('cardProjectLabel')}>
          <ProjectSelectControl
            activeProjectId={projectId}
            activeProjectName={projectName}
            onEnter={onEnter}
            onExit={onExit}
          />
        </Field>
        {/* 인라인 업로드 — 프로젝트가 이미 정해졌으므로 모달이 Step 2 를
            건너뛰고 바로 업로드+인덱싱 (dropzone 이 드롭한 파일 = initialFiles). */}
        <FileDropZone
          accept={UPLOAD_ACCEPT}
          multiple
          maxSizeBytes={UPLOAD_MAX_BYTES}
          onFiles={openWithFiles}
          label={t('uploadDropLabel')}
          helperText={t('uploadDropHelper')}
          className={`w-full ${FILE_DROP_ZONE_PY}`}
        />
      </ControlBoardPanel>

      {/* 프로젝트 선택 시 하단 영역 — 탑라인 status 로 분기(위 projectBody):
          done=핵심 요약 abstract / generating=파일 목록(+아래 진행률 밴드) /
          미생성=분석 프롬프트. 파일 목록은 abstract·프롬프트 모드에서 "파일 N개 ▸"
          토글로 접근 보존(사용자 결정 1). 상세/검색은 전체 보기(fullview). */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {projectBody}
      </div>

      {/* 팝업 밖 ambient 탑라인 진행률 — 전체보기를 닫아도 생성 진행률이
          카드에 계속 보이고, 완료/실패 시 toast 로 알림 (card #434). CTA
          바로 위, shrink-0 밴드라 파일 리스트 스크롤과 무관하게 상시 노출.
          status/map 진행률은 위 useInterviewToplineStatus 단일 소스에서 내려온다. */}
      <ToplineAmbientProgress
        projectId={projectId}
        status={toplineStatus}
        mapTotal={mapTotal}
        mapDone={mapDone}
      />

      {/* 주 CTA(분석 시작) — 바디 최하단 고정 액션 바 (6 위젯 통일) → fullview.
          인덱싱 완료(≥1 done) 후 활성. 파일 리스트가 위 flex-1 영역에서
          스크롤 → CTA 와 겹침 0. */}
      <WidgetPrimaryCta
        label={t('cardAnalyze')}
        onClick={onOpenFullview}
        disabled={!canAnalyze}
      />

      <UploadModal
        open={uploadOpen}
        onClose={() => {
          setUploadOpen(false);
          setPendingFiles(null);
        }}
        projectId={projectId}
        initialFiles={pendingFiles ?? undefined}
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

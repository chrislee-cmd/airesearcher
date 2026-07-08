'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ChromeButton } from '@/components/ui/chrome-button';
import { IconButton } from '@/components/ui/icon-button';
import { Tabs, type TabItem } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';
import { useInterviewV2Documents } from '@/hooks/use-interview-v2-documents';
import { useSequentialSweep } from '@/hooks/use-sequential-sweep';
import { SearchChat } from './search-chat';
import { ToplineView } from './topline-view';
import { FileCard } from './file-card';
import { UploadModal } from './upload-modal';

// 우측 패널 2탭 — 탑라인 보고서(default) / 자유 검색. 사용자 결정 #1.
type RightTab = 'topline' | 'search';

// 인라인 feather 아이콘 — 프로젝트 아이콘 컨벤션(라이브러리 미도입, 24×24
// stroke-currentColor SVG. widget-upload-button / select 와 동일). 이모지
// 글리프(◀▶📤)를 걷어내고 chrome 아이콘 컴포넌트로 통일한다.
function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

// feather "search" — 돋보기. readSweep 진행 표시의 🔍 이모지 대체.
function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

// feather "upload" — 트레이 위로 화살표. widget-upload-button 과 동일 path.
function UploadIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

// Collapse choice for the left file-list panel — persisted so the wider
// chat area a user opened stays open across refresh / navigation.
const FILE_PANEL_COLLAPSED_KEY = 'interview-v2-file-panel-collapsed';

// Interview V2 — project detail view (file grid + search chat). 📤 업로드는
// 파일 리스트 패널 헤더에 있고, 검색은 우측 60% 의 ChatGPT-style search chat
// (pr-interview-v2-search-ui-chat) 이 상시 담당한다.

export function ProjectDetail({
  projectId,
  onBack,
}: {
  projectId: string;
  onBack: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  const { projects } = useInterviewV2Projects();
  const { documents, isLoading, mutate } = useInterviewV2Documents(projectId);
  const [uploadOpen, setUploadOpen] = useState(false);
  // Left panel collapse. SSR default = expanded so server/client markup
  // match; the stored choice is restored post-hydration and written on
  // every toggle. Mirrors the localStorage-after-hydration pattern in
  // use-consent.ts.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration storage probe; use-consent.ts uses the same pattern
    setCollapsed(
      window.localStorage.getItem(FILE_PANEL_COLLAPSED_KEY) === '1',
    );
  }, []);
  const setPanelCollapsed = (next: boolean) => {
    setCollapsed(next);
    window.localStorage.setItem(FILE_PANEL_COLLAPSED_KEY, next ? '1' : '0');
  };
  // Bumped on every search submit; drives the file "reading" sweep — each
  // uploaded file lights up 읽는 중 → 읽음 once, showing the search scans every
  // file evenly (no single-file bias).
  const [searchRunId, setSearchRunId] = useState(0);
  const readSweep = useSequentialSweep(searchRunId, documents.length);
  // 우측 탭 — 탑라인이 default (열자마자 보고서). 검색으로 전환해도 SearchChat
  // 은 언마운트하지 않고 hidden 으로 두어 대화/스크롤이 유지된다 (회귀 0).
  const [rightTab, setRightTab] = useState<RightTab>('topline');

  const projectName = useMemo(
    () => projects.find((p) => p.id === projectId)?.name ?? '',
    [projects, projectId],
  );

  const rightTabs = useMemo<TabItem<RightTab>[]>(
    () => [
      { value: 'topline', label: t('toplineTab') },
      { value: 'search', label: t('searchTab') },
    ],
    [t],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 서브헤더 — 좌: 뒤로 + 프로젝트명. 📤 업로드는 파일 리스트 패널
          헤더로 이동 (아래); 검색은 우측 패널 상시 노출. */}
      <div className="flex shrink-0 items-center gap-3 border-b border-line-soft px-6 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            ← {t('back')}
          </Button>
          {projectName && (
            <span className="truncate text-md font-semibold text-ink-2">
              {projectName}
            </span>
          )}
        </div>
      </div>

      {/* 본문 — 좌(파일 list, collapsible) + 우(검색 chat). 접힘 시 좌측은
          40px rail 만 남고 우측 chat 이 확장된다. */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {collapsed ? (
          <div className="flex w-full shrink-0 items-center justify-center border-b border-line-soft py-3 lg:w-10 lg:items-start lg:border-b-0 lg:border-r lg:py-4">
            <IconButton
              variant="ghost"
              size="sm"
              aria-label="파일 패널 펼치기"
              onClick={() => setPanelCollapsed(false)}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </IconButton>
          </div>
        ) : (
        <aside className="flex min-h-0 w-full flex-col border-b border-line-soft lg:shrink-0 lg:basis-5/12 lg:border-b-0 lg:border-r">
          {/* 헤더 — 좌: 접기 + "업로드된 파일" 타이틀, 우: 파일 업로드 버튼
              (옛 서브헤더 📤 업로드를 여기로 통합). */}
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line-soft px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <IconButton
                variant="ghost"
                size="sm"
                aria-label="파일 패널 접기"
                onClick={() => setPanelCollapsed(true)}
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </IconButton>
              <h3 className="truncate text-md font-semibold text-ink">
                {t('filesTitle')}
              </h3>
            </div>
            <ChromeButton
              variant="default"
              size="sm"
              onClick={() => setUploadOpen(true)}
              leftIcon={<UploadIcon className="h-3.5 w-3.5" />}
            >
              {t('upload')}
            </ChromeButton>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {isLoading ? (
            <div className="grid grid-cols-5 gap-3">
              <Skeleton className="h-16 rounded-sm" />
              <Skeleton className="h-16 rounded-sm" />
              <Skeleton className="h-16 rounded-sm" />
            </div>
          ) : documents.length === 0 ? (
            <EmptyState
              tone="subtle"
              title={t('noFilesTitle')}
              description={t('noFilesDescription')}
            />
          ) : (
            <>
              {/* 검색 시 모든 파일을 순차로 훑는 진행 표시 — "특정 파일 치중 없음". */}
              {readSweep.started && (
                <div
                  className="mb-3 flex items-center gap-1.5 text-xs"
                  aria-live="polite"
                >
                  <SearchIcon
                    className={`h-3.5 w-3.5 ${readSweep.running ? 'text-amore' : 'text-mute'}`}
                  />
                  <span className={readSweep.running ? 'text-amore' : 'text-mute'}>
                    {readSweep.running
                      ? `모든 파일을 읽는 중… (${Math.min(readSweep.count, readSweep.total)}/${readSweep.total})`
                      : `모든 파일을 고르게 읽었습니다 · ${readSweep.total}개`}
                  </span>
                </div>
              )}
              {/* 파일 그리드 — 가로 5칸 고정 · 세로 무한 · 5행 초과 시 위 스크롤
                  영역이 세로 스크롤. 카드는 최소 정보(파일명 + 상태)만, 상세는
                  클릭 popover. */}
              <div className="stagger grid grid-cols-5 gap-3">
                {documents.map((d, i) => {
                  const reading =
                    readSweep.started && readSweep.running && i === readSweep.count;
                  const readDone = readSweep.started && i < readSweep.count;
                  return (
                    <FileCard
                      key={d.id}
                      file={d}
                      reading={reading}
                      readDone={readDone}
                    />
                  );
                })}
              </div>
            </>
          )}
          </div>
        </aside>
        )}
        <section className="flex min-h-0 flex-1 flex-col lg:min-w-0">
          {/* 탭 헤더 — 탑라인(default) / 자유 검색. 이모지(📋/🔍) 제거하고
              에디토리얼 underline 탭(텍스트만)으로. Tabs primitive 가 활성
              amore underline / 비활성 mute 를 토큰으로 소유 (!important 없음). */}
          <div className="flex shrink-0 items-center border-b border-line-soft px-6">
            <Tabs
              aria-label={t('filesTitle')}
              value={rightTab}
              onValueChange={setRightTab}
              items={rightTabs}
            />
          </div>

          {/* 두 탭 모두 상시 mount — 비활성 탭은 hidden (SearchChat 대화·
              ToplineView 로드 상태를 탭 전환 간에 보존). */}
          <div className="relative min-h-0 flex-1">
            <div
              className={`absolute inset-0 ${rightTab === 'topline' ? '' : 'hidden'}`}
            >
              <ToplineView projectId={projectId} />
            </div>
            <div
              className={`absolute inset-0 ${rightTab === 'search' ? '' : 'hidden'}`}
            >
              <SearchChat
                projectIds={null}
                currentProject={{ id: projectId, name: projectName }}
                onSearchStart={() => setSearchRunId((n) => n + 1)}
              />
            </div>
          </div>
        </section>
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

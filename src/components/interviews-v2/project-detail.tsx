'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';
import {
  useInterviewV2Documents,
  type InterviewDocumentStatus,
} from '@/hooks/use-interview-v2-documents';
import { SearchChat } from './search-chat';
import { TrustDetailPanel } from './trust-detail-panel';
import { UploadModal } from './upload-modal';

// Interview V2 — project detail view (file list + search chat). The ⚙ 설정 /
// 📤 업로드 controls in the subheader are wired by the upload spec (disabled
// placeholders for now); the right-hand 60% is the ChatGPT-style search chat
// (pr-interview-v2-search-ui-chat).

function StatusPill({ status }: { status: InterviewDocumentStatus }) {
  const t = useTranslations('InterviewsV2');
  const map: Record<InterviewDocumentStatus, { key: string; cls: string }> = {
    pending: { key: 'statusPending', cls: 'text-mute-soft' },
    indexing: { key: 'statusIndexing', cls: 'text-amore' },
    done: { key: 'statusDone', cls: 'text-mute' },
    error: { key: 'statusError', cls: 'text-warning' },
  };
  const p = map[status];
  return (
    <span
      className={`shrink-0 text-xs font-semibold uppercase tracking-[0.18em] ${p.cls}`}
    >
      {t(p.key)}
    </span>
  );
}

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
  // Bumped on every search submit; drives the trust panel's safeguard sweep.
  const [searchRunId, setSearchRunId] = useState(0);

  const projectName = useMemo(
    () => projects.find((p) => p.id === projectId)?.name ?? '',
    [projects, projectId],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 서브헤더 — 좌: 뒤로 + 설정/업로드. 📤 업로드는 UploadModal wire 완료;
          ⚙ 설정 / 🔍 검색은 아직 placeholder disabled (검색은 우측 패널 상시 노출). */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line-soft px-6 py-3">
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
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" disabled>
            ⚙ {t('settings')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setUploadOpen(true)}
          >
            📤 {t('upload')}
          </Button>
          <Button variant="ghost" size="sm" disabled>
            🔍 {t('search')}
          </Button>
        </div>
      </div>

      {/* 본문 — 좌(파일 list) 5/12 + 우(검색 chat) 7/12. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-12">
        <aside className="min-h-0 overflow-y-auto border-b border-line-soft px-6 py-5 lg:col-span-5 lg:border-b-0 lg:border-r">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 rounded-sm" />
              <Skeleton className="h-12 rounded-sm" />
            </div>
          ) : documents.length === 0 ? (
            <EmptyState
              tone="subtle"
              title={t('noFilesTitle')}
              description={t('noFilesDescription')}
            />
          ) : (
            <ul className="rounded-sm border border-line bg-paper">
              {documents.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center gap-3 border-t border-line-soft px-4 py-3 first:border-t-0"
                >
                  <span className="min-w-0 flex-1 truncate text-md text-ink-2">
                    {d.filename}
                  </span>
                  <StatusPill status={d.index_status} />
                </li>
              ))}
            </ul>
          )}

          {/* 신뢰도 (trust) panel — 파일 리스트 아래, default 접힘. -mx-6 로
              aside 좌우 패딩을 상쇄해 divider/hover 배경이 폭 전체를 채운다. */}
          <div className="-mx-6 mt-5">
            <TrustDetailPanel projectId={projectId} searchRunId={searchRunId} />
          </div>
        </aside>
        <section className="min-h-0 lg:col-span-7">
          <SearchChat
            projectIds={null}
            currentProject={{ id: projectId, name: projectName }}
            onSearchStart={() => setSearchRunId((n) => n + 1)}
          />
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

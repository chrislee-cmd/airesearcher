'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import { LibraryClient } from './library-client';
import { LibraryTabs, type LibraryTab } from './library-tabs';
import { ShareScopeToggle } from '@/components/share/dashboard/share-scope-toggle';
import { ShareDashboardContainer } from '@/components/share/dashboard/share-dashboard-container';
import type { ShareScope } from '@/components/share/dashboard/types';

const OUTFIT = { fontFamily: 'var(--font-outfit), var(--font-sans)' } as const;

// /library 표면 루트 — 외곽 프레임 + 공용 제목 + 탭바(공유 chrome)를 소유하고
// 활성 탭 본문을 깐다. v1 탭 = 「산출물 · 공유」. 라우팅 = `?tab=shares`(딥링크).
//
// 공유 탭 헤더(스코프는 헤더, 상태는 툴바 — §0.5): admin/owner(canViewOrgScope)
// 에게만 스코프 토글을 렌더한다. canViewOrgScope 는 공유 컨테이너의 fetch 가
// onMeta 로 되돌린다. 프로젝트 스코프 pill 은 v1 표시 전용(공유 목록의 프로젝트
// 필터 API 부재 — §4 인터랙션 미배선, 보수적 해석).

export function LibrarySurface({
  projects,
  hasOrg,
}: {
  projects: { id: string; name: string }[];
  hasOrg: boolean;
}) {
  const tl = useTranslations('Library');
  const t = useTranslations('ShareDashboard');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tab = searchParams.get('tab') === 'shares' ? 'shares' : 'artifacts';

  // 스코프는 헤더 소유(토글 + 본문 필터 공유). canViewOrgScope 는 fetch 후 확정.
  const [scope, setScope] = useState<ShareScope>('mine');
  const [canViewOrgScope, setCanViewOrgScope] = useState(false);

  function selectTab(key: string) {
    router.replace(
      key === 'shares' ? { pathname, query: { tab: 'shares' } } : { pathname },
    );
  }

  const tabs: LibraryTab[] = [
    { key: 'artifacts', label: t('tabs.artifacts') },
    { key: 'shares', label: t('tabs.shares'), icon: 'link' },
  ];

  return (
    <div className="flex h-full min-h-[640px] w-full flex-col overflow-hidden rounded-panel-lg border-[3px] border-ink bg-surface-canvas shadow-frame">
      <div className="shrink-0 border-b-[3px] border-ink bg-paper">
        <div className="flex items-center gap-3 px-6 pt-3.5">
          <span className="text-3xl font-extrabold tracking-tight text-ink" style={OUTFIT}>
            {tl('title')}
          </span>
          <div className="flex-1" />
          {tab === 'shares' && (
            <>
              {canViewOrgScope && (
                <ShareScopeToggle
                  scope={scope}
                  onScope={setScope}
                  labels={{ mine: t('scope.mine'), org: t('scope.org') }}
                />
              )}
              <span className="inline-flex shrink-0 items-center gap-[7px] rounded-pill border-[1.5px] border-ink bg-paper px-[13px] py-1.5 text-md font-bold text-ink shadow-memphis-sm-faint">
                <DuotoneIcon name="project" size={15} fill="var(--color-rose)" />
                {t('scope.projectAll')}
                <span className="text-xs" aria-hidden>
                  ▼
                </span>
              </span>
            </>
          )}
        </div>
        <LibraryTabs tabs={tabs} active={tab} onSelect={selectTab} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {tab === 'artifacts' ? (
          <LibraryClient projects={projects} hasOrg={hasOrg} />
        ) : (
          <ShareDashboardContainer
            scope={scope}
            onMeta={setCanViewOrgScope}
            onOpenArtifacts={() => selectTab('artifacts')}
          />
        )}
      </div>
    </div>
  );
}

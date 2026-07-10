'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { ChapterHeader } from '@/components/editorial';
import { CanvasUsages } from './canvas-usages';
import { RecentlyChanged } from './recently-changed';
import { DesignSystemSidebar } from './sidebar';
import {
  DEFAULT_SECTION_ID,
  RECENTLY_CHANGED_ID,
  SECTION_INDEX,
  isSectionId,
  type ViewId,
} from './sections';

function readHash(): ViewId {
  const raw = window.location.hash.replace(/^#/, '');
  if (raw === RECENTLY_CHANGED_ID) return RECENTLY_CHANGED_ID;
  return raw && isSectionId(raw) ? raw : DEFAULT_SECTION_ID;
}

function subscribeToHash(callback: () => void) {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

export function DesignSystemCatalog() {
  const activeId = useSyncExternalStore<ViewId>(
    subscribeToHash,
    readHash,
    () => DEFAULT_SECTION_ID,
  );

  const handleSelect = useCallback((id: ViewId) => {
    if (window.location.hash.replace(/^#/, '') === id) return;
    window.history.pushState(null, '', `#${id}`);
    // pushState doesn't fire hashchange — synthesize so useSyncExternalStore
    // subscribers (this component) re-read.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  const isRecentlyChanged = activeId === RECENTLY_CHANGED_ID;

  return (
    <div className="mx-auto max-w-[1280px] px-2 pb-16 pt-6">
      <ChapterHeader
        title="Design System"
        description="현재 코드베이스에 정의된 모든 디자인 토큰과 표준 부품의 카탈로그. 좌측 사이드바에서 항목을 골라 한 번에 하나씩 살펴봅니다. URL hash 로 직링크 공유 가능. 이 페이지는 super admin 만 접근 가능합니다."
      />
      <div className="flex gap-8">
        <DesignSystemSidebar activeId={activeId} onSelect={handleSelect} />
        <main className="min-w-0 flex-1">
          {isRecentlyChanged ? (
            <RecentlyChanged />
          ) : (
            <>
              {SECTION_INDEX[activeId].render()}
              <CanvasUsages id={activeId} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

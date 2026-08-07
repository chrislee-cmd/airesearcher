import type { ReactNode } from 'react';

// 산출물 탭 본문 셸 — 이제 **chromeless**. 외곽 프레임(3px ink · radius 16 ·
// shadow-frame · surface-canvas)과 공용 제목 "라이브러리" + 탭바는 상위
// LibrarySurface 가 소유하고(탭 공용), 여기서는 산출물 탭 고유의 툴바
// (검색+정렬+뷰토글, 탭바 아래로 정합)와 body(rail | 리스트)만 깐다. 산출물 탭의
// 기존 동작(검색·정렬·뷰·rail·리스트)은 그대로 — 회귀 0.

export function LibraryShell({
  count,
  search,
  sort,
  view,
  rail,
  children,
}: {
  count: number;
  search: ReactNode;
  sort: ReactNode;
  view: ReactNode;
  rail: ReactNode;
  children: ReactNode; // the list/grid column (owns its own scroll + footer)
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b-2 border-ink bg-paper px-6 py-3">
        <span className="shrink-0 font-mono-label text-md font-bold text-mute-soft">{count}</span>
        {search}
        <div className="flex-1" />
        {sort}
        {view}
      </div>
      <div className="flex min-h-0 flex-1">
        {rail}
        {children}
      </div>
    </div>
  );
}

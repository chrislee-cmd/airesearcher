'use client';

/* ────────────────────────────────────────────────────────────────────
   ProbingEmptySkeleton — 프로빙 위젯의 "세션 시작 전" empty state 에
   실제 응답자 페르소나 grid 의 shape 를 미리 보여주는 placeholder.

   ReflectionPane 의 `!isLive` 분기(세션 시작 전) 에서 mount. 세션이
   시작되면(isLive) grid 또는 다른 empty 분기로 넘어가면서 사라진다.

   순수 시각 placeholder — opacity 로 dim, pointer-events-none 로 상호작용
   차단, aria 관점에서도 Skeleton primitive 가 aria-hidden 을 붙인다.

   radius 는 Skeleton primitive 의 variant('circle'/'text') 가 base 에서
   단독 소유한다. className 으로 rounded-* 를 덮어쓰면 Tailwind v4 의
   CSS 소스 순서 충돌(§7.11) 로 base 가 이길 수 있어 variant 로 지정.
   ──────────────────────────────────────────────────────────────────── */

import { Skeleton } from '@/components/ui/skeleton';

export function ProbingEmptySkeleton() {
  return (
    <div
      aria-hidden
      className="pointer-events-none select-none p-4 opacity-40"
    >
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col items-center gap-2 rounded-sm border border-line-soft p-3"
          >
            {/* 아바타 원 */}
            <Skeleton variant="circle" className="h-16 w-16" />
            {/* 이름 */}
            <Skeleton variant="text" className="h-3 w-20" />
            {/* 특성 2 라인 */}
            <Skeleton variant="text" className="h-2 w-24" />
            <Skeleton variant="text" className="h-2 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

export type NavItem = { id: string; icon: string; title: string };

// 좌측 섹션 nav + scroll-spy. 스크롤 컨테이너 (모달 grid 영역) 를 root 로
// 한 IntersectionObserver 로 현재 보이는 섹션을 강조한다. 클릭 시 anchor
// 스크롤. 작은 viewport 에서는 부모가 숨김 (lg: 이상에서만 표시).
export function SectionNav({
  items,
  scrollRef,
}: {
  items: NavItem[];
  scrollRef: RefObject<HTMLElement | null>;
}) {
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);
  // 클릭 점프 직후엔 observer 가 중간 섹션을 잠깐 active 로 깜빡이지 않도록
  // 짧게 락을 건다 (boolean + setTimeout — Date.now 순수성 룰 회피).
  const lockedRef = useRef(false);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || items.length === 0) return;
    const els = items
      .map((it) => root.querySelector<HTMLElement>(`#${CSS.escape(it.id)}`))
      .filter((el): el is HTMLElement => el != null);
    if (els.length === 0) return;

    const visible = new Map<string, number>();
    const obs = new IntersectionObserver(
      (entries) => {
        if (lockedRef.current) return;
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.intersectionRatio);
          else visible.delete(e.target.id);
        }
        // 가장 위(문서 순서)이면서 보이는 섹션을 active 로.
        let best: string | null = null;
        for (const it of items) {
          if (visible.has(it.id)) {
            best = it.id;
            break;
          }
        }
        if (best) setActiveId(best);
      },
      {
        root,
        // 상단 25% ~ 하단 60% band 에 들어온 섹션을 "현재"로 — 헤더가 막
        // 상단을 넘는 순간 활성화되게.
        rootMargin: '-15% 0px -55% 0px',
        threshold: [0, 0.1, 0.5, 1],
      },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [items, scrollRef]);

  function onClick(e: React.MouseEvent, id: string) {
    e.preventDefault();
    const root = scrollRef.current;
    const el = root?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (el) {
      lockedRef.current = true;
      setActiveId(id);
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.setTimeout(() => {
        lockedRef.current = false;
      }, 700);
    }
  }

  return (
    <nav className="flex w-[220px] shrink-0 flex-col gap-1 overflow-y-auto border-r-2 border-ink/15 p-4">
      <span className="mb-2 px-2 text-xs uppercase tracking-[.18em] text-mute-soft">
        섹션
      </span>
      {items.map((s) => {
        const active = activeId === s.id;
        return (
          <a
            key={s.id}
            href={`#${s.id}`}
            onClick={(e) => onClick(e, s.id)}
            className={`flex items-center gap-2 rounded-xs px-2 py-1.5 text-sm transition-colors ${
              active
                ? 'bg-amore-bg font-semibold text-ink'
                : 'text-mute hover:bg-paper-soft hover:text-ink-2'
            }`}
          >
            <span aria-hidden className="text-base">
              {s.icon}
            </span>
            <span className="min-w-0 truncate">{s.title}</span>
          </a>
        );
      })}
    </nav>
  );
}

'use client';

import { useState, type ReactNode } from 'react';
import { IconButton } from '@/components/ui/icon-button';
import type { DeskAccent, DeskEmphasis } from '@/lib/desk-report-parser';

// 데스크 결과 — 섹션별 Memphis 카드 primitive. 외곽은 디자인 시스템 Memphis
// 톤 (3px ink border + offset shadow + paper). accent 는 헤더의 아이콘 chip
// 배경에만 쓰여 섹션을 색으로 구분하되 카드 외곽은 통일 (PROJECT.md §7.11 —
// 색은 variant 가 단독 소유, base 엔 layout 만).
//
// info 토큰은 globals.css 에 없어 pastel sky 로 대체. accent 별 chip 배경은
// 모두 실재 토큰 (amore-bg / pastel / paper-soft).

const ACCENT_CHIP: Record<DeskAccent, string> = {
  amore: 'bg-amore-bg text-amore',
  success: 'bg-mint text-ink',
  info: 'bg-sky text-ink',
  warning: 'bg-warning-bg text-ink',
  peach: 'bg-peach text-ink',
  mute: 'bg-paper-soft text-mute',
  'mute-soft': 'bg-paper-soft text-mute-soft',
  ink: 'bg-paper-soft text-ink-2',
};

// emphasis → grid 점유 + padding. large 는 full-width 행, 그 외는 1 col.
const EMPHASIS_WRAP: Record<DeskEmphasis, string> = {
  large: 'col-span-full',
  medium: '',
  small: 'col-span-full',
};
const EMPHASIS_PAD: Record<DeskEmphasis, string> = {
  large: 'p-6',
  medium: 'p-4',
  small: 'p-4',
};
const EMPHASIS_TITLE: Record<DeskEmphasis, string> = {
  large: 'text-lg',
  medium: 'text-md',
  small: 'text-md',
};

export function SectionCard({
  id,
  icon,
  title,
  emphasis = 'medium',
  accent = 'ink',
  collapsible = false,
  defaultOpen = true,
  meta,
  children,
}: {
  id: string;
  icon: string;
  title: string;
  emphasis?: DeskEmphasis;
  accent?: DeskAccent;
  collapsible?: boolean;
  defaultOpen?: boolean;
  meta?: ReactNode; // 헤더 우측 (건수 등)
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyVisible = !collapsible || open;

  return (
    <article
      id={id}
      // scroll-margin 으로 sidebar anchor 점프 시 상단이 잘리지 않게.
      className={`scroll-mt-4 rounded-sm border-[3px] border-ink bg-paper shadow-[4px_4px_0_var(--color-ink)] ${EMPHASIS_WRAP[emphasis]} ${EMPHASIS_PAD[emphasis]}`}
    >
      <header
        className={`flex items-center gap-2.5 ${bodyVisible ? 'mb-3 border-b-2 border-line pb-2.5' : ''}`}
      >
        <span
          aria-hidden
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-xs text-lg ${ACCENT_CHIP[accent]}`}
        >
          {icon}
        </span>
        <h3
          className={`min-w-0 flex-1 truncate font-semibold tracking-[-0.01em] text-ink ${EMPHASIS_TITLE[emphasis]}`}
          title={title}
        >
          {title}
        </h3>
        {meta && <span className="shrink-0 text-xs text-mute-soft">{meta}</span>}
        {collapsible && (
          <IconButton
            variant="ghost"
            size="sm"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? '접기' : '펼치기'}
            className="shrink-0"
          >
            <span
              aria-hidden
              className={`inline-block transition-transform ${open ? 'rotate-180' : ''}`}
            >
              ▼
            </span>
          </IconButton>
        )}
      </header>
      {bodyVisible && <div className="min-w-0">{children}</div>}
    </article>
  );
}

'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetShell — 카드 골격 (헤더 + Stats + PrimaryAction + Queue + Recent).
   컨텐츠 모듈의 도메인 모름. WidgetContent 만 받음.
   ──────────────────────────────────────────────────────────────────── */

import type { Recent, StatTile, WidgetContent } from '../widget-types';
import { ACCENT_BG, ACCENT_ICON, CARD_H_COLLAPSED, CARD_W, statePill } from './tokens';
import { Pill } from './primitives';
import { QueuePanel } from './queue-panel';

export function getCardHeight(content: WidgetContent, collapsed: boolean): number {
  return collapsed ? CARD_H_COLLAPSED : content.expandedHeight;
}

export function WidgetShell({
  content,
  x,
  y,
  collapsed,
  selected,
  onToggle,
  onSelect,
}: {
  content: WidgetContent;
  x: number;
  y: number;
  collapsed: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const h = getCardHeight(content, collapsed);

  return (
    <div
      className={`absolute flex flex-col rounded-md border bg-paper-soft transition-all ${
        selected
          ? 'border-amore shadow-bento'
          : 'border-line shadow-bento hover:border-ink'
      }`}
      style={{ left: x, top: y, width: CARD_W, height: h }}
      onClick={onSelect}
    >
      <CardHeader content={content} collapsed={collapsed} onToggle={onToggle} />
      {!collapsed && (
        <div className="flex-1 overflow-hidden">
          <CardBody content={content} />
        </div>
      )}
    </div>
  );
}

function CardHeader({
  content,
  collapsed,
  onToggle,
}: {
  content: WidgetContent;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pill = statePill(content.state);
  return (
    <div className="flex h-[88px] shrink-0 items-center gap-4 border-b border-line-soft px-5">
      <div
        className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-sm ${ACCENT_BG[content.meta.accent]}`}
      >
        <span className="text-2xl text-ink">{ACCENT_ICON[content.meta.accent]}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xl font-medium text-ink">{content.meta.label}</span>
          <Pill {...pill} small />
        </div>
        <div className="mt-1 text-sm text-mute line-clamp-1">{content.meta.subtitle}</div>
        {content.state === 'running' && content.progress != null && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1 w-32 overflow-hidden rounded-pill bg-line-soft">
              <div
                className="h-full rounded-pill bg-amore"
                style={{ width: `${content.progress}%` }}
              />
            </div>
            <span className="text-xs text-mute">
              {content.phaseLabel} · {content.progress}%
            </span>
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <span className="text-xs text-mute-soft">
          {content.meta.cost === 0 ? '무료' : `${content.meta.cost} 크레딧`}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="rounded-xs border border-line bg-paper px-2 py-0.5 text-xs text-mute hover:border-ink hover:text-ink"
          aria-label={collapsed ? '펼치기' : '접기'}
        >
          {collapsed ? '펼치기 ▾' : '접기 ▴'}
        </button>
      </div>
    </div>
  );
}

function CardBody({ content }: { content: WidgetContent }) {
  const { PrimaryAction } = content;
  return (
    <div className="flex h-full flex-col">
      <StatsRow stats={content.stats} />
      <div className="flex-1 overflow-hidden border-t border-line-soft px-5 py-4">
        <PrimaryAction />
        {content.state === 'running' && content.queue && (
          <QueuePanel queue={content.queue} />
        )}
      </div>
      <RecentSection recents={content.recents} />
    </div>
  );
}

function StatsRow({ stats }: { stats: StatTile[] }) {
  return (
    <div className="grid grid-cols-3 divide-x divide-line-soft border-t border-line-soft">
      {stats.map((s) => (
        <div key={s.label} className="px-5 py-3">
          <div className="text-xs text-mute-soft">{s.label}</div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-medium text-ink">{s.value}</span>
            {s.trend === 'up' && <span className="text-xs text-success">↑</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function RecentSection({ recents }: { recents: Recent[] }) {
  return (
    <div className="shrink-0 border-t border-line-soft px-5 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-mute-soft">
          최근 산출물
        </span>
        <button className="text-xs text-amore hover:underline">전체 →</button>
      </div>
      <div className="space-y-1">
        {recents.slice(0, 3).map((r) => (
          <div
            key={r.name}
            className="flex items-center justify-between rounded-xs px-2 py-1.5 text-md text-ink hover:bg-paper"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{r.name}</div>
              <div className="text-xs text-mute-soft">{r.meta}</div>
            </div>
            <button className="ml-2 text-xs text-amore hover:underline">열기</button>
          </div>
        ))}
      </div>
    </div>
  );
}

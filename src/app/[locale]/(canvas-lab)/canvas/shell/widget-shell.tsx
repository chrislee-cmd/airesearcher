'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetShell — 카드 골격 (헤더 + Stats + PrimaryAction + Queue + Recents).
   컨텐츠 모듈의 도메인 모름. WidgetContent 만 받음.
   선택(클릭) 상태에서만 최근 산출물 + 접기 토글 노출 — 평소엔 슬림.
   ──────────────────────────────────────────────────────────────────── */

import type { Recent, StatTile, WidgetContent } from '../widget-types';
import { ACCENT_BG, ACCENT_ICON, CARD_W, RECENTS_PANEL_H, statePill } from './tokens';
import { Pill } from './primitives';
import { QueuePanel } from './queue-panel';

export function getCardHeight(content: WidgetContent, selected: boolean): number {
  const hasRecents = selected && content.recents.length > 0;
  return content.expandedHeight + (hasRecents ? RECENTS_PANEL_H : 0);
}

export function WidgetShell({
  content,
  x,
  y,
  selected,
  onSelect,
  onCollapse,
}: {
  content: WidgetContent;
  x: number;
  y: number;
  selected: boolean;
  onSelect: () => void;
  onCollapse: () => void;
}) {
  return (
    <div className="absolute" style={{ left: x, top: y }}>
      <WidgetCard
        content={content}
        selected={selected}
        onSelect={onSelect}
        onCollapse={onCollapse}
      />
    </div>
  );
}

// 위치(절대 좌표) 없이 카드 자체만 렌더. canvas-mock 의 stack 밖에서 단독 사용
// (예: in-app 라우트 `/transcripts` 본문에 단일 위젯으로 마운트).
export function WidgetCard({
  content,
  selected,
  onSelect,
  onCollapse,
}: {
  content: WidgetContent;
  selected: boolean;
  onSelect?: () => void;
  onCollapse: () => void;
}) {
  const h = getCardHeight(content, selected);

  return (
    <div
      className={`flex flex-col rounded-md border bg-paper-soft transition-all ${
        selected
          ? 'border-amore shadow-bento'
          : 'border-line shadow-bento hover:border-ink'
      }`}
      style={{ width: CARD_W, height: h }}
      onClick={onSelect}
    >
      <CardHeader content={content} selected={selected} onCollapse={onCollapse} />
      <div className="flex-1 overflow-hidden">
        <CardBody content={content} selected={selected} />
      </div>
    </div>
  );
}

function CardHeader({
  content,
  selected,
  onCollapse,
}: {
  content: WidgetContent;
  selected: boolean;
  onCollapse: () => void;
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
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span className="text-xs text-mute-soft">
          {content.meta.cost === 0 ? '무료' : `${content.meta.cost} 크레딧`}
        </span>
        {selected && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCollapse();
            }}
            className="rounded-xs border border-line bg-paper px-2 py-0.5 text-xs text-mute hover:border-ink hover:text-ink"
            aria-label="접기"
          >
            접기 ▲
          </button>
        )}
      </div>
    </div>
  );
}

function CardBody({ content, selected }: { content: WidgetContent; selected: boolean }) {
  const { PrimaryAction } = content;
  return (
    <div className="flex h-full flex-col">
      <StatsRow stats={content.stats} />
      <div className="flex-1 overflow-auto border-t border-line-soft px-5 py-4">
        <PrimaryAction />
        {content.state === 'running' && content.queue && (
          <QueuePanel queue={content.queue} />
        )}
      </div>
      {selected && content.recents.length > 0 && (
        <RecentsPanel recents={content.recents} />
      )}
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

function RecentsPanel({ recents }: { recents: Recent[] }) {
  return (
    <div className="shrink-0 border-t border-line-soft px-5 py-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-mute-soft">
          최근 산출물
        </span>
        <button className="text-xs text-amore hover:underline">전체 →</button>
      </div>
      <div className="space-y-1.5">
        {recents.slice(0, 3).map((r) => (
          <div
            key={r.name}
            className="flex items-center justify-between rounded-xs border border-line bg-paper px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-md text-ink">{r.name}</div>
              <div className="text-xs text-mute-soft">{r.meta}</div>
            </div>
            <button className="ml-3 shrink-0 text-xs text-amore hover:underline">
              열기
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

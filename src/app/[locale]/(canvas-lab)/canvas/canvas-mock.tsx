'use client';

/* ────────────────────────────────────────────────────────────────────────
   Canvas v0.6 — shell / content 분리 후 컨테이너.
   캔버스 평면 + Topbar + 인스펙터 + 위젯 list 렌더링만.
   shell/ 의 컴포넌트와 widgets/ 의 컨텐츠 모듈을 조합.
   격리: (canvas-lab) route group.
   ──────────────────────────────────────────────────────────────────────── */

import { useState } from 'react';
import type { WidgetContent } from './widget-types';
import { CARD_W, COL_X, ROW_GAP, TOP_OFFSET, statePill } from './shell/tokens';
import { Pill, Section } from './shell/primitives';
import { WidgetShell, getCardHeight } from './shell/widget-shell';
import { transcriptsContent } from './widgets/transcripts';

// 활성 위젯. 다른 도구를 노출하려면 widgets/{key} import 후 여기에 추가.
// 비노출 컨텐츠 모듈은 widgets/ 아래에 그대로 보존.
const WIDGETS: WidgetContent[] = [transcriptsContent];

export function CanvasMock() {
  const [selected, setSelected] = useState<string | null>(
    WIDGETS[0]?.key ?? null,
  );

  const layout = WIDGETS.reduce<{
    positions: { key: string; y: number }[];
    cursor: number;
  }>(
    (acc, w) => ({
      positions: [...acc.positions, { key: w.key, y: acc.cursor }],
      cursor: acc.cursor + getCardHeight(w) + ROW_GAP,
    }),
    { positions: [], cursor: TOP_OFFSET },
  );
  const positions = layout.positions;
  const totalHeight = layout.cursor + 80;

  const selectedWidget = selected ? WIDGETS.find((w) => w.key === selected) : null;

  return (
    <div className="relative flex h-full w-full">
      <div className="relative flex-1 overflow-auto">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(29,27,32,0.06) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />

        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-paper/80 px-6 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="h-6 w-6 rounded-xs bg-amore" />
            <span className="text-md font-medium text-ink">Researchmochi</span>
            <span className="text-xs text-mute-soft">· canvas (lab)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-mute">크레딧 2,840</span>
            <button className="rounded-xs border border-line bg-paper-soft px-3 py-1.5 text-xs text-ink hover:border-ink">
              권한 관리
            </button>
            <button className="rounded-xs border border-line bg-paper-soft px-3 py-1.5 text-xs text-ink hover:border-ink">
              저장됨 · 방금 전
            </button>
          </div>
        </div>

        <div
          className="relative mx-auto"
          style={{ width: COL_X * 2 + CARD_W, height: totalHeight }}
        >
          {WIDGETS.map((w) => {
            const pos = positions.find((p) => p.key === w.key);
            if (!pos) return null;
            return (
              <WidgetShell
                key={w.key}
                content={w}
                x={COL_X}
                y={pos.y}
                selected={selected === w.key}
                onSelect={() => setSelected(w.key)}
              />
            );
          })}
        </div>
      </div>

      {selectedWidget && (
        <Inspector content={selectedWidget} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function Inspector({
  content,
  onClose,
}: {
  content: WidgetContent;
  onClose: () => void;
}) {
  return (
    <div className="z-20 flex h-full w-[360px] flex-col border-l border-line bg-paper-soft">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div>
          <div className="text-xs text-mute-soft">선택된 위젯</div>
          <div className="mt-0.5 text-lg font-medium text-ink">
            {content.meta.label}
          </div>
        </div>
        <button onClick={onClose} className="text-mute-soft hover:text-ink" aria-label="닫기">
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-auto px-5 py-5">
        <Section label="상태">
          <Pill {...statePill(content.state)} />
          {content.state === 'running' && content.progress != null && (
            <div className="mt-3 space-y-1.5">
              <div className="flex justify-between text-xs text-mute">
                <span>{content.phaseLabel}</span>
                <span>{content.progress}%</span>
              </div>
              <div className="h-1 overflow-hidden rounded-pill bg-line-soft">
                <div
                  className="h-full rounded-pill bg-amore"
                  style={{ width: `${content.progress}%` }}
                />
              </div>
            </div>
          )}
        </Section>

        <Section label="이번 달 사용량">
          <div className="grid grid-cols-3 gap-2">
            {content.stats.map((s) => (
              <div
                key={s.label}
                className="rounded-xs border border-line bg-paper px-2 py-2"
              >
                <div className="text-xs text-mute-soft">{s.label}</div>
                <div className="mt-0.5 text-md font-medium text-ink">{s.value}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section label="최근 산출물">
          {content.recents.length > 0 ? (
            <div className="space-y-1.5">
              {content.recents.map((r) => (
                <div
                  key={r.name}
                  className="flex items-center justify-between rounded-xs border border-line bg-paper px-3 py-2 text-md text-ink"
                >
                  <span className="truncate">{r.name}</span>
                  <button className="text-xs text-amore hover:underline">열기</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-mute-soft">없음</div>
          )}
        </Section>

        <Section label="전체 화면">
          <button className="w-full rounded-xs border border-amore bg-amore px-3 py-2 text-md text-paper-soft hover:opacity-90">
            기존 페이지로 열기 →
          </button>
          <div className="mt-1 text-xs text-mute-soft">
            캔버스를 벗어나 전용 페이지에서 작업합니다.
          </div>
        </Section>
      </div>
    </div>
  );
}

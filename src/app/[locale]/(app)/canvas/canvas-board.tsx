'use client';

/* ────────────────────────────────────────────────────────────────────
   CanvasBoard — production /canvas 본문. 3-col CSS grid + expanded state
   단일 관리 (B-2: 1장만 펼침). collapsed 카드는 정사각형(aspect-square) 셀
   1개, expanded 카드는 col-span-3 으로 풀폭 row 차지. 다른 카드 클릭 →
   그 카드 expand, 직전 expanded 는 자동 collapse. 초기값은 deep-link
   focus param (?focus=desk) 우선, 없으면 visible 위젯 중 첫 번째.
   ──────────────────────────────────────────────────────────────────── */

import { useState } from 'react';
import { WidgetShell } from '@/components/canvas/shell/widget-shell';
import type { WidgetContent } from '@/components/canvas/widget-types';

export function CanvasBoard({
  widgets,
  initialFocus,
}: {
  widgets: WidgetContent[];
  initialFocus?: string;
}) {
  const initial =
    initialFocus && widgets.some((w) => w.key === initialFocus)
      ? initialFocus
      : (widgets[0]?.key ?? null);
  const [expanded, setExpanded] = useState<string | null>(initial);

  return (
    <div className="mx-auto grid w-full max-w-[1100px] grid-cols-3 gap-3 py-4">
      {widgets.map((w) => {
        const isExpanded = expanded === w.key;
        return (
          <div key={w.key} className={isExpanded ? 'col-span-3' : ''}>
            <WidgetShell
              content={w}
              expanded={isExpanded}
              onExpand={() => setExpanded(w.key)}
            />
          </div>
        );
      })}
    </div>
  );
}

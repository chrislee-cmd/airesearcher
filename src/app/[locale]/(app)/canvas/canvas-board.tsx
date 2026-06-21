'use client';

/* ────────────────────────────────────────────────────────────────────
   CanvasBoard — production /canvas 본문. 카드 N장 vertical stack +
   expanded state 단일 관리 (B-2: 1장만 펼침). 다른 카드 클릭 → 그 카드
   pa는 expand, 직전 expanded 는 자동 collapse. 초기값은 deep-link
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
    <div className="mx-auto w-full max-w-[860px] space-y-3 py-4">
      {widgets.map((w) => (
        <WidgetShell
          key={w.key}
          content={w}
          expanded={expanded === w.key}
          onExpand={() => setExpanded(w.key)}
        />
      ))}
    </div>
  );
}

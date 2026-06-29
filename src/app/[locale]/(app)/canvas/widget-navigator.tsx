'use client';

/* ────────────────────────────────────────────────────────────────────
   Canvas Widget Navigator — 좌측 상단 floating list.

   현재 위젯 탐색 = wheel zoom + space-hold pan 만 → 위젯 많아지면 답답.
   이 panel 은 위젯 목록을 보여주고 클릭 시 캔버스를 해당 위젯에 자동
   focus (pan + zoom 1.0) — Figma/Miro 의 "Pages" panel 류.

   - Memphis 톤 외곽 (border-2 ink + 3px ink shadow + rounded-sm)
   - collapsible: 헤더 클릭 → list 숨김 / 펼침
   - 현재 focus 표시: border-amore + amore-bg highlight
   - 키보드 단축키 1~9 — list 순서대로 jump (input/textarea 안에서는 무시)
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WidgetContent } from '@/components/canvas/widget-types';
import { ACCENT_BG } from '@/components/canvas/shell/tokens';

type Props = {
  widgets: WidgetContent[];
  focusedKey: string | null;
  onFocus: (key: string) => void;
};

export function WidgetNavigator({ widgets, focusedKey, onFocus }: Props) {
  const t = useTranslations('Canvas.navigator');
  // default expanded — 위젯 9 개 내외라 list 가 짧고 Navigator 의 가치는
  // 시각적으로 보이는 list 자체. collapse 는 작은 viewport 배려용 옵션.
  const [open, setOpen] = useState(true);

  // 1~9 단축키. input/textarea/contenteditable 안에서는 무시.
  useEffect(() => {
    const isEditableTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > 9) return;
      const w = widgets[n - 1];
      if (!w) return;
      e.preventDefault();
      onFocus(w.key);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [widgets, onFocus]);

  return (
    <div
      // z-fab — surface 위, modal/toast 아래. transform 안 받음 (canvas 의
      // 자체 컨테이너 좌표계).
      className="absolute left-4 top-4 z-fab w-52 border-[2px] border-ink bg-paper shadow-[3px_3px_0_black] rounded-sm select-none"
      data-canvas-action
    >
      {/* eslint-disable-next-line react/forbid-elements -- full-width text-row collapse toggle; <Button> primitive enforces capsule/border-shadow chrome incompatible with the borderless header row. Same row-button pattern as src/components/ui/dropdown-menu.tsx. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-ink hover:bg-paper-soft"
        aria-expanded={open}
        aria-label={open ? t('collapse') : t('expand')}
      >
        <span className="tracking-wide uppercase">{t('title')}</span>
        <span aria-hidden className="text-mute text-xs leading-none">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open ? (
        <ul className="border-t-[2px] border-ink/15 py-1">
          {widgets.map((w, idx) => {
            const isFocused = focusedKey === w.key;
            const accentCls = ACCENT_BG[w.meta.accent];
            return (
              <li key={w.key}>
                {/* eslint-disable-next-line react/forbid-elements -- menu-row item (dot + label + shortcut hint), identical pattern to src/components/ui/dropdown-menu.tsx; <Button> capsule chrome would break the list row read. */}
                <button
                  type="button"
                  onClick={() => onFocus(w.key)}
                  className={
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ' +
                    (isFocused
                      ? 'bg-amore-bg text-amore font-semibold'
                      : 'text-ink hover:bg-paper-soft')
                  }
                  aria-current={isFocused ? 'true' : undefined}
                >
                  <span
                    aria-hidden
                    className={
                      'inline-block h-2.5 w-2.5 rounded-full border-[1.5px] border-ink ' +
                      accentCls
                    }
                  />
                  <span className="flex-1 truncate">{w.meta.label}</span>
                  {idx < 9 ? (
                    <span className="text-mute text-xs tabular-nums">
                      {idx + 1}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

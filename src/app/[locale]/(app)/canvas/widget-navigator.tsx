'use client';

/* ────────────────────────────────────────────────────────────────────
   Canvas Widget Navigator — viewport-floating list.

   현재 위젯 탐색 = wheel zoom + space-hold pan 만 → 위젯 많아지면 답답.
   이 panel 은 위젯 목록을 보여주고 클릭 시 캔버스를 해당 위젯에 자동
   focus (pan + zoom 1.0) — Figma/Miro 의 "Pages" panel 류.

   - Memphis 톤 외곽 (border-2 ink + 3px ink shadow + rounded-sm)
   - 헤더 grip 영역 = drag handle (pointer capture, viewport clamp,
     localStorage 영속화). 위치는 다음 진입에도 보존.
   - collapsible: 헤더의 ▾ 클릭 → list 숨김 / 펼침
   - 현재 focus 표시: border-amore + amore-bg highlight
   - 키보드 단축키 1~9 — list 순서대로 jump (input/textarea 안에서는 무시)
   - 각 row 우측에 위젯 상태 badge (running/done/error). idle 은 미표시.

   position: fixed 로 viewport 좌표계 — canvas pan/zoom 와 무관하게
   화면 고정 위치. canvas pan 은 space-hold 가 필요해 Navigator drag 와
   자연스럽게 분리되지만, 추가로 pointer capture 가 drag 중 다른 영역
   pointer 이벤트도 점유.
   ──────────────────────────────────────────────────────────────────── */

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import type { WidgetContent } from '@/components/canvas/widget-types';
import { ACCENT_BG } from '@/components/canvas/shell/tokens';
import { useWidgetStateOf } from '@/components/canvas/shell/widget-state-context';
import { IconButton } from '@/components/ui/icon-button';

type Props = {
  widgets: WidgetContent[];
  focusedKey: string | null;
  onFocus: (key: string) => void;
  // 숨긴 위젯 key 집합 + 토글 콜백 — 각 row 우측 eye/eye-off 컨트롤이 사용.
  hiddenKeys: Set<string>;
  onToggleHidden: (key: string) => void;
};

// Inline eye / eye-off glyphs (16×16, stroke currentColor 1.5 — widget-shell
// 의 FullviewIcon 과 동일 규칙). aria-hidden: 버튼이 자체 aria-label 로 라벨링됨.
function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.5 8S3.5 3.5 8 3.5 14.5 8 14.5 8 12.5 12.5 8 12.5 1.5 8 1.5 8Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.4 3.7A6.3 6.3 0 0 1 8 3.5C12.5 3.5 14.5 8 14.5 8a11 11 0 0 1-1.8 2.4M3.6 5A11 11 0 0 0 1.5 8S3.5 12.5 8 12.5a6.3 6.3 0 0 0 2.3-.4M6.6 6.6a2 2 0 0 0 2.8 2.8M2 2l12 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type Pos = { x: number; y: number };

const NAV_POS_KEY = 'canvas-navigator-position';
// 상단 topbar = h-14 (56px). 네비게이터가 그 아래에서 시작/머물도록 하는 안전 하한.
const HEADER_H = 56;
const HEADER_GAP = 12; // 헤더와 네비 사이 숨쉴 여백
const TOP_SAFE = HEADER_H + HEADER_GAP; // = 68 — default 위치 + clamp y 하한
const DEFAULT_POS: Pos = { x: 24, y: TOP_SAFE };
const FALLBACK_W = 224;
const FALLBACK_H = 320;
// 드래그 임계치 — 이만큼 움직여야 실제 drag 로 인정 (의도치 않은 미세 떨림 무시).
const DRAG_THRESHOLD = 3;

function clampToViewport(p: Pos, w: number, h: number): Pos {
  if (typeof window === 'undefined') return p;
  const maxX = Math.max(0, window.innerWidth - w);
  // y 하한을 TOP_SAFE 로 — 드래그·resize·localStorage 복원 어느 경로로도 헤더 침범 불가.
  const maxY = Math.max(TOP_SAFE, window.innerHeight - h);
  return {
    x: Math.max(0, Math.min(maxX, p.x)),
    y: Math.max(TOP_SAFE, Math.min(maxY, p.y)),
  };
}

function readStoredPos(): Pos {
  if (typeof window === 'undefined') return DEFAULT_POS;
  try {
    const raw = window.localStorage.getItem(NAV_POS_KEY);
    if (!raw) return DEFAULT_POS;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.x === 'number' &&
      typeof parsed.y === 'number' &&
      Number.isFinite(parsed.x) &&
      Number.isFinite(parsed.y)
    ) {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {
    /* corrupted — fall through to default */
  }
  return DEFAULT_POS;
}

// list row 우측에 상태/progress 표시. idle 이면 null (단축키 hint 만).
// running: amore 점 + progress % 또는 "진행 중"
// done: mint 톤 체크
// error: warning 톤 느낌표 (message 가 있으면 tooltip)
function WidgetStateBadge({ widgetKey }: { widgetKey: string }) {
  const t = useTranslations('Canvas.navigator');
  const state = useWidgetStateOf(widgetKey);
  if (state.kind === 'idle') return null;
  if (state.kind === 'running') {
    // overallProgress (누적 0~100, 단계 가중) 가 있으면 우선 — 위젯 헤더
    // pill 의 per-phase progress 와 다르다. 없으면 per-phase progress 로
    // fallback (legacy 위젯). 둘 다 없으면 진행 중 라벨만.
    const raw =
      typeof state.overallProgress === 'number'
        ? state.overallProgress
        : typeof state.progress === 'number'
          ? state.progress
          : null;
    const pct =
      raw === null
        ? t('stateRunning')
        : `${Math.max(0, Math.min(100, Math.round(raw)))}%`;
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums text-amore">
        <span aria-hidden className="animate-pulse">
          ●
        </span>
        {pct}
      </span>
    );
  }
  if (state.kind === 'done') {
    return (
      <span
        aria-label={t('stateDone')}
        className="inline-flex shrink-0 items-center text-xs font-bold"
        style={{ color: 'var(--color-success)' }}
      >
        ✓
      </span>
    );
  }
  if (state.kind === 'error') {
    return (
      <span
        aria-label={t('stateError')}
        title={state.message ?? undefined}
        className="inline-flex shrink-0 items-center text-xs font-bold"
        style={{ color: 'var(--color-warning)' }}
      >
        !
      </span>
    );
  }
  return null;
}

export function WidgetNavigator({
  widgets,
  focusedKey,
  onFocus,
  hiddenKeys,
  onToggleHidden,
}: Props) {
  const t = useTranslations('Canvas.navigator');
  // default expanded — 위젯 9 개 내외라 list 가 짧고 Navigator 의 가치는
  // 시각적으로 보이는 list 자체. collapse 는 작은 viewport 배려용 옵션.
  const [open, setOpen] = useState(true);

  // 위치 — SSR 동안 default 로 시작 후 mount 시 localStorage 에서 hydrate.
  // hydrated 전엔 visibility:hidden 으로 초기 위치 "점프" 가림.
  const [pos, setPos] = useState<Pos>(DEFAULT_POS);
  const [hydrated, setHydrated] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // mount 시 localStorage 위치 hydrate + viewport clamp
  useEffect(() => {
    const stored = readStoredPos();
    const rect = containerRef.current?.getBoundingClientRect();
    const w = rect?.width ?? FALLBACK_W;
    const h = rect?.height ?? FALLBACK_H;
    setPos(clampToViewport(stored, w, h));
    setHydrated(true);
  }, []);

  // viewport resize → 현재 pos 가 밖이면 clamp. rAF debounce.
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        const w = rect?.width ?? FALLBACK_W;
        const h = rect?.height ?? FALLBACK_H;
        setPos((p) => clampToViewport(p, w, h));
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

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
      // focus 단축키는 visible 위젯만 대상 — 숨긴 위젯은 미렌더라 focus 불가.
      const visible = widgets.filter((w) => !hiddenKeys.has(w.key));
      const w = visible[n - 1];
      if (!w) return;
      e.preventDefault();
      onFocus(w.key);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [widgets, hiddenKeys, onFocus]);

  // pointer drag — header 의 grip 영역에서 시작.
  // pointer capture 로 drag 중 화면 어디로 가도 이벤트 점유 → canvas pan
  // (어차피 space-hold 필요) 과 충돌 0, 다른 위젯 hover 회귀도 0.
  // 매 render 마다 새 함수가 생성되지만 React event prop 이라 cost 0.
  // 핵심: pointerdown 시점의 pos 를 closure 로 capture → 이후 setPos 가
  // 다시 render 를 일으켜도 이 drag session 의 startPos 는 그대로.
  const onDragPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // 좌클릭 / 터치만. 우클릭·중간버튼은 무시.
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    const target = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    const startPos = pos;
    const rect = containerRef.current?.getBoundingClientRect();
    const w = rect?.width ?? FALLBACK_W;
    const h = rect?.height ?? FALLBACK_H;
    let moved = false;
    let latest = startPos;

    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      /* capture 실패해도 listener 만으로 동작 */
    }

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
          return;
        }
        moved = true;
        setIsDragging(true);
      }
      const next = clampToViewport(
        { x: startPos.x + dx, y: startPos.y + dy },
        w,
        h,
      );
      latest = next;
      setPos(next);
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      try {
        target.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (moved) {
        setIsDragging(false);
        try {
          window.localStorage.setItem(NAV_POS_KEY, JSON.stringify(latest));
        } catch {
          /* quota / private mode — 다음 진입엔 default 로 떨어짐 */
        }
      }
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  const onResetPosition = () => {
    setPos(DEFAULT_POS);
    try {
      window.localStorage.removeItem(NAV_POS_KEY);
    } catch {
      /* ignore */
    }
  };

  const movedFromDefault =
    pos.x !== DEFAULT_POS.x || pos.y !== DEFAULT_POS.y;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        visibility: hydrated ? 'visible' : 'hidden',
      }}
      // z-fab — surface 위, modal/toast 아래. fixed positioning 으로
      // canvas transform 영향 0.
      className={
        'w-56 overflow-hidden border-[2px] border-ink bg-paper rounded-sm select-none z-fab ' +
        (isDragging
          ? 'shadow-[4px_4px_0_black]'
          : 'shadow-[3px_3px_0_black]')
      }
      data-canvas-action
    >
      <div className="flex items-stretch">
        <div
          role="presentation"
          onPointerDown={onDragPointerDown}
          className={
            'flex flex-1 items-center gap-1.5 px-3 py-2 text-xs font-semibold text-ink touch-none ' +
            (isDragging ? 'cursor-grabbing' : 'cursor-move')
          }
          aria-label={t('dragHandle')}
        >
          <span aria-hidden className="text-mute leading-none">
            ⠿
          </span>
          <span className="tracking-wide uppercase">{t('title')}</span>
        </div>
        {movedFromDefault ? (
          /* eslint-disable-next-line react/forbid-elements -- inline header chrome row; <Button> primitive enforces capsule chrome incompatible with this borderless header. */
          <button
            type="button"
            onClick={onResetPosition}
            className="px-2 text-xs text-mute hover:text-ink hover:bg-paper-soft"
            aria-label={t('resetPosition')}
            title={t('resetPosition')}
          >
            ↺
          </button>
        ) : null}
        {/* eslint-disable-next-line react/forbid-elements -- collapse toggle; <Button> primitive enforces capsule/border-shadow chrome incompatible with the borderless header row. Same row-button pattern as src/components/ui/dropdown-menu.tsx. */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="px-3 text-xs text-mute hover:text-ink hover:bg-paper-soft"
          aria-expanded={open}
          aria-label={open ? t('collapse') : t('expand')}
        >
          {open ? '▾' : '▸'}
        </button>
      </div>
      {open ? (
        <ul className="border-t-[2px] border-ink/15 py-1">
          {widgets.map((w) => {
            const isHidden = hiddenKeys.has(w.key);
            const isFocused = focusedKey === w.key && !isHidden;
            const accentCls = ACCENT_BG[w.meta.accent];
            // 숨긴 row 는 목록에 dim 으로 남아 복원 가능. label 클릭 = 숨김이면
            // 복원(미렌더라 focus 불가), 아니면 focus. eye/eye-off 는 항상 토글.
            return (
              <li key={w.key} className="flex items-center">
                {/* eslint-disable-next-line react/forbid-elements -- menu-row item (dot + label + state badge), identical pattern to src/components/ui/dropdown-menu.tsx; <Button> capsule chrome would break the list row read. */}
                <button
                  type="button"
                  onClick={() =>
                    isHidden ? onToggleHidden(w.key) : onFocus(w.key)
                  }
                  className={
                    'flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-3 text-left text-xs transition-colors ' +
                    (isFocused
                      ? 'bg-amore-bg text-amore font-semibold'
                      : 'text-ink hover:bg-paper-soft') +
                    (isHidden ? ' opacity-45' : '')
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
                  <span className="min-w-0 flex-1 truncate">{w.meta.label}</span>
                  {!isHidden ? <WidgetStateBadge widgetKey={w.key} /> : null}
                </button>
                <IconButton
                  variant="plain"
                  size="sm"
                  className="mr-1 shrink-0"
                  onClick={() => onToggleHidden(w.key)}
                  aria-label={isHidden ? t('showWidget') : t('hideWidget')}
                  title={isHidden ? t('showWidget') : t('hideWidget')}
                >
                  {isHidden ? (
                    <EyeOffIcon className="h-3.5 w-3.5" />
                  ) : (
                    <EyeIcon className="h-3.5 w-3.5" />
                  )}
                </IconButton>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

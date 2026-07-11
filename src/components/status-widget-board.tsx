'use client';

/* ────────────────────────────────────────────────────────────────────
   /status 구성형 위젯 보드.

   지표 카드를 반응형 그리드 위젯으로 배치한다:
     - 이동   = 드래그 핸들로 순서 재배치(HTML5 DnD)
     - 리사이즈 = 오른쪽 모서리 드래그로 컬럼 span 1~3 (또는 헤더의 1/2/3 pill)
     - 넣다/뺐다 = "+ 위젯 추가" 팔레트 · 위젯 헤더의 제거(×)
   컬럼은 CSS grid 로 반응형(폰 1 · 태블릿 2 · 데스크 3 상한) — 저장 span 이 가용
   컬럼보다 크면 브라우저가 자동 clamp.

   ⚠️ react-grid-layout 미사용(보수적 결정): 이 repo 는 React 19 인데
   react-grid-layout → react-draggable/react-resizable 는 React 19 에서 제거된
   ReactDOM.findDOMNode 에 의존 → 런타임 크래시. 스펙이 커스텀 구현을 허용하므로
   네이티브 pointer/DnD 로 직접 구현(더 가볍고 SSR 친화적).

   편집 권한은 canEdit(super-admin) 일 때만. 공개 토큰 시청자는 canEdit=false →
   저장된 공유 배치를 read-only 로만 본다(핸들·컨트롤 전부 미렌더). 저장은
   super-admin 게이트 API(/api/admin/dashboard-layout)가 유일 관문.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminAnalyticsReport } from '@/lib/admin/analytics';
import {
  DEFAULT_LAYOUT,
  MAX_SPAN,
  MIN_SPAN,
  normalizeLayout,
  WIDGET_IDS,
  type DashboardLayout,
  type WidgetId,
} from '@/lib/admin/dashboard-layout';
import { WIDGET_REGISTRY } from './analytics-widgets';
import { ChromeButton } from './ui/chrome-button';
import { IconButton } from './ui/icon-button';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

type Props = {
  report: AdminAnalyticsReport;
  initialLayout: DashboardLayout;
  // super-admin 세션일 때만 true → 편집 진입 가능. false(공개 토큰)면 read-only.
  canEdit: boolean;
};

// 새 위젯 추가 시 기본 span — 기본 레이아웃의 span 을 재사용(없으면 1).
const DEFAULT_SPAN: Record<WidgetId, number> = WIDGET_IDS.reduce(
  (acc, id) => {
    acc[id] = DEFAULT_LAYOUT.widgets.find((w) => w.id === id)?.span ?? 1;
    return acc;
  },
  {} as Record<WidgetId, number>,
);

const GRID_GAP_PX = 16; // gap-4

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

function clampSpan(n: number): number {
  return Math.min(MAX_SPAN, Math.max(MIN_SPAN, Math.round(n)));
}

export function StatusWidgetBoard({ report, initialLayout, canEdit }: Props) {
  const [layout, setLayout] = useState<DashboardLayout>(initialLayout);
  const [editing, setEditing] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [isWide, setIsWide] = useState(false);

  // 항상 최신 layout 을 pointer/timeout 콜백에서 읽기 위한 mirror.
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeIds = new Set(layout.widgets.map((w) => w.id));
  const availableIds = WIDGET_IDS.filter((id) => !activeIds.has(id));

  // AutoRefresh(60s router.refresh)가 서버 페이지를 재실행하면 initialLayout prop 이
  // 최신 저장본으로 바뀐다. 편집 중이 아니면(공개 뷰 포함) 그걸 채택해 다른 기기에서
  // chris 가 바꾼 배치가 벽 모니터에 반영되게 한다. 편집 중이면 진행 중인 로컬 편집을
  // 덮지 않도록 skip(저장 완료분은 save() 가 이미 반영). React 공식 "prop 변화에 맞춰
  // state 조정" 패턴 — effect 아닌 render 중 동기화(cascading effect 회피).
  const [syncedLayout, setSyncedLayout] = useState(initialLayout);
  if (initialLayout !== syncedLayout && !editing) {
    setSyncedLayout(initialLayout);
    setLayout(initialLayout);
  }

  // 리사이즈 핸들은 lg(3컬럼)에서만 노출 — 좁은 화면에선 CSS 가 span 을 clamp 해
  // 픽셀 기준 리사이즈가 혼란스럽다. 이동/추가/제거는 모든 폭에서 가능.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => setIsWide(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const save = useCallback(async (next: DashboardLayout) => {
    setSaveState('saving');
    try {
      const res = await fetch('/api/admin/dashboard-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { layout?: DashboardLayout };
      // 서버가 정규화한 canonical 레이아웃으로 동기화(중복 제거/clamp 반영).
      if (json.layout) setLayout(json.layout);
      setSaveState('saved');
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaveState('idle'), 2000);
    } catch {
      setSaveState('error');
    }
  }, []);

  const scheduleSave = useCallback(
    (next: DashboardLayout) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void save(next), 800);
    },
    [save],
  );

  // setLayout + 디바운스 저장. 위젯 배치를 바꾸는 모든 조작이 통과하는 지점.
  const commit = useCallback(
    (widgets: DashboardLayout['widgets']) => {
      const norm = normalizeLayout({ version: 1, widgets });
      setLayout(norm);
      scheduleSave(norm);
    },
    [scheduleSave],
  );

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const reorder = (from: number, to: number) => {
    if (from === to) return;
    const ws = [...layout.widgets];
    const [moved] = ws.splice(from, 1);
    ws.splice(to, 0, moved);
    commit(ws);
  };

  const setSpan = (i: number, span: number) => {
    commit(
      layout.widgets.map((w, idx) =>
        idx === i ? { ...w, span: clampSpan(span) } : w,
      ),
    );
  };

  const removeWidget = (i: number) => {
    commit(layout.widgets.filter((_, idx) => idx !== i));
  };

  const addWidget = (id: WidgetId) => {
    commit([...layout.widgets, { id, span: DEFAULT_SPAN[id] }]);
    if (availableIds.length <= 1) setPaletteOpen(false);
  };

  // ── 드래그 이동 (pointer + elementFromPoint) ─────────────────────────────
  // HTML5 DnD 대신 pointer 이벤트로 통일 — recharts SVG / absolute 툴바 / backdrop
  // 과 섞여도 안정적이고 리사이즈와 같은 모델(HTML5 DnD 는 dataTransfer 미설정 시
  // Firefox 에서 시작조차 안 되고 Chrome 에서도 잘 취소됨). 핸들이 pointer 를
  // capture 하고, 매 move 마다 포인터 아래 셀(data-widget-index)을 드롭 대상으로
  // 하이라이트한 뒤 up 에서 재배치한다.
  const dragRef = useRef<{ from: number } | null>(null);

  const cellIndexAtPoint = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y);
    const cell = el?.closest('[data-widget-cell]') as HTMLElement | null;
    const idx = cell?.dataset.widgetIndex;
    return idx != null ? Number(idx) : null;
  };

  const onDragHandleDown = (
    e: React.PointerEvent<HTMLElement>,
    index: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { from: index };
    setDragIndex(index);
    setDropIndex(index);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onDragHandleMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    const over = cellIndexAtPoint(e.clientX, e.clientY);
    if (over !== null) setDropIndex(over);
  };

  const onDragHandleUp = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const to = cellIndexAtPoint(e.clientX, e.clientY);
    if (to !== null && to !== d.from) reorder(d.from, to);
    setDragIndex(null);
    setDropIndex(null);
  };

  // ── 모서리 드래그 리사이즈 (pointer) ────────────────────────────────────
  const resizeRef = useRef<{
    index: number;
    startX: number;
    startSpan: number;
    colUnit: number; // 컬럼 1칸 폭(gap 포함)
  } | null>(null);

  const onResizePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    index: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const cell = (e.currentTarget as HTMLElement).closest(
      '[data-widget-cell]',
    ) as HTMLElement | null;
    if (!cell) return;
    const startSpan = layout.widgets[index].span;
    // cell 폭 = startSpan*col + (startSpan-1)*gap → 1칸 폭(gap 포함) 역산.
    const colUnit = (cell.offsetWidth + GRID_GAP_PX) / startSpan;
    resizeRef.current = { index, startX: e.clientX, startSpan, colUnit };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = resizeRef.current;
    if (!r) return;
    const delta = e.clientX - r.startX;
    // 시작 시점 기준으로 span 계산(진행 중 span 변화에 영향받지 않게).
    const span = clampSpan(r.startSpan + delta / r.colUnit);
    const currentSpan = layout.widgets[r.index]?.span ?? 1;
    if (span !== currentSpan) {
      // 저장은 pointer up 에서 — 여기선 라이브 미리보기만(저장 스팸 방지).
      setLayout((prev) => ({
        version: 1,
        widgets: prev.widgets.map((w, idx) =>
          idx === r.index ? { ...w, span } : w,
        ),
      }));
    }
  };

  const onResizePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    scheduleSave(normalizeLayout(layoutRef.current));
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      {canEdit && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ChromeButton
              variant={editing ? 'primary' : 'default'}
              size="sm"
              onClick={() => {
                setEditing((v) => !v);
                setPaletteOpen(false);
              }}
            >
              {editing ? '편집 종료' : '보드 편집'}
            </ChromeButton>
            {editing && (
              <ChromeButton
                size="sm"
                disabled={availableIds.length === 0}
                onClick={() => setPaletteOpen((v) => !v)}
              >
                + 위젯 추가
                {availableIds.length > 0 && ` (${availableIds.length})`}
              </ChromeButton>
            )}
          </div>
          <SaveStatus state={saveState} />
        </div>
      )}

      {canEdit && editing && paletteOpen && (
        <div className="mb-4 border border-line bg-paper-soft px-4 py-3 rounded-sm">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-mute-soft">
            위젯 추가
          </div>
          {availableIds.length === 0 ? (
            <p className="text-md text-mute-soft">모든 위젯이 배치되어 있습니다.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {availableIds.map((id) => (
                <ChromeButton
                  key={id}
                  size="sm"
                  onClick={() => addWidget(id)}
                >
                  + {WIDGET_REGISTRY[id].label}
                </ChromeButton>
              ))}
            </div>
          )}
        </div>
      )}

      {editing && (
        <p className="mb-3 text-xs-soft text-mute-soft">
          드래그 핸들(⠿)로 이동 · 오른쪽 모서리(또는 헤더 1/2/3)로 폭 조절 ·
          ×로 제거. 변경은 자동 저장되어 모든 기기에 공유됩니다.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {layout.widgets.map((w, i) => {
          const def = WIDGET_REGISTRY[w.id];
          if (!def) return null;
          return (
            <div
              key={w.id}
              data-widget-cell
              data-widget-index={i}
              style={{ gridColumn: `span ${w.span} / span ${w.span}` }}
              className={cx(
                'relative min-w-0',
                editing && 'rounded-sm ring-1 ring-line-soft',
                dropIndex === i && editing && dragIndex !== null && 'ring-2 ring-amore',
                dragIndex === i && 'opacity-40',
              )}
            >
              {editing && (
                <div className="absolute right-2 top-2 z-resize flex items-center gap-1 border border-line bg-paper/95 px-1.5 py-1 rounded-sm backdrop-blur-sm">
                  <span
                    onPointerDown={(e) => onDragHandleDown(e, i)}
                    onPointerMove={onDragHandleMove}
                    onPointerUp={onDragHandleUp}
                    onPointerCancel={onDragHandleUp}
                    role="button"
                    aria-label="위젯 이동"
                    tabIndex={0}
                    className="cursor-grab touch-none select-none px-1 text-md leading-none text-mute active:cursor-grabbing hover:text-ink-2"
                    title="드래그로 이동"
                  >
                    ⠿
                  </span>
                  <div className="flex items-center">
                    {[1, 2, 3].map((n) => (
                      <ChromeButton
                        key={n}
                        size="sm"
                        variant={w.span === n ? 'primary' : 'default'}
                        aria-label={`폭 ${n}컬럼`}
                        onClick={() => setSpan(i, n)}
                      >
                        {n}
                      </ChromeButton>
                    ))}
                  </div>
                  <IconButton
                    variant="ghost-danger"
                    size="sm"
                    aria-label="위젯 제거"
                    title="제거"
                    onClick={() => removeWidget(i)}
                  >
                    ×
                  </IconButton>
                </div>
              )}

              {def.render(report)}

              {editing && isWide && (
                <div
                  onPointerDown={(e) => onResizePointerDown(e, i)}
                  onPointerMove={onResizePointerMove}
                  onPointerUp={onResizePointerUp}
                  onPointerCancel={onResizePointerUp}
                  role="separator"
                  aria-label="폭 조절"
                  className="absolute right-0 top-1/2 z-resize h-12 w-2 -translate-y-1/2 cursor-ew-resize touch-none rounded-full bg-line-soft hover:bg-amore"
                  title="드래그로 폭 조절"
                />
              )}
            </div>
          );
        })}
      </div>

      {layout.widgets.length === 0 && (
        <div className="flex h-40 items-center justify-center text-md text-mute-soft">
          배치된 위젯이 없습니다.
          {canEdit && ' “보드 편집 → + 위젯 추가”로 위젯을 배치하세요.'}
        </div>
      )}
    </div>
  );
}

function SaveStatus({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  const map: Record<Exclude<SaveState, 'idle'>, { text: string; cls: string }> =
    {
      saving: { text: '저장 중…', cls: 'text-mute-soft' },
      saved: { text: '저장됨 · 모든 기기에 공유', cls: 'text-amore' },
      error: { text: '저장 실패 — 잠시 후 다시 시도됩니다', cls: 'text-warning' },
    };
  const { text, cls } = map[state];
  return <span className={cx('text-xs-soft tabular-nums', cls)}>{text}</span>;
}

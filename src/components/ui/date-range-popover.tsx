/* ────────────────────────────────────────────────────────────────────
   DateRangePopover — 닫힘 상태는 단일 trigger button, 열림 상태는 portal
   popover 안에 preset quick-pick + 2-개월 month-grid 캘린더.

   왜: inline `<input type="date">` 2개를 서브헤더 본문에 펼치면 layout 이
   아래로 밀려 인접 필드(키워드 chip 등)가 내려갔음. popover 로 빼서
   서브헤더 height 를 고정 + 시각 통일.

   API:
     - value      : { from, to } — ISO 'YYYY-MM-DD', '' = 미설정(전체).
     - onChange   : 선택 변경 시 호출. 라이브 반영 (popover 닫지 않아도 적용).
     - presets    : quick-pick 정의. days=null = "전체"(범위 해제).
     - placeholder: from/to 모두 빈 닫힘-라벨 (예: "전체 기간").

   시각: SelectMenu 와 같은 portal + position:fixed escape (widget-shell 의
   overflow:hidden 안에서 잘리지 않도록). design-system 토큰만 사용.
   ──────────────────────────────────────────────────────────────────── */

'use client';

import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '@/components/ui/icon-button';
import { ChromeButton } from '@/components/ui/chrome-button';
import { ControlTriggerChevron } from '@/components/ui/control-trigger';
import { usePopoverBase } from '@/components/ui/use-popover-base';

export type DateRangeValue = { from: string; to: string };
export type DateRangePreset = { label: string; days: number | null };

export type DateRangePopoverProps = {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
  presets?: DateRangePreset[];
  placeholder?: string;
  locale?: string;
  /** 표시할 개월 수 (기본 2). */
  months?: number;
  disabled?: boolean;
  buttonClassName?: string;
};

// ─── date helpers — 로컬 타임 기준 'YYYY-MM-DD' (TZ off-by-one 회피) ──────
function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayLocal(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}
function daysAgo(n: number): Date {
  const d = todayLocal();
  d.setDate(d.getDate() - n);
  return d;
}
function parseIso(s: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function monthCells(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const startDow = first.getDay(); // 0=일
  const total = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
function monthTitle(year: number, month: number, locale: string): string {
  if (locale.startsWith('ko')) return `${year}년 ${month + 1}월`;
  return new Date(year, month, 1).toLocaleDateString('en', {
    month: 'short',
    year: 'numeric',
  });
}

export function DateRangePopover({
  value,
  onChange,
  presets,
  placeholder,
  locale = 'ko',
  months = 2,
  disabled,
  buttonClassName,
}: DateRangePopoverProps) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  // 포털 mount + escape/외부클릭 + trigger rect 추적은 공통 훅. 배치 계산만 로컬.
  const {
    triggerRef: wrapRef,
    panelRef,
    anchorRect: rect,
  } = usePopoverBase<HTMLDivElement, HTMLDivElement>({ open, onClose: close });

  const today = useMemo(() => todayLocal(), []);
  const todayStr = fmt(today);

  // 보이는 좌측 월. value.to → value.from → 오늘 순으로 anchor.
  const [view, setView] = useState(() => {
    const anchor = parseIso(value.to) ?? parseIso(value.from) ?? today;
    return { year: anchor.getFullYear(), month: anchor.getMonth() };
  });

  // 열 때 현재 선택 기준으로 view 동기화 — effect 가 아니라 open 핸들러에서
  // 직접 (effect 안 setState 는 cascading render 경고).
  function openPanel() {
    const anchor = parseIso(value.to) ?? parseIso(value.from) ?? today;
    setView({ year: anchor.getFullYear(), month: anchor.getMonth() });
    setOpen(true);
  }

  // ─── 닫힘 라벨 ───────────────────────────────────────────────────────────
  const summary =
    !value.from && !value.to
      ? (placeholder ?? '전체 기간')
      : `${value.from || '…'} ~ ${value.to || '…'}`;

  // ─── 선택 로직 — 클릭으로 from → to 범위 구성 ────────────────────────────
  function pick(d: Date) {
    const iso = fmt(d);
    if (iso > todayStr) return; // 미래 disabled
    const { from, to } = value;
    if (!from || (from && to)) {
      onChange({ from: iso, to: '' });
    } else if (iso < from) {
      onChange({ from: iso, to: '' });
    } else {
      onChange({ from, to: iso });
    }
  }

  function applyPreset(p: DateRangePreset) {
    if (p.days == null) {
      onChange({ from: '', to: '' });
    } else {
      onChange({ from: fmt(daysAgo(p.days)), to: todayStr });
    }
  }

  function shiftMonth(delta: number) {
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  const weekdays = locale.startsWith('ko')
    ? ['일', '월', '화', '수', '목', '금', '토']
    : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  const visibleMonths = Array.from({ length: months }, (_, i) => {
    const d = new Date(view.year, view.month + i, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  function cellState(iso: string): 'from' | 'to' | 'mid' | 'none' {
    if (value.from && iso === value.from) return 'from';
    if (value.to && iso === value.to) return 'to';
    if (value.from && value.to && iso > value.from && iso < value.to)
      return 'mid';
    return 'none';
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        data-canvas-action
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={
          buttonClassName ??
          'flex h-8 w-full items-center justify-between gap-2 rounded-xs border border-line bg-paper px-2 text-md text-ink hover:border-ink focus-visible:border-amore disabled:opacity-50'
        }
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="truncate tabular-nums">{summary}</span>
        <ControlTriggerChevron />
      </button>

      {open &&
        rect &&
        typeof window !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={placeholder ?? '기간 선택'}
            className="fixed z-overlay rounded-xs border-[2px] border-ink bg-paper p-3 shadow-memphis-md-card"
            style={{
              // 패널 폭 = months × 15rem(240) + gap-4(16)×(months-1) + p-3(24).
              // 우측 뷰포트 넘침 방지로 left 클램프.
              left: Math.max(
                8,
                Math.min(
                  rect.left,
                  window.innerWidth -
                    (months * 240 + (months - 1) * 16 + 24) -
                    8,
                ),
              ),
              top: rect.bottom + 4,
            }}
          >
            {/* preset quick-pick */}
            {presets && presets.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {presets.map((p) => {
                  const active =
                    p.days == null
                      ? !value.from && !value.to
                      : value.to === todayStr &&
                        value.from === fmt(daysAgo(p.days));
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => applyPreset(p)}
                      className={
                        'rounded-pill border px-2.5 py-0.5 text-xs transition-colors ' +
                        (active
                          ? 'border-amore bg-amore text-paper'
                          : 'border-line text-mute hover:border-ink hover:text-ink')
                      }
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* nav */}
            <div className="mb-2 flex items-center justify-between">
              <IconButton
                variant="ghost"
                onClick={() => shiftMonth(-1)}
                aria-label="이전 달"
              >
                ‹
              </IconButton>
              <span className="text-xs font-medium tabular-nums text-ink">
                {visibleMonths
                  .map((m) => monthTitle(m.year, m.month, locale))
                  .join('  ·  ')}
              </span>
              <IconButton
                variant="ghost"
                onClick={() => shiftMonth(1)}
                aria-label="다음 달"
              >
                ›
              </IconButton>
            </div>

            {/* months */}
            <div className="flex gap-4">
              {visibleMonths.map((m) => (
                <div key={`${m.year}-${m.month}`} className="w-[15rem]">
                  <div className="mb-1 grid grid-cols-7 text-center text-xs text-mute-soft">
                    {weekdays.map((w, i) => (
                      <span key={`${w}-${i}`} className="py-1">
                        {w}
                      </span>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-y-0.5">
                    {monthCells(m.year, m.month).map((d, i) => {
                      if (!d)
                        return <span key={`e-${i}`} aria-hidden className="h-8" />;
                      const iso = fmt(d);
                      const future = iso > todayStr;
                      const st = cellState(iso);
                      const isToday = iso === todayStr;
                      const base =
                        'flex h-8 items-center justify-center text-md tabular-nums transition-colors ';
                      const tone = future
                        ? 'cursor-not-allowed text-mute-soft/40'
                        : st === 'from' || st === 'to'
                          ? 'rounded-xs bg-amore font-semibold text-paper'
                          : st === 'mid'
                            ? 'bg-amore-bg text-ink'
                            : isToday
                              ? 'rounded-xs text-amore hover:bg-paper-soft'
                              : 'rounded-xs text-ink hover:bg-paper-soft';
                      return (
                        <button
                          key={iso}
                          type="button"
                          disabled={future}
                          onClick={() => pick(d)}
                          aria-pressed={st === 'from' || st === 'to'}
                          aria-label={iso}
                          className={base + tone}
                        >
                          {d.getDate()}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* footer — 현재 선택 + 완료 */}
            <div className="mt-3 flex items-center justify-between border-t border-ink/10 pt-2">
              <span className="text-xs tabular-nums text-mute">{summary}</span>
              <ChromeButton
                variant="default"
                size="xs"
                onClick={() => setOpen(false)}
              >
                완료
              </ChromeButton>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

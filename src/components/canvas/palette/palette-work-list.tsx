'use client';

/* ────────────────────────────────────────────────────────────────────
   PaletteWorkList — 타일 아래로 펼쳐지는 작업 목록. CD SSOT:
   `canvas-modular/full/README.md` §4.3 + 장면 P1a.

   언제 열리나: **위치가 2개 이상**인 타일을 누르거나 개수 칩(▾)을 누를 때.
   위치가 1개면 펼치지 않고 바로 그 위치로 간다(§6 누르기 규칙 — 시스템이
   대신 고르지 않는다).

   행 구성(§4.3): 높이 40 · 점 6 + 위치 이름 12/600 + 상태 10.5(시그널 fg)
   + →. 정렬은 P5 ③ 우선순위를 따르고(모델이 이미 정렬해 내려준다) 최대
   5행이며 넘치면 "외 n건" 한 행. 완료된 실행은 **넣지 않고** 맨 아래
   "지난 실행은 라이브러리에서" 링크로 대신한다.

   프레젠테이션 전용 — 행을 누르면 호출부가 P1b(팬 + 링) 또는 풀뷰 열기를
   한다. 접힘 상태에서는 같은 행 구성이 레일 오른쪽 팝오버로 나간다(§4.1).
   ──────────────────────────────────────────────────────────────────── */

import { toneOf, type WidgetLocation } from './palette-model';

/** §4.3 — 최대 5행, 넘치면 "외 n건" 한 행. */
export const WORK_LIST_MAX_ROWS = 5;

const DOT: Record<string, string> = {
  ok: 'bg-soft-ok-dot',
  run: 'bg-soft-run-dot',
  warn: 'bg-soft-warn-dot',
  err: 'bg-soft-err-dot',
  idle: 'bg-soft-faint',
};

const FG: Record<string, string> = {
  ok: 'text-soft-ok-fg',
  run: 'text-soft-run-fg',
  warn: 'text-soft-warn-fg',
  err: 'text-soft-err-fg',
  idle: 'text-soft-mute',
};

export type WorkListRow = {
  location: WidgetLocation;
  /** 위치 이름 — 레인이면 "체인 1 · 3단계", 풀뷰면 "풀뷰 · {라벨}". */
  title: string;
  /** 상태 한 줄 — P5 우선순위 단어 + 사유. */
  status: string;
};

export function PaletteWorkList({
  rows,
  selectedId,
  moreLabel,
  libraryLabel,
  onSelect,
}: {
  rows: readonly WorkListRow[];
  /** 포커스된 행 — bg `--fill`(§4.3). */
  selectedId: string | null;
  /** 5행을 넘긴 나머지 건수 문구. 넘치지 않으면 null. */
  moreLabel: string | null;
  libraryLabel: string;
  onSelect: (location: WidgetLocation) => void;
}) {
  return (
    <div
      data-palette-work-list
      style={{ gap: 2, padding: 6 }}
      className="flex flex-col border-t border-soft-hair"
    >
      {rows.map((row) => {
        const tone = toneOf(row.location.status);
        const selected = selectedId === row.location.id;
        return (
          // eslint-disable-next-line react/forbid-elements -- 작업 목록 행은 높이 40 · 점 6 + 2줄 텍스트 + → 의 메뉴-행 chrome 이다(§4.3). Button primitive 의 캡슐 chrome 은 행 읽기를 깨뜨린다 — dropdown-menu·sidebar-nav 와 동일한 행-버튼 선례.
          <button
            key={row.location.id}
            type="button"
            data-palette-work-row={row.location.id}
            onClick={() => onSelect(row.location)}
            style={{ height: 40, gap: 8, padding: '0 8px' }}
            className={`palette-tile-handle flex items-center rounded-nav text-left focus-visible:outline-none ${
              selected ? 'bg-soft-fill' : ''
            }`}
          >
            <span
              aria-hidden
              style={{ width: 6, height: 6 }}
              className={`shrink-0 rounded-full ${DOT[tone]} ${
                row.location.status === 'running' ? 'palette-pulse' : ''
              }`}
            />
            <span style={{ gap: 1 }} className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-md font-semibold text-ink">
                {row.title}
              </span>
              <span className={`truncate text-xs-soft ${FG[tone]}`}>
                {row.status}
              </span>
            </span>
            <span aria-hidden className="text-sm text-soft-faint">
              →
            </span>
          </button>
        );
      })}
      {moreLabel && (
        <span
          style={{ height: 40, padding: '0 8px' }}
          className="flex items-center text-md text-soft-mute"
        >
          {moreLabel}
        </span>
      )}
      <span
        style={{ padding: '6px 8px 4px' }}
        className="text-sm text-soft-mute"
      >
        {libraryLabel}
      </span>
    </div>
  );
}

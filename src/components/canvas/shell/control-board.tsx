/* ────────────────────────────────────────────────────────────────────
   ControlBoard — canvas 위젯의 상단 main control 영역 SSOT.

   6 위젯 (recruiting / desk / quotes / probing / translate / interviews)
   의 control board 가 padding · spacing · separator 가 제각각이라 시각
   리듬이 깨지던 문제 → 공통 4-layer 컴포넌트로 통일.

   구성:
     <ControlBoard>
       <ControlBoard.StatsRow>  ─ 옵션. 누적 메트릭 (검정 굵은 숫자)
       <ControlBoard.SettingsRow> ─ 옵션. dropdown / pill / checkbox row
       <ControlBoard.Input>      ─ main 입력 영역 (textarea / dropzone / chip)
       <ControlBoard.Action>     ─ 핵심 CTA — 기본 우측 정렬
     </ControlBoard>

   각 layer 의 outer 는 `px-5` + (top 제외) `border-t border-line-soft`
   로 통일. 라벨/필드 inner 는 PR #494 의 Field / SectionLabel 을 그대로
   재사용 — ControlBoard 는 outer 만 책임.

   사용자별 element ordering 은 자유 — 어떤 layer 든 생략 가능.
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';

type ControlBoardProps = {
  children: ReactNode;
  // 컨테이너 외곽선. 기본은 borderless — 위젯 본문 안에서는 widget-shell
  // framed body 안에 들어가므로 추가 외곽선이 필요 없다. 단독 카탈로그
  // demo / 임베드 시에만 'framed' 로 강조.
  framed?: boolean;
  className?: string;
};

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function ControlBoardRoot({ children, framed, className }: ControlBoardProps) {
  return (
    <div
      className={cx(
        'flex flex-col',
        framed && 'border border-line bg-paper rounded-sm overflow-hidden',
        className,
      )}
      data-ds-primitive="ControlBoard"
    >
      {children}
    </div>
  );
}

type LayerProps = {
  children: ReactNode;
  className?: string;
  // 같은 ControlBoard 안에서 두 번째 이후 layer 는 상단 separator 가 필요.
  // 첫 layer 에만 separator 를 끄려고 명시 — `divider="none"`.
  divider?: 'top' | 'none';
};

function StatsRow({ children, className, divider = 'none' }: LayerProps) {
  // StatsRow 는 보통 control board 의 맨 위에 오므로 기본 separator 없음.
  // 내부는 3 등분 grid + 우측 divider — quotes 의 StatTile 패턴 SSOT.
  return (
    <div
      className={cx(
        'grid grid-cols-3 divide-x divide-line-soft',
        divider === 'top' && 'border-t border-line-soft',
        'border-b border-line-soft',
        className,
      )}
    >
      {children}
    </div>
  );
}

type StatTileProps = {
  label: ReactNode;
  value: ReactNode;
};

function StatTile({ label, value }: StatTileProps) {
  return (
    <div className="px-5 py-3">
      <div className="text-xs text-mute-soft">{label}</div>
      <div className="mt-0.5 text-2xl font-medium text-ink">{value}</div>
    </div>
  );
}

function SettingsRow({ children, className, divider = 'none' }: LayerProps) {
  // 모든 settings (pill toggle / dropdown / chip / checkbox) 를 한 줄로.
  // items-end 정렬 — label + 입력 element 가 baseline 정렬되도록.
  return (
    <div
      className={cx(
        'flex flex-wrap items-end gap-3 px-5 py-4',
        divider === 'top' && 'border-t border-line-soft',
        className,
      )}
    >
      {children}
    </div>
  );
}

function InputLayer({ children, className, divider = 'top' }: LayerProps) {
  // main 입력 (textarea / dropzone / chip input / transcript display).
  // 기본 separator on — SettingsRow 또는 StatsRow 와 시각 분리.
  return (
    <div
      className={cx(
        'px-5 py-4',
        divider === 'top' && 'border-t border-line-soft',
        className,
      )}
    >
      {children}
    </div>
  );
}

function ActionRow({ children, className, divider = 'top' }: LayerProps) {
  // 핵심 CTA — 기본 우측 정렬. 위젯에 따라 inline 또는 full-width.
  return (
    <div
      className={cx(
        'flex flex-wrap items-center justify-end gap-3 px-5 py-4',
        divider === 'top' && 'border-t border-line-soft',
        className,
      )}
    >
      {children}
    </div>
  );
}

export const ControlBoard = Object.assign(ControlBoardRoot, {
  StatsRow,
  StatTile,
  SettingsRow,
  Input: InputLayer,
  Action: ActionRow,
});

export type { ControlBoardProps, LayerProps, StatTileProps };

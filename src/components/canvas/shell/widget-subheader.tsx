/* ────────────────────────────────────────────────────────────────────
   WidgetSubHeader — canvas 위젯 본문 상단의 설정/CTA 서브헤더 SSOT.

   3 위젯 (translate / probing / desk) 의 설정 영역이 layout · spacing ·
   정렬이 제각각이라 인지 부담이 컸음. 같은 종류 (inputs + setting + CTA)
   를 일관된 좌중우 3 슬롯 + 선택적 hint row 로 통일.

   슬롯:
     - inputs  (좌): 캡처/언어/키워드 같은 핵심 입력 (Field 묶음, 1~4)
     - options (중): 저장 체크박스 / 가이드 버튼 / 옵션 토글 (0~3)
     - actions (우): 진행 시계 + 보조 IconButton + 핵심 CTA (1~3)
     - hint    (아래 줄): 안내문 / 상태 — border-t border-ink/10 로 분리

   시각:
     - 외곽: border-b-[2px] border-ink (Memphis 분리)
     - 배경: bg-paper-soft (위젯 본문과 살짝 구분)
     - 패딩: px-5 py-3 (widget-shell px-5 와 같은 좌우 리듬)
     - hint: border-t border-ink/10 + px-5 py-1.5 text-xs text-mute

   회귀:
     - 호출부의 이벤트/state/로직은 0 영향. 시각만 규격화.
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';

export type WidgetSubHeaderProps = {
  // 좌 — 핵심 입력 (캡처/언어/키워드/지역/기간 등). Field 묶음 권장.
  inputs?: ReactNode;
  // 중 — 부가 옵션 (저장 체크박스 / 가이드 버튼 / 토글 등).
  options?: ReactNode;
  // 우 — CTA + 보조 액션 (세션 시작/중지, IconButton, 진행 시계).
  actions?: ReactNode;
  // 아래 줄 — 안내문 / 라이브 상태. 한 줄 짧은 텍스트 권장.
  hint?: ReactNode;
  className?: string;
};

export function WidgetSubHeader({
  inputs,
  options,
  actions,
  hint,
  className,
}: WidgetSubHeaderProps) {
  const rowClassName = [
    'border-b-[2px] border-ink bg-paper-soft',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <header className={rowClassName}>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 px-5 py-3">
        {/* 좌 — inputs (Field 묶음). 좁아지면 wrap. */}
        {inputs && (
          <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
            {inputs}
          </div>
        )}

        {/* 중 — options (체크박스/옵션/가이드). */}
        {options && (
          <div className="flex shrink-0 items-center gap-3">{options}</div>
        )}

        {/* 우 — actions (CTA + 보조). */}
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>

      {hint && (
        <div className="border-t border-ink/10 px-5 py-1.5 text-xs text-mute">
          {hint}
        </div>
      )}
    </header>
  );
}

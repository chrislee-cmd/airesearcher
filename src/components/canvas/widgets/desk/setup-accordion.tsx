'use client';

/* ────────────────────────────────────────────────────────────────────
   DeskSetupAccordion — 데스크 V2 세팅 4스텝 아코디언 (CD 파일럿 #2, fresh build).

   WIDGET-SHELL §AUTHORITY §D: CD `.dc.html` 대로 신규 작성한 프레젠테이션
   컴포넌트 (옛 control-panel 계열 재사용 X). 로직/폼은 소비처(desk-setup-body)가
   주입 — 이 파일은 순수 레이아웃.

   CD 목업 setup 카드 = binary open ↔ collapsed 2상태("All Open" / "All
   Collapsed"). WIDGET-SHELL §S1 스텝 레일 class map:
   - 레일: 세로선 left · 2px ink/12% → `w-0.5 bg-ink/10`
   - 노드 26px 원: active `bg-ink text-white` · done `bg-success text-white` ·
     todo `bg-ink/5 text-mute` (size-6 = 24px, canvas 토큰 그리드 근사)
   - 스텝 제목: 14.5/800 → `text-lg font-extrabold text-ink` (canvas cascade 가
     text-xl+ 를 26px 로 강제하므로 cascade-생존 토큰 text-lg 사용)
   - collapsed 요약 행: done 노드 + `STEP 0N · 라벨` + 값 + 변경 (bg-signal-
     success-bg / border-signal-success-line tint = §S1)
   raw hex/px 0 (check:design).
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export type DeskStepDef = {
  n: number;
  title: string;
  summaryLabel: string;
  summaryValue: ReactNode;
  done: boolean;
  children: ReactNode;
};

function StepNode({
  n,
  variant,
}: {
  n: number;
  variant: 'active' | 'done' | 'todo';
}) {
  const cls =
    variant === 'active'
      ? 'bg-ink text-white'
      : variant === 'done'
        ? 'bg-success text-white'
        : 'bg-ink/5 text-mute';
  return (
    <span
      aria-hidden
      className={`flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${cls}`}
    >
      {variant === 'done' ? '✓' : n}
    </span>
  );
}

export function DeskSetupAccordion({
  steps,
  collapsed,
  onCollapse,
  onExpand,
  changeLabel,
}: {
  steps: DeskStepDef[];
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  changeLabel: string;
}) {
  if (collapsed) {
    // ── 접힘: 4 요약 행 (done 노드 + 라벨/값 + 변경) ──
    return (
      <div className="relative flex flex-col gap-2.5 pl-9">
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-3 left-2.5 top-3 w-0.5 bg-ink/10"
        />
        {steps.map((s) => (
          <div
            key={s.n}
            className="relative flex items-center gap-3 rounded-chrome border border-signal-success-line bg-signal-success-bg px-3 py-2"
          >
            <span className="absolute -left-9 flex items-center">
              <StepNode n={s.n} variant={s.done ? 'done' : 'todo'} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs uppercase tracking-[0.18em] text-mute-soft">
                {s.summaryLabel}
              </div>
              <div className="mt-0.5 truncate text-md font-semibold text-ink">
                {s.summaryValue}
              </div>
            </div>
            <Button
              variant="link"
              size="xs"
              onClick={onExpand}
              className="shrink-0"
            >
              {changeLabel}
            </Button>
          </div>
        ))}
      </div>
    );
  }

  // ── 열림(기본): 세로 레일 + 번호 노드 + 제목 + 폼 ──
  // 빈 영역(컨테이너 자기 자신) 클릭 → 접힘. 폼 자식 클릭은 버블 대상이
  // 아니므로(target !== currentTarget) 접히지 않는다.
  return (
    <div
      className="relative flex flex-col gap-6 pl-9"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCollapse();
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-3 left-2.5 top-2 w-0.5 bg-ink/10"
      />
      {steps.map((s) => (
        <div key={s.n} className="relative">
          <span className="absolute -left-9 top-0 flex items-center">
            <StepNode n={s.n} variant="active" />
          </span>
          <div className="mb-2.5 text-lg font-extrabold leading-tight text-ink">
            {s.title}
          </div>
          {s.children}
        </div>
      ))}
    </div>
  );
}

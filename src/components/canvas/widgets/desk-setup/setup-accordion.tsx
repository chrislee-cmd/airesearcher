'use client';

/* ────────────────────────────────────────────────────────────────────
   DeskSetupAccordion — 데스크 리서치 V2 세팅 4스텝 아코디언 (CD 파일럿 #2).

   디자인 SSOT: `design-handoff/desk/`(HANDOFF·BUILD-SPEC·.dc.html) +
   `design-handoff/WIDGET-SHELL.md §S1`(스텝 레일 class map). CD 목업의 setup
   카드는 **binary open ↔ collapsed** 2상태다("All Open" / "All Collapsed"
   컬럼) — per-step 개별 아코디언이 아니라 전체 열림/접힘 토글.

   - open(기본, all-open): 세로 레일 + 번호 노드(active 룩) + 스텝 제목 + 입력.
   - collapsed: 4 요약 행(done ✓ 노드 + `STEP 0N · 라벨` + 값 + `변경` 링크).
     빈 영역 클릭 → 접힘 / `변경` → 다시 열림 (CD 인터랙션은 §4 demo-only 라
     프레젠테이션 어포던스로만 구현; 기본 상태 = all-open 이 항상 정답).

   토큰 SSOT: `WIDGET-SHELL §S1`. 노드 26px→size-6(24, 토큰 그리드 근사) ·
   레일 2px ink/12% → `w-0.5 bg-ink/10` · active `bg-ink text-white` · done
   `bg-success text-white` · 제목 `text-xl font-extrabold text-ink`. raw
   hex/px 0 (check:design 게이트).
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export type DeskStepDef = {
  // 1-based 스텝 번호 (레일 노드에 노출).
  n: number;
  // 스텝 제목 (open 시 노출).
  title: string;
  // 접힘 요약 라벨 — `STEP 01 · Project` 형태 (호출부가 조합).
  summaryLabel: string;
  // 접힘 요약 값 — 아이콘 + 텍스트 등. 미입력 스텝은 mute 힌트.
  summaryValue: ReactNode;
  // 이 스텝 입력이 채워졌는지 — 접힘 노드를 done(✓) vs todo 로 가른다.
  done: boolean;
  // open 시 노출되는 입력 컨트롤 (기존 primitive 조합 — 호출부 소유).
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
  // "변경" 링크 카피 (i18n, 호출부 소유).
  changeLabel: string;
}) {
  if (collapsed) {
    // ── 접힘: 4 요약 행 (done 노드 + 라벨/값 + 변경) ──
    return (
      <div className="relative flex flex-col gap-4 pl-9">
        {/* 세로 레일 — 노드들을 관통. */}
        <span
          aria-hidden
          className="absolute bottom-2 left-2.5 top-2 w-0.5 bg-ink/10"
        />
        {steps.map((s) => (
          <div key={s.n} className="relative flex items-center gap-3">
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

  // ── 열림(기본): 세로 레일 + 번호 노드 + 제목 + 입력 ──
  // 빈 영역(컨테이너 자기 자신) 클릭 → 접힘. 입력 자식 클릭은 버블 대상이
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
          <div className="mb-2.5 text-xl font-extrabold leading-tight text-ink">
            {s.title}
          </div>
          {s.children}
        </div>
      ))}
    </div>
  );
}

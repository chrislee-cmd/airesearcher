'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainReportNode — 체인의 끝(산출물 노드). CD SSOT: `v3/README.md` Geometry
   (내부 값은 `v2/README.md` S6 그대로, **크기만 실치수 320×220**).

   인터뷰 분석과 탑라인은 **같은 위젯**이 맡으므로 카드 하나에서 나가는 마지막
   엣지는 카드가 아니라 이 노드로 들어간다. 체인이 있는 동안만 렌더한다.

   v2 는 오버레이에 절대배치(left/top)였지만 v3 는 **레인 본문의 흐름 요소**다 —
   absolute 로 두면 감싼 칸이 0폭으로 접혀 세그먼트와 겹친다(실측).

   Soft Identity (캔버스 모듈화 Phase 1): 색·선·그림자·서체만 갈아탄다. 완료는
   1px `--line` + `--sh-card`, 대기는 1.5 dashed `--line-hover`, 헤더 띠는
   원색 rose 대신 `--tint-rose`(넓은 면 = 틴트, 핵심규칙 3). 치수 불변(제약 1).
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';

export const REPORT_NODE_WIDTH = 320;
export const REPORT_NODE_HEIGHT = 220;

export type ChainReportNodeProps = {
  state: 'pending' | 'done';
};

export function ChainReportNode({ state }: ChainReportNodeProps) {
  const t = useTranslations('Chain');
  const done = state === 'done';
  return (
    <div
      data-chain="report-node"
      data-chain-report={state}
      style={{ width: REPORT_NODE_WIDTH, height: REPORT_NODE_HEIGHT }}
      className={`flex shrink-0 flex-col overflow-hidden rounded-panel bg-soft-surface ${
        done
          ? 'border-[2.5px] border-soft-line shadow-soft-card'
          : 'border-[1.5px] border-dashed border-soft-line-hover'
      }`}
    >
      <div
        className={
          done
            ? 'border-b-2 border-soft-hair bg-tint-rose px-5 py-[14px]'
            : 'border-b-[1.5px] border-dashed border-soft-line-hover bg-soft-surface px-5 py-[14px]'
        }
      >
        <span
          // Soft 디스플레이 서체(Bricolage). 한글은 Pretendard 폴백 = 의도.
          style={{ fontFamily: 'var(--font-display)' }}
          className={`text-2xl font-bold ${done ? 'text-ink' : 'text-soft-faint'}`}
        >
          {t('steps.topline')}
        </span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <div
          className={`flex h-14 w-14 items-center justify-center rounded-control text-3xl font-bold ${
            done
              ? 'bg-soft-ok-bg text-soft-ok-fg'
              : 'border-[1.5px] border-dashed border-soft-line-hover bg-soft-surface text-soft-faint'
          }`}
        >
          <span aria-hidden>{done ? '✓' : ''}</span>
        </div>
        <div
          className={`text-xl font-semibold ${done ? 'text-soft-ok-fg' : 'text-soft-faint'}`}
        >
          {t(done ? 'report.ready' : 'report.waiting')}
        </div>
      </div>
    </div>
  );
}

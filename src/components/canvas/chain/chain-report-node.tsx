'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainReportNode — 체인의 끝(산출물 노드). CD SSOT: `v2/README.md` S6.

   인터뷰 분석과 탑라인은 **같은 위젯**이 맡으므로 카드 하나에서 나가는 마지막
   엣지는 카드가 아니라 이 노드로 들어간다. 체인이 있는 동안만 렌더한다.
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';

export const REPORT_NODE_WIDTH = 200;
export const REPORT_NODE_HEIGHT = 150;

export type ChainReportNodeProps = {
  state: 'pending' | 'done';
  /** surface 좌표. 마지막 카드와 상단을 맞춘다. */
  left: number;
  top: number;
};

export function ChainReportNode({ state, left, top }: ChainReportNodeProps) {
  const t = useTranslations('Chain');
  const done = state === 'done';
  return (
    <div
      data-chain="report-node"
      data-chain-report={state}
      style={{ left, top, width: REPORT_NODE_WIDTH, height: REPORT_NODE_HEIGHT }}
      className={`absolute flex flex-col overflow-hidden rounded-panel bg-paper ${
        done
          ? 'border-[2.5px] border-ink shadow-popover'
          : 'border-[1.5px] border-dashed border-line-empty'
      }`}
    >
      <div
        className={
          done
            ? 'border-b-2 border-ink bg-rose px-3 py-[9px]'
            : 'border-b-[1.5px] border-dashed border-line-empty bg-paper px-3 py-[9px]'
        }
      >
        <span
          // 카드 제목과 같은 Outfit 디스플레이 서체(widget-shell 헤더 밴드와 동일
          // 방식 — 전용 유틸이 없어 토큰 var 참조).
          style={{ fontFamily: 'var(--font-outfit), var(--font-sans)' }}
          className={`text-lg font-extrabold ${done ? 'text-ink' : 'text-mute-soft'}`}
        >
          {t('steps.topline')}
        </span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-[7px]">
        <div
          className={`flex h-[34px] w-[34px] items-center justify-center rounded-control text-2xl font-extrabold ${
            done
              ? 'border-2 border-ink bg-success-bg text-success shadow-memphis-md-success'
              : 'border-[1.5px] border-dashed border-line-empty bg-paper text-faint'
          }`}
        >
          <span aria-hidden>{done ? '✓' : ''}</span>
        </div>
        <div
          className={`text-sm font-extrabold ${done ? 'text-success-text' : 'text-faint'}`}
        >
          {t(done ? 'report.ready' : 'report.waiting')}
        </div>
      </div>
    </div>
  );
}

'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainReportNode — 체인의 끝(산출물 노드). CD SSOT: 체인 인스펙터
   `chain-inspector-scenes.dc.html` I0 (**112×140**) + §2 레인 폭 공식
   ("패딩 24×2 + 카드 240×n + 세그먼트 96×n + **산출물 112**").

   카드가 604×900 → 240×300 으로 줄면서 320×220 노드가 카드보다 커지는 역전이
   생겼다. CD 가 레인 폭 공식에 112 를 못박았으므로 그 값을 따른다 — 내부
   구조(헤더 띠 + 글리프 + 상태)는 112 폭에 담기지 않아 **컴프 I0 의 구성**
   (톤 타일 28 + 이름 11.5 + 상태 10.5, 가운데 정렬)으로 바뀐다.

   인터뷰 분석과 탑라인은 **같은 위젯**이 맡으므로 카드 하나에서 나가는 마지막
   엣지는 카드가 아니라 이 노드로 들어간다. 체인이 있는 동안만 렌더한다.

   v2 는 오버레이에 절대배치(left/top)였지만 v3 는 **레인 본문의 흐름 요소**다 —
   absolute 로 두면 감싼 칸이 0폭으로 접혀 세그먼트와 겹친다(실측).

   Soft Identity (캔버스 모듈화 Phase 1): 색·선·그림자·서체만 갈아탄다. 완료는
   1px `--line` + `--sh-card`, 대기는 1.5 dashed `--line-hover`, 헤더 띠는
   원색 rose 대신 `--tint-rose`(넓은 면 = 틴트, 핵심규칙 3). 치수 불변(제약 1).
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';

export const REPORT_NODE_WIDTH = 112;
export const REPORT_NODE_HEIGHT = 140;

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
      className={`flex shrink-0 flex-col items-center justify-center gap-1.5 rounded-panel bg-soft-surface px-2 text-center ${
        done
          ? 'border border-soft-line shadow-soft-card'
          : 'border-[1.5px] border-dashed border-soft-line-hover'
      }`}
    >
      <span
        aria-hidden
        style={{ width: 28, height: 28 }}
        className={`flex shrink-0 items-center justify-center rounded-nav text-md font-bold ${
          done ? 'bg-soft-ok-bg text-soft-ok-fg' : 'bg-tint-rose text-soft-rose-text'
        }`}
      >
        {done ? '\u2713' : ''}
      </span>
      <span
        className={`text-sm font-semibold ${done ? 'text-ink' : 'text-soft-mute'}`}
      >
        {t('steps.topline')}
      </span>
      <span
        className={`text-xs-soft ${done ? 'text-soft-ok-fg' : 'text-soft-faint'}`}
      >
        {t(done ? 'report.ready' : 'report.waiting')}
      </span>
    </div>
  );
}

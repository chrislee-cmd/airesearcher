'use client';

/* ────────────────────────────────────────────────────────────────────
   CompletedCTA — 위젯 본문 하단(옛 WidgetOutputs 자리)의 "작업이
   완료되었습니다" 완료 CTA 푸터.

   PR #574 (하단 산출물 푸터 제거) 후 완료 시각 신호가 사라져, 산출물이
   fullview 안에만 노출되면서 사용자가 "끝났는지" 알기 어려워진 회귀를
   해소한다. 산출물이 1건 이상 완료되면 이 CTA 가 노출되고, 클릭하면
   각 위젯의 공유 fullview modal 이 열려 그 안에서 산출물을 확인한다.

   - 완료 톤 = mint(초록) — 헤더 done pill(mint)과 색 통일.
   - ✓ 아이콘은 mint 칩 안에 담아 paper 위에서도 대비 확보 (mint stroke
     단독은 저대비).
   - count > 1 이면 [N] 배지 (단건이면 배지 없이 문구만).
   - 최초 완료(=마운트) 순간 3초 pulse 로 attention. CTA 는 완료
     상태에서만 마운트되므로 mount = "처음 완료된 순간".
   - 프레젠테이션 전용 — i18n 문자열은 호출부가 주입 (WidgetOutputs 와
     동일 패턴).
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from 'react';

// 완료 ✓ glyph. 명시 size className + aria-hidden 으로 a11y 통과 (버튼은
// 자체 텍스트로 라벨됨, SVG 는 장식).
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 8.5L6.5 11.5L12.5 4.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CompletedCTA({
  label,
  viewAllLabel,
  count,
  onClick,
}: {
  // "작업이 완료되었습니다" (호출부가 useTranslations('Widgets') 로 주입).
  label: string;
  // "전체 보기 →".
  viewAllLabel: string;
  // 산출물 개수 (선택). 2건 이상일 때만 배지 노출.
  count?: number;
  // 클릭 시 해당 위젯 fullview modal 열기.
  onClick: () => void;
}) {
  // 마운트(=최초 완료) 시 3초 pulse 후 자동 해제. 산출물 전체 삭제 →
  // 재완료 시 CTA 가 재마운트되어 다시 pulse.
  const [pulse, setPulse] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setPulse(false), 3000);
    return () => clearTimeout(id);
  }, []);

  const showBadge = typeof count === 'number' && count > 1;

  return (
    <div className="mt-auto shrink-0 border-t-[2px] border-ink bg-paper-soft px-5 py-3">
      {/* eslint-disable-next-line react/forbid-elements -- 완료 CTA: 풀-폭
          justify-between 복합 레이아웃(✓칩+라벨+count 배지 / 전체보기)이라
          Button primitive variant 에 매핑되지 않음. data-canvas-action 으로
          canvas [data-canvas-body] cascade opt-out (Button/IconButton 과 동일). */}
      <button
        type="button"
        onClick={onClick}
        data-canvas-action
        className={
          'flex w-full items-center justify-between gap-3 rounded-sm border-[2px] border-ink bg-paper px-4 py-3 text-md font-semibold text-ink shadow-[3px_3px_0_black] transition-all duration-[120ms] hover:-translate-x-px hover:-translate-y-px hover:bg-mint hover:shadow-[4px_4px_0_black] active:translate-x-0 active:translate-y-0 active:shadow-[1px_1px_0_black]' +
          (pulse ? ' completed-cta-pulse' : '')
        }
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-xs border-[1.5px] border-ink bg-mint">
            <CheckIcon className="h-3 w-3 text-ink" />
          </span>
          <span className="truncate">{label}</span>
          {showBadge && (
            <span className="shrink-0 rounded-xs bg-ink px-1.5 py-0.5 text-xs font-bold text-paper tabular-nums">
              {count}
            </span>
          )}
        </span>
        <span className="shrink-0 text-xs uppercase tracking-[0.18em] text-mute">
          {viewAllLabel}
        </span>
      </button>
    </div>
  );
}

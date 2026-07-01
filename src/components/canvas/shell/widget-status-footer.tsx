'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetStatusFooter — 위젯 본문 하단(옛 WidgetOutputs 자리)의 작업 상태
   푸터. 현재 작업 lifecycle 에 따라 문구·디자인이 바뀐다.

   PR #574 (하단 산출물 푸터 제거) 후 완료 시각 신호가 사라진 회귀 해소.
   단순 "완료된 산출물 존재" 신호는 이전 완료본이 남아 있으면 새 작업
   업로드 직후에도 "완료" 로 오인되던 문제가 있어, 진행중 ↔ 완료 두
   상태를 구분한다.

   - status='running' → 진행중 톤(amore) + 맥동 도트 + 비클릭(상태 표시).
     예: "전사가 진행중입니다".
   - status='done'    → 완료 톤(mint) + ✓ 칩 + offset shadow 로 융기된
     클릭 가능 버튼. 클릭 시 fullview 진입. 예: "전사가 완료되었습니다".
   - done 을 한 번 클릭(=fullview 진입)하면 사라진다. 새 산출물 완료
     (`resetKey` 변화) 시 다시 노출 + pulse — 후속 완료도 신호를 잃지
     않는다.
   - done 에서 count > 1 이면 [N] 배지.
   - 프레젠테이션 전용 — i18n 문자열/상태는 호출부가 주입.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from 'react';

// 완료 ✓ glyph. 명시 size className + aria-hidden 으로 a11y 통과.
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

export type WidgetStatusFooterStatus = 'running' | 'done';

export function WidgetStatusFooter({
  status,
  label,
  viewAllLabel,
  count,
  onClick,
  resetKey,
}: {
  // 현재 작업 상태. running = 진행중(비클릭 상태 표시), done = 완료(클릭 → fullview).
  status: WidgetStatusFooterStatus;
  // 상태에 맞는 문구 (호출부가 useTranslations 로 주입). 예: "전사가 진행중입니다".
  label: string;
  // done 상태 우측 "전체 보기 →".
  viewAllLabel: string;
  // done 산출물 개수 (선택). 2건 이상일 때만 배지.
  count?: number;
  // done 클릭 시 해당 위젯 fullview modal 열기.
  onClick: () => void;
  // 완료 산출물의 안정 식별자 (완료 건수 / 최신 job id 등). 값이 바뀌면
  // = 새 산출물 완료 → dismiss 해제 + pulse 재생. running→done 전이도
  // resetKey 로 감지되어 done 푸터가 다시 노출된다.
  resetKey?: string | number;
}) {
  // done 을 클릭(=fullview 진입)하면 사라짐. resetKey 변화 시 다시 노출.
  const [dismissed, setDismissed] = useState(false);
  // done 노출/재노출 시 3초 pulse 후 자동 해제.
  const [pulse, setPulse] = useState(true);

  const prevKey = useRef(resetKey);
  useEffect(() => {
    if (resetKey !== prevKey.current) {
      prevKey.current = resetKey;
      setDismissed(false);
      setPulse(true);
    }
  }, [resetKey]);

  useEffect(() => {
    if (status !== 'done' || !pulse) return;
    const id = setTimeout(() => setPulse(false), 3000);
    return () => clearTimeout(id);
  }, [status, pulse]);

  // ── 진행중 — amore 톤 flat 상태 표시. dismiss 개념 없음(항상 노출).
  if (status === 'running') {
    return (
      <div className="mt-auto shrink-0 border-t-[2px] border-ink bg-amore-bg px-5 py-3">
        <div className="flex w-full items-center gap-2 rounded-sm border-[2px] border-amore bg-paper px-4 py-3 text-md font-semibold text-ink">
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
            <span
              aria-hidden
              className="h-2.5 w-2.5 animate-pulse rounded-full bg-amore"
            />
          </span>
          <span className="truncate">{label}</span>
        </div>
      </div>
    );
  }

  // ── 완료 — mint 톤 융기 버튼, 클릭 → fullview + dismiss.
  if (dismissed) return null;

  const showBadge = typeof count === 'number' && count > 1;

  return (
    <div className="mt-auto shrink-0 border-t-[2px] border-ink bg-paper-soft px-5 py-3">
      {/* eslint-disable-next-line react/forbid-elements -- 완료 CTA: 풀-폭
          justify-between 복합 레이아웃(✓칩+라벨+count 배지 / 전체보기)이라
          Button primitive variant 에 매핑되지 않음. data-canvas-action 으로
          canvas [data-canvas-body] cascade opt-out (Button/IconButton 과 동일). */}
      <button
        type="button"
        onClick={() => {
          onClick();
          setDismissed(true);
        }}
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

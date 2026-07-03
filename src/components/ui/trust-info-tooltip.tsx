'use client';

/* ────────────────────────────────────────────────────────────────────
   TrustInfoTooltip — 파일 리스트 헤더 옆 ℹ️ 아이콘. hover / keyboard focus
   시 "신뢰도 보장" 5-bullet 요약을 popover 로 띄운다.

   인터뷰 V2 신뢰도 UX 실험 옵션 C(최소): 옛 UI 를 그대로 두고 아이콘 하나만
   추가해 시각 잡음을 최소화한다. 정적 텍스트만 렌더 — backend 호출 없음.

   citation-popover 와 같은 portal + position:fixed 패턴으로 aside 의
   overflow-y-auto 안에서 잘리지 않게 한다. radix 미설치 프로젝트라 hover/focus
   를 직접 배선한다. design-system 토큰만 사용.
   ──────────────────────────────────────────────────────────────────── */

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';

// 패널 폭 — 뷰포트가 좁으면 좌우 0.5rem 여백만 남기고 축소.
const PANEL_W = 288; // = 18rem (max-w-xs)
const GAP = 6; // trigger 와 패널 사이 간격

export function TrustInfoTooltip() {
  const t = useTranslations('InterviewsV2');
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // 열려 있는 동안 trigger 위치를 추적해 패널을 재배치 (스크롤/리사이즈 대응).
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      const vw = window.innerWidth;
      const w = Math.min(PANEL_W, vw - 16);
      // 좌우 클램프 — trigger 좌측 정렬 기준, 뷰포트 넘침 방지.
      const left = Math.max(8, Math.min(r.left, vw - w - 8));
      setPos({ left, top: r.bottom + GAP });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  const bullets = [
    t('trustBullet1'),
    t('trustBullet2'),
    t('trustBullet3'),
    t('trustBullet4'),
    t('trustBullet5'),
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={t('trustAria')}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex cursor-help select-none items-center text-mute transition-colors hover:text-ink"
      >
        ℹ️
      </button>

      {open &&
        pos &&
        typeof window !== 'undefined' &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-overlay w-[min(18rem,calc(100vw-1rem))] rounded-sm border-[2px] border-ink bg-paper p-3 shadow-[3px_3px_0_black]"
            style={{ left: pos.left, top: pos.top }}
          >
            <div className="mb-2 text-sm font-semibold text-ink-2">
              {t('trustTitle')}
            </div>
            <ul className="list-inside list-disc space-y-1 text-xs-soft text-mute">
              {bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}

'use client';

/* ────────────────────────────────────────────────────────────────────
   PaletteOnboarding — 전환 온보딩 말풍선 (P4).

   CD SSOT: `canvas-modular/full/README.md` §8 + 장면 P4.

   형태: 팔레트를 가리키는 말풍선 **하나**(340 · ink 면 · radius 14 ·
   `--sh-popover`). 배경을 어둡게 하지 않고, 조작을 막지 않고, 단계 넘김
   (1/3, 2/3)도 없다 — 그래서 모달이 아니라 `role="status"` 의 비모달
   말풍선이고 `pointer-events` 는 버튼에만 산다.

   닫힘: "알겠어요" · Esc · **팔레트 타일을 처음 누르거나 끌 때**. 어느
   쪽이든 사용자 단위 **서버 플래그**를 기록해 기기가 바뀌어도 다시 뜨지
   않는다(§8 닫힘 · §11 Done-when "기기가 바뀌어도 재노출 0"). 기록 호출은
   호출부(보드)가 소유한다 — 이 컴포넌트는 "닫아 달라"고만 말한다.

   대상자 판정도 서버가 한다: 그리드 캔버스를 쓴 적 있는 사용자만 1회.
   신규 사용자에게는 보이지 않는다(빈 상태 문구가 같은 내용을 이미 말한다).
   ──────────────────────────────────────────────────────────────────── */

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

export function PaletteOnboarding({
  /** 팔레트 오른쪽 경계 x (화면 좌표) — 말풍선이 팔레트를 가리킨다. */
  anchorX,
  anchorY,
  onDismiss,
}: {
  anchorX: number;
  anchorY: number;
  onDismiss: () => void;
}) {
  const t = useTranslations('Canvas.onboarding');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  return (
    <div
      data-palette-onboarding
      role="status"
      style={{
        left: anchorX + 12,
        top: anchorY,
        width: 340,
        gap: 9,
        padding: '18px 18px 14px',
        boxShadow: 'var(--sh-popover)',
      }}
      className="fixed z-overlay flex flex-col rounded-sm bg-ink"
    >
      {/* 팔레트를 가리키는 꼬리 — 14 정사각을 45° 돌린 것(§8 형태). */}
      <span
        aria-hidden
        style={{ left: -7, top: 26, width: 14, height: 14 }}
        className="absolute rotate-45 rounded-xs bg-ink"
      />
      <span className="text-xl font-bold text-soft-surface">{t('title')}</span>
      <span className="text-md leading-relaxed text-soft-disabled">
        {t('body')}
      </span>
      <div style={{ gap: 10, marginTop: 4 }} className="flex items-center">
        <span className="text-sm text-soft-faint">{t('once')}</span>
        <span className="flex-1" />
        {/* eslint-disable-next-line react/forbid-elements -- CD 온보딩 확인 버튼은 ink 면 위의 **흰 pill**(7/15 패딩 · 12.5/600)이고, Button primitive 의 어떤 variant 도 "어두운 면 위 흰 pill" 을 주지 않는다. §7.11(컴파일 CSS 소스 순서)로 className override 가 불확정 — chain-toolbar pill 과 동일 선례. */}
        <button
          type="button"
          data-palette-onboarding-dismiss
          onClick={onDismiss}
          style={{ padding: '7px 15px' }}
          className="inline-flex items-center rounded-pill bg-soft-surface text-md font-semibold text-ink focus-visible:outline-none focus-visible:shadow-soft-focus-ring"
        >
          {t('dismiss')}
        </button>
      </div>
    </div>
  );
}

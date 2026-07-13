/* ────────────────────────────────────────────────────────────────────
   Banner — canvas widget 본문의 알림/경고/안내 배너.

   SSOT: desk-card-body 의 error/cancelled 인라인 `<div className="border-t
   border-warning-line bg-warning-bg ...">` 패턴 + reflection-pane 의 inline
   warning 스타일을 primitive 로 통일. tone 별 시각 토큰만 다르고 외곽
   spacing/typography 는 동일.

   - `warning`: 오류 / 위험 통지 (signal warning 토큰)
   - `info`: 정보성 안내 (line-soft + paper)
   - `subtle`: 중성 — 취소 / 종료 같은 비-에러 상태
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';

export type BannerTone = 'warning' | 'info' | 'subtle';

const TONE_CLS: Record<BannerTone, string> = {
  warning: 'border-warning-line bg-warning-bg text-ink-2',
  info: 'border-line-soft bg-paper text-ink-2',
  subtle: 'border-line-soft bg-paper-soft text-mute',
};

export type BannerProps = {
  // 기본 'warning'. desk 의 인라인 error 배너가 가장 많은 사용처라 기본값을
  // 거기에 맞춤.
  tone?: BannerTone;
  // 짧은 제목/라벨. 본문 children 과 같이 인라인으로 그려지므로 한 줄
  // 메시지면 title 만 줘도 OK.
  title?: ReactNode;
  // 본문/세부 — code, span, plain text 모두 가능.
  children?: ReactNode;
  // full-bleed strip 패턴 — 위쪽 영역과 시각 분리할 때 'top' (default).
  // 'none' 은 border 자체 없음 (color 만 차이로 분리). 카드/모달 내부에서
  // 외곽 border 가 따로 있는 contextual 사용은 별도 컴포넌트로 (Banner 는
  // 위젯 본문 full-bleed strip 전용).
  divider?: 'top' | 'none';
};

export function Banner({
  tone = 'warning',
  title,
  children,
  divider = 'top',
}: BannerProps) {
  const divCls = divider === 'top' ? 'border-t' : '';
  return (
    <div
      role={tone === 'warning' ? 'alert' : 'status'}
      className={`${divCls} ${TONE_CLS[tone]} px-5 py-3 text-md`}
      data-ds-primitive="Banner"
    >
      {title && <span className="font-semibold">{title}</span>}
      {title && children ? <span>{': '}</span> : null}
      {children}
    </div>
  );
}

export function WarningBanner(props: Omit<BannerProps, 'tone'>) {
  return <Banner {...props} tone="warning" />;
}

export function InfoBanner(props: Omit<BannerProps, 'tone'>) {
  return <Banner {...props} tone="info" />;
}

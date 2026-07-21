'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';

type Props = {
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  busyLabel?: string; // 기본 = label 유지
  icon?: ReactNode; // 기본 = 듀오톤 start(mono) — ink pill 위 흰 글리프
  // 좌측 상태 라벨 (아코디언 푸터 readyLabel — "준비 완료 · 시작할 수 있어요" 등).
  // 넘기면 액션 바가 justify-between 으로 좌 상태 + 우 CTA. 미전달이면 우측 CTA 만
  // (기존 6 위젯 동작 불변).
  statusLabel?: ReactNode;
};

// 6 위젯 주 CTA SSOT — 바디 최하단 고정 액션 바(레이아웃 행) + start pill.
// absolute 오버레이 폐기: 위젯 body 를 flex flex-col 로 두고 콘텐츠(flex-1
// overflow-y-auto) 아래 마지막 자식(shrink-0)으로 배치한다 → 콘텐츠 겹침 구조적
// 해소 + 6 위젯 CTA 가 카드 하단 우측 같은 y 로 싱크.
//
// 규격 = ui <Button variant="primary" size="cta"> = 정본 ink pill (GEOMETRY.md:34 /
// BUILD-SPEC-AI-UT.md:29). feature-placeholder 의 run CTA 와 동일 패턴:
//   준비(enabled)  = bg-ink/text-paper + rounded-full + border-ink + shadow-memphis
//                    (Button primary·cta 자동). 흰 mono start 아이콘이 ink 위에서 정상.
//   미준비(disabled)= 명시적 gray pill — disabled:opacity-100 으로 primary 의
//                    opacity-40 을 무력화하고 bg-ink/10(≈#eceef1 중립 gray)·
//                    text-mute-soft(#8a8693)·border-line(rgba .10) 으로 치환.
//                    (opacity-40 옅은-핑크 회귀 방지 — Rev1-C #1083 오류 교정.)
// padding px-5 py-2.5 = GEOMETRY 정본 20×11. sentence-case(한글) 이라 cta 의
// uppercase/tracking 은 normal 로 되돌린다. Button 은 항상 data-canvas-action →
// canvas cascade opt-out 자동이라 ink bg 가 흰색으로 덮이지 않는다.
export function WidgetPrimaryCta({
  label,
  busy,
  disabled,
  onClick,
  busyLabel,
  icon = <DuotoneIcon name="start" size={16} mono />,
  statusLabel,
}: Props) {
  return (
    <div
      className={`flex shrink-0 items-center border-t border-line-soft px-5 py-3 ${
        statusLabel != null ? 'justify-between gap-3' : 'justify-end'
      }`}
    >
      {statusLabel != null && (
        <span className="min-w-0 truncate text-xs text-mute">{statusLabel}</span>
      )}
      <Button
        variant="primary"
        size="cta"
        onClick={onClick}
        disabled={busy || disabled}
        leftIcon={icon}
        className="px-5 py-2.5 text-md normal-case tracking-normal disabled:border-line disabled:bg-ink/10 disabled:text-mute-soft disabled:opacity-100"
      >
        {busy ? (busyLabel ?? label) : label}
      </Button>
    </div>
  );
}

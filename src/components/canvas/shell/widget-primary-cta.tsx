'use client';

import type { ReactNode } from 'react';
import { ChromeButton } from '@/components/ui/chrome-button';

type Props = {
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  busyLabel?: string; // 기본 = label 유지
  icon?: ReactNode; // 기본 = 🚀
};

// 6 위젯 주 CTA SSOT — 바디 최하단 고정 액션 바(레이아웃 행) + 🚀 pill ChromeButton.
// absolute 오버레이 폐기: 위젯 body 를 flex flex-col 로 두고 콘텐츠(flex-1
// overflow-y-auto) 아래 마지막 자식(shrink-0)으로 배치한다 → 콘텐츠 겹침 구조적
// 해소 + 6 위젯 CTA 가 카드 하단 우측 같은 y 로 싱크. 규격 = ChromeButton
// variant="primary" size="lg" — 프로빙/통역 정본 (위치 방식만 오버레이→레이아웃).
export function WidgetPrimaryCta({
  label,
  busy,
  disabled,
  onClick,
  busyLabel,
  icon = '🚀',
}: Props) {
  return (
    <div className="flex shrink-0 justify-end border-t border-line-soft px-5 py-3">
      <ChromeButton
        variant="primary"
        size="lg"
        onClick={onClick}
        disabled={busy || disabled}
        leftIcon={icon}
      >
        {busy ? (busyLabel ?? label) : label}
      </ChromeButton>
    </div>
  );
}

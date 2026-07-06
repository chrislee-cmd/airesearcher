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

// 6 위젯 주 CTA SSOT — 우측 중앙 고정 앵커 + 🚀 pill ChromeButton.
// 위젯 body 는 반드시 relative 컨테이너여야 한다 (absolute anchor 기준).
// 규격 = ChromeButton variant="primary" size="lg" — 프로빙/통역 정본.
export function WidgetPrimaryCta({
  label,
  busy,
  disabled,
  onClick,
  busyLabel,
  icon = '🚀',
}: Props) {
  return (
    <div className="absolute right-5 top-1/2 z-10 -translate-y-1/2">
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

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
  // 좌측 상태 라벨 (아코디언 푸터 readyLabel — "준비 완료 · 시작할 수 있어요" 등).
  // 넘기면 액션 바가 justify-between 으로 좌 상태 + 우 CTA. 미전달이면 우측 CTA 만
  // (기존 6 위젯 동작 불변).
  statusLabel?: ReactNode;
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

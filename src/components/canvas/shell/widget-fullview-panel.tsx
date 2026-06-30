'use client';

import type { ReactNode } from 'react';
import { IconButton } from '@/components/ui/icon-button';

// WidgetFullviewPanel — 공유 전체보기 모달 안에서 한 위젯의 본문이
// 차지하는 우측 패널. WidgetFullviewModal 의 inner chrome (title/subtitle
// band + 닫기 × + 스크롤 본문) 과 동일하되 <Modal> backdrop 은 없다 —
// backdrop / 사이드바 / size 는 CanvasBoard 의 단일 <WidgetFullviewModal>
// 이 소유하고, 각 위젯은 이 패널을 그 모달의 slot 으로 portal 한다
// (fullview-shell-context 참고).
//
// 닫기 × 는 공유 모달 전체를 닫는다 (onClose = FullviewShell.close).

type WidgetFullviewPanelProps = {
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  /** aria-label for the close button. i18n override; defaults to 닫기. */
  closeLabel?: string;
};

export function WidgetFullviewPanel({
  title,
  subtitle,
  onClose,
  footer,
  children,
  closeLabel = '닫기',
}: WidgetFullviewPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-paper">
      <header className="flex shrink-0 items-center justify-between border-b-[2px] border-ink px-6 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-2xl font-semibold tracking-[-0.01em] text-ink-2">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-0.5 truncate text-md text-mute">{subtitle}</p>
          ) : null}
        </div>
        <IconButton
          variant="bordered"
          size="md"
          onClick={onClose}
          aria-label={closeLabel}
          className="ml-4 shrink-0"
        >
          <CloseIcon />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">{children}</div>

      {footer ? (
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t-[2px] border-ink px-6 py-3">
          {footer}
        </footer>
      ) : null}
    </div>
  );
}

// Inline × glyph — h-4 w-4 + aria-hidden 으로 a11y QA 룰 충족 (아이콘 전용
// 컨트롤은 IconButton 의 aria-label 로 라벨됨; SVG 는 장식).
function CloseIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

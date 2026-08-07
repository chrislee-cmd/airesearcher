'use client';

import { useEffect, useRef } from 'react';

// 초대 명단 펼침(＋N 클릭, §1.5) — 풀 주소는 **여기서만** 보인다(목록 행은
// 마스킹). DECISIONS §5-2: 우측 "열람 시각" 열 삭제 — 개별 열람자 신원 미수집이
// 확정이라 명단만 렌더한다. 팝오버는 ＋N 칩 아래 anchored(부모가 relative).

export function ShareInvitePopover({
  emails,
  headerLabel,
  editLabel,
  onEdit,
  onClose,
}: {
  emails: string[];
  headerLabel: string; // "초대 N명"
  editLabel: string; // "초대 편집 →"
  onEdit: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // 바깥 클릭 · Escape 로 닫기.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      className="absolute left-0 top-[calc(100%+6px)] z-fab w-max max-w-[420px] overflow-hidden rounded-panel border-2 border-ink bg-paper shadow-popover"
    >
      <div className="flex items-center gap-2 border-b-[1.5px] border-line-strong bg-paper-soft px-3.5 py-2.5">
        <span className="font-mono-label text-xs font-extrabold uppercase tracking-[0.12em] text-mute">
          {headerLabel}
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={onEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onEdit();
            }
          }}
          className="ml-auto cursor-pointer text-sm font-extrabold text-amore-deep"
        >
          {editLabel}
        </span>
      </div>
      <div className="flex flex-col gap-2 px-3.5 py-3">
        {emails.map((email) => (
          <span key={email} className="font-mono-label text-sm text-ink">
            {email}
          </span>
        ))}
      </div>
    </div>
  );
}

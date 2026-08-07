'use client';

/* ────────────────────────────────────────────────────────────────────
   CitationPopover — 답변 본문 안 inline [chunk_id] 뱃지를 trigger 로 삼아,
   클릭하면 해당 근거의 원문 excerpt(파일명 · 프로젝트 · 정확도 · 본문)를
   말풍선 popover 로 띄운다.

   왜: 옛 UI 는 chat 답변 하단에 근거 카드 전체를 항상 펼쳐 답변보다 근거가
   화면을 더 차지했다. 근거는 필요할 때(뱃지 클릭)만 popover 로 보이고,
   하단 리스트는 접힘(default)으로 물러난다.

   시각/동작: date-range-popover 와 같은 portal + position:fixed escape
   (부모의 overflow:hidden / 좁은 chat 칼럼 안에서 잘리지 않도록). radix 미설치
   프로젝트라 기존 portal-popover 패턴을 그대로 재사용한다. design-system
   토큰만 사용.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { usePopoverBase } from '@/components/ui/use-popover-base';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import { useCitationBackref } from '@/components/interviews-v2/citation-backref-context';
import type { Citation } from '@/lib/interview-v2/types';

// 패널 폭 — 뷰포트가 좁으면 좌우 0.5rem 여백만 남기고 축소.
const PANEL_W = 448; // = 28rem (max-w-md)
const GAP = 6; // trigger 와 패널 사이 간격

export function CitationPopover({
  citation,
  children,
}: {
  citation: Citation;
  children: ReactNode;
}) {
  const t = useTranslations('InterviewsV2');
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  // 원본 파일 역참조 — 좌측 파일 패널을 소유한 컨텍스트(InterviewReadDetail)에서만
  // provider 가 있다. 없으면(크로스 검색·파일 모달·카탈로그) 진입점 생략.
  const backref = useCitationBackref();
  const backrefRef = {
    documentId: citation.document_id,
    filename: citation.filename,
    chunkId: citation.chunk_id,
  };
  // 삭제된 원본 파일이면 진입점 비활성 + 툴팁(폴백 #4).
  const fileExists = backref ? backref.has(backrefRef) : false;
  // 포털 mount + escape/외부클릭 + trigger rect 추적은 공통 훅. 배치 계산만 로컬.
  const { triggerRef, panelRef, anchorRect } = usePopoverBase<
    HTMLButtonElement,
    HTMLDivElement
  >({ open, onClose: close });

  // trigger 좌측 정렬 기준 배치 — 뷰포트 넘침 방지로 left 클램프.
  const pos = anchorRect
    ? (() => {
        const vw = window.innerWidth;
        const w = Math.min(PANEL_W, vw - 16);
        const left = Math.max(8, Math.min(anchorRect.left, vw - w - 8));
        return { left, top: anchorRect.bottom + GAP };
      })()
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-ds-primitive="CitationPopover"
        className="mx-0.5 inline-flex cursor-pointer select-none items-center rounded-xs border border-amore bg-amore-bg px-1 align-baseline text-xs-soft font-semibold text-amore transition-colors hover:bg-amore hover:text-paper"
      >
        {children}
      </button>

      {open &&
        pos &&
        typeof window !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={citation.filename}
            className="fixed z-overlay w-[min(28rem,calc(100vw-1rem))] rounded-sm border-[2px] border-ink bg-paper p-4 shadow-memphis-md"
            style={{ left: pos.left, top: pos.top }}
          >
            <div className="mb-2 flex items-center gap-2 border-b border-line-soft pb-2 text-xs-soft">
              <span className="min-w-0 truncate font-semibold text-ink-2">
                {citation.filename}
              </span>
              {citation.project_name && (
                <span className="min-w-0 shrink truncate text-mute">
                  · {citation.project_name}
                </span>
              )}
              <span className="ml-auto shrink-0 whitespace-nowrap text-mute">
                {t('searchScore')} {Math.round(citation.score * 100)}%
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-[1.7] text-ink-2">
              {citation.excerpt}
            </div>
            {/* 원본 파일 보기 — 좌측 파일 패널로 점프·하이라이트. 삭제된 파일은
                비활성 + 툴팁(폴백 #4). backref provider 없으면 행 자체 생략. */}
            {backref && (
              <div className="mt-3 border-t border-line-soft pt-2.5">
                {fileExists ? (
                  <button
                    type="button"
                    onClick={() => {
                      backref.open(backrefRef);
                      close();
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xs px-1 py-0.5 text-xs-soft font-semibold text-amore transition-colors hover:bg-amore-bg"
                  >
                    <DuotoneIcon name="document" size={14} />
                    {t('citationOpenFile')}
                  </button>
                ) : (
                  <span
                    className="inline-flex items-center gap-1.5 px-1 py-0.5 text-xs-soft text-mute-soft"
                    title={t('citationFileDeleted')}
                  >
                    <DuotoneIcon name="document" size={14} />
                    {t('citationFileDeleted')}
                  </span>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

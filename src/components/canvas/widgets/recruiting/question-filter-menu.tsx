'use client';

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Checkbox } from '@/components/ui/checkbox';
import {
  isAnswerActive,
  toggleAnswer,
  type FilterableQuestion,
  type RecruitingFilter,
} from '@/lib/recruiting/distribution';

// 질문 필터 multi-select 팝오버 — 여러 객관식 질문을 펼쳐 각 질문 안에서
// 여러 답변을 체크한다 (질문 내 OR, 질문 간 AND). 공유 <DropdownMenu> 는
// 항목 선택 시 자동으로 닫혀 다중 체크에 부적합하므로, 그 portal + position:
// fixed + outside-click + Esc 패턴만 재사용한 feature-local 팝오버로 만든다.
// z-overlay 로 fullview 그리드의 overflow(clip) 를 탈출한다 (셀 팝오버와 동일
// 톤: 2px ink border + 3px 오프셋 shadow).

export function QuestionFilterMenu({
  questions,
  filter,
  onFilterChange,
}: {
  questions: FilterableQuestion[];
  filter: RecruitingFilter;
  onFilterChange: (filter: RecruitingFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  // 펼친 질문 field 목록 — 팝오버 안에서만 쓰는 로컬 UI state.
  const [expanded, setExpanded] = useState<string[]>([]);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeCount = filter.questions.reduce(
    (n, q) => n + q.answers.length,
    0,
  );

  const updateRect = useCallback(() => {
    const el = wrapRef.current;
    if (el) setAnchorRect(el.getBoundingClientRect());
  }, []);

  // position:fixed 라 열려 있는 동안 scroll/resize 마다 anchor 재계산.
  useLayoutEffect(() => {
    if (!open) return;
    updateRect();
    window.addEventListener('scroll', updateRect, true);
    window.addEventListener('resize', updateRect);
    return () => {
      window.removeEventListener('scroll', updateRect, true);
      window.removeEventListener('resize', updateRect);
    };
  }, [open, updateRect]);

  // 바깥 클릭(트리거 + portal 메뉴 모두 검사) / Esc 로 닫기.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggleExpand = (field: string) =>
    setExpanded((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field],
    );

  const menuStyle: CSSProperties = anchorRect
    ? {
        position: 'fixed',
        top: anchorRect.bottom + 4,
        left: anchorRect.left,
        minWidth: Math.max(220, anchorRect.width),
        maxWidth: 480,
      }
    : { position: 'fixed', visibility: 'hidden' };

  const portalTarget = typeof document !== 'undefined' ? document.body : null;

  return (
    <div className="relative inline-block" ref={wrapRef}>
      {/* 트리거 — 활성 답변 수 뱃지 포함. 단일선택 전용 <Select> 는 다중선택에
          부적합하고, 팝오버 트리거는 밀집 chrome-less 컨트롤이라 native button
          을 §3.8 sanctioned per-line disable 로 사용. */}
      {/* eslint-disable-next-line react/forbid-elements -- multi-select 팝오버 트리거; Select 는 단일선택 전용 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-sm border-2 border-ink bg-paper px-3 py-1.5 text-sm text-ink shadow-memphis-xs transition-colors hover:bg-paper-soft"
      >
        <span>질문 필터</span>
        {activeCount > 0 && (
          <span className="rounded-full bg-amore/15 px-1.5 text-xs-soft font-semibold tabular-nums text-amore">
            {activeCount}
          </span>
        )}
        <span aria-hidden className="text-mute-soft">
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open && portalTarget
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="z-overlay max-h-[320px] overflow-auto rounded-sm border-2 border-ink bg-paper py-1 shadow-memphis-md"
              style={menuStyle}
            >
              {questions.map((q) => {
                const isOpen = expanded.includes(q.field);
                const qActive =
                  filter.questions.find((x) => x.field === q.field)?.answers
                    .length ?? 0;
                return (
                  <div
                    key={q.field}
                    className="border-b border-line-soft last:border-b-0"
                  >
                    {/* eslint-disable-next-line react/forbid-elements -- 질문 펼침 토글; 밀집 리스트 행이라 Button chrome 부적합 */}
                    <button
                      type="button"
                      onClick={() => toggleExpand(q.field)}
                      aria-expanded={isOpen}
                      className="flex w-full min-w-0 items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-ink-2 transition-colors hover:bg-line-soft/40"
                    >
                      <span className="truncate" title={q.title}>
                        {q.title}
                        {qActive > 0 && (
                          <span className="ml-1 text-xs-soft font-semibold text-amore">
                            ({qActive})
                          </span>
                        )}
                      </span>
                      <span aria-hidden className="shrink-0 text-mute-soft">
                        {isOpen ? '▼' : '▶'}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="space-y-0.5 px-3 pb-2 pl-5">
                        {q.answers.length === 0 ? (
                          <p className="py-1 text-xs-soft text-mute-soft">
                            답변 옵션 없음
                          </p>
                        ) : (
                          q.answers.map((ans) => (
                            <label
                              key={ans}
                              className="flex cursor-pointer items-center gap-2 py-0.5 text-sm text-ink-2"
                            >
                              <Checkbox
                                checked={isAnswerActive(filter, q.field, ans)}
                                onChange={() =>
                                  onFilterChange(
                                    toggleAnswer(filter, q.field, ans),
                                  )
                                }
                              />
                              <span className="truncate">{ans}</span>
                            </label>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>,
            portalTarget,
          )
        : null}
    </div>
  );
}

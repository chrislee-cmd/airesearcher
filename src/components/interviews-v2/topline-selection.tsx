'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { useTranslations } from 'next-intl';
import { Textarea } from '@/components/ui/textarea';
import { IconButton } from '@/components/ui/icon-button';
import { Button } from '@/components/ui/button';

// 인터뷰 탑라인 drag-to-ask — 선택 레이어.
//
// useToplineSelection: 탭1 탑라인 본문 컨테이너 안에서 텍스트 드래그 선택을
// 감지해 { anchorBlockId(선택 끝점 블록의 data-block-id), text, rect } 를
// 노출한다 (2-tab PR 이 노출한 DOM 계약). ToplineAskPopup: 그 선택 rect 기준
// 으로 질문 입력 팝업(Notion 코멘트 스타일)을 fixed portal 로 띄운다 —
// ESC / 바깥 클릭으로 닫힌다.

export type ToplineSelection = {
  anchorBlockId: string;
  text: string;
  // viewport 좌표(getBoundingClientRect). 팝업은 fixed 로 이 위에 띄운다.
  rect: { top: number; bottom: number; left: number; right: number };
};

// node → 가장 가까운 [data-block-id] 블록 id. 컨테이너 밖이면 null.
function resolveBlockId(
  node: Node | null,
  container: HTMLElement,
): string | null {
  const el: Element | null =
    node == null
      ? null
      : node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement;
  const found = el?.closest('[data-block-id]') ?? null;
  if (!found || !container.contains(found)) return null;
  return found.getAttribute('data-block-id');
}

/**
 * 컨테이너 안 텍스트 선택을 감지. enabled 일 때만 활성(보고서 done + blocks
 * 있을 때). mouseup 시점에 선택을 스냅샷하므로, 이후 팝업 입력에 포커스가
 * 옮겨가 DOM 선택이 사라져도 팝업은 유지된다.
 */
export function useToplineSelection(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): { selection: ToplineSelection | null; clear: () => void } {
  const [selection, setSelection] = useState<ToplineSelection | null>(null);
  const clear = useCallback(() => setSelection(null), []);

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    function onMouseUp() {
      // container 는 effect 클로저에 캡처됨(위 early-return 으로 non-null).
      const el = container as HTMLElement;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const text = sel.toString().trim();
      if (!text) return;
      const range = sel.getRangeAt(0);
      // 선택이 컨테이너 밖으로 걸치면 무시(블록 밖 드래그 = 팝업 X).
      if (!el.contains(range.commonAncestorContainer)) return;
      const anchorBlockId =
        resolveBlockId(range.endContainer, el) ??
        resolveBlockId(range.startContainer, el);
      if (!anchorBlockId) return;
      const r = range.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      setSelection({
        anchorBlockId,
        text,
        rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
      });
    }

    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, [enabled, containerRef]);

  return { selection, clear };
}

const POPUP_WIDTH = 340;

function popupStyle(rect: ToplineSelection['rect']): CSSProperties {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const left = Math.min(Math.max(8, rect.left), vw - POPUP_WIDTH - 8);
  // 아래 공간이 부족하면 선택 위에 띄운다(bottom anchor).
  const placeAbove = vh - rect.bottom < 220;
  return placeAbove
    ? { position: 'fixed', left, bottom: vh - rect.top + 8 }
    : { position: 'fixed', left, top: rect.bottom + 8 };
}

/**
 * 선택 rect 근처에 뜨는 팝업. 상단에 선택 발췌를 표시하고, 두 액션을 제공한다:
 * `추가 질문`(기본 — 근거 검색 답변 스트리밍) / `편집`(선택 블록을 인라인
 * 텍스트 편집 모드로 전환). editable=false(table/chart/pie 등 텍스트 아님)면
 * 편집 액션은 비활성. 질문 입력은 Enter 제출(IME 조합 중 제외), Shift+Enter 개행.
 */
export function ToplineAskPopup({
  selection,
  busy,
  editable,
  onSubmit,
  onEdit,
  onClose,
}: {
  selection: ToplineSelection;
  busy: boolean;
  // 선택 블록이 인라인 편집 가능한 텍스트 블록인지(false 면 편집 액션 비활성).
  editable: boolean;
  onSubmit: (question: string) => void;
  // 편집 액션 — 선택 블록을 인라인 편집 모드로 전환(팝업은 닫힘).
  onEdit: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  const [value, setValue] = useState('');
  const cardRef = useRef<HTMLDivElement>(null);

  const submit = useCallback(() => {
    const q = value.trim();
    if (!q || busy) return;
    onSubmit(q);
  }, [value, busy, onSubmit]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        e.key === 'Enter' &&
        !e.shiftKey &&
        !(
          e.nativeEvent as KeyboardEvent['nativeEvent'] & {
            isComposing?: boolean;
          }
        ).isComposing
      ) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  // ESC + 바깥 클릭 닫기. 바깥 클릭은 선택을 만든 그 mouseup 이 즉시 닫지
  // 않도록 다음 tick 에 mousedown 리스너를 등록한다.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onDown(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    const id = window.setTimeout(
      () => document.addEventListener('mousedown', onDown),
      0,
    );
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(id);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  if (typeof window === 'undefined') return null;

  // portal 하지 않고 인라인으로 렌더한다 — ToplineView 는 fullview Modal
  // subtree 안에 있으므로, body 로 portal 하면 팝업이 모달(z-modal:50) 밖
  // stacking context 에서 z-popup(20) 으로 경쟁해 모달 아래로 깔린다. 인라인
  // fixed 는 모달의 stacking context 안에서 z-popup 으로 떠 모달 콘텐츠 위에
  // 그려진다(probing question-popup 과 동일 패턴). Modal chrome 은 transform
  // 없이 flex centering 이라 fixed 가 실제 viewport 기준으로 동작한다
  // (PROJECT.md §7.11 류 transform-containing-block 함정 없음).
  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label={t('toplineAskTitle')}
      style={{ ...popupStyle(selection.rect), width: POPUP_WIDTH }}
      className="z-popup rounded-sm border-[3px] border-ink bg-paper p-3 shadow-[6px_6px_0_var(--color-ink)]"
    >
      <div className="mb-2 flex items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded-xs bg-amore-bg px-1.5 py-0.5 text-xs-soft font-semibold uppercase tracking-[0.18em] text-amore">
          {t('toplineAskSelectedLabel')}
        </span>
        <p className="line-clamp-2 text-xs-soft italic leading-snug text-mute">
          “{selection.text}”
        </p>
      </div>
      {/* 액션 2개 — 추가 질문(기본, 아래 입력) / 편집(선택 블록 인라인 수정).
          편집은 텍스트 블록일 때만 활성(table/chart/pie 는 disabled). */}
      <div className="mb-2 flex items-center gap-1.5">
        <span className="rounded-xs border border-ink bg-ink px-2 py-1 text-xs-soft font-semibold text-paper">
          💬 {t('toplineAskAction')}
        </span>
        <Button
          variant="ghost"
          size="xs"
          onClick={onEdit}
          disabled={!editable}
          title={t('toplineEditAction')}
        >
          ✏️ {t('toplineEditAction')}
        </Button>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            autoFocus
            placeholder={t('toplineAskPlaceholder')}
            disabled={busy}
          />
        </div>
        <IconButton
          aria-label={t('toplineAskSend')}
          variant="bordered"
          size="lg"
          onClick={submit}
          disabled={busy || value.trim().length === 0}
        >
          →
        </IconButton>
      </div>
    </div>
  );
}

'use client';

/* ────────────────────────────────────────────────────────────────────
   AskLayer / PendingQaCard — 편집 모드 drag-to-ask (fresh · BUILD-SPEC §1.4 ·
   S5c .dc.html 비주얼 SSOT). 3단계:

   1 구절 선택 → 떠 있는 CTA(solid ink pill · mono questions 아이콘 "이 부분에
     질문하기"). 라이브 선택 배경은 편집 캔버스의 `selection:bg-sun`(§1.4 —
     border-b amber 는 native ::selection 에 불가하므로 캡처 발췌 표시에 적용).
   2 질문 입력 · 대상 선택 → 카드(border 2 ink · rounded-panel · memphis-md-faint):
     발췌(border-l 2 amber) + 입력 + 인터뷰/웹 pill + 묻기.
   3 답변 카드(<PendingQaCard>, 앵커 블록 아래 인라인) → 답변 md + 근거 칩 +
     [＋ 보고서에 넣기][버리기]. 근거 없음 폴백은 넣기 버튼 미렌더(§S5c).

   선택 감지는 use-topline-selection(useToplineSelection) 재사용, ask/keep/
   discard 로직은 use-topline-drag-to-ask 재사용(계약 무변경). 프레젠테이션만 fresh
   (구형 ToplineAskPopup 의 이모지 chrome 은 superseded — 편집/재사용 금지).
   ──────────────────────────────────────────────────────────────────── */

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
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import type { AskMode, PendingQa } from '@/hooks/use-topline-drag-to-ask';
import { useToplineSelection, type ToplineSelection } from '../topline-selection';
import { ReportProse } from './report-prose';

const POPUP_W = 360;

// 선택 rect 기준 fixed 위치 — 아래 공간 부족 시 위로 뒤집는다.
function anchorStyle(
  rect: ToplineSelection['rect'],
  estHeight: number,
): CSSProperties {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const left = Math.min(Math.max(8, rect.left), vw - POPUP_W - 8);
  const below = vh - rect.bottom >= estHeight + 16;
  return below
    ? { position: 'fixed', left, top: rect.bottom + 8, width: POPUP_W }
    : { position: 'fixed', left, bottom: vh - rect.top + 8, width: POPUP_W };
}

// ── AskLayer — 선택 감지 셀렉터. 실제 CTA/입력 카드는 selection 별 key 로
// 마운트되는 <AskCard> 가 소유해 새 선택마다 스테이지/입력이 자연 초기화된다
// (effect-setState 없이 remount 로 리셋 — React 권장).
export function AskLayer({
  containerRef,
  enabled,
  askEnabled,
  onAsk,
}: {
  containerRef: RefObject<HTMLElement | null>;
  // 편집 모드 + 보고서 done 일 때만 선택 감지 활성.
  enabled: boolean;
  // 인터뷰 코퍼스가 있어 추가 질문이 가능한지(indexed). false 면 CTA 미표시.
  askEnabled: boolean;
  onAsk: (
    anchorBlockId: string,
    selectedText: string,
    question: string,
    mode: AskMode,
  ) => void;
}) {
  const { selection, clear } = useToplineSelection(containerRef, enabled && askEnabled);
  if (!selection || typeof window === 'undefined') return null;
  return (
    <AskCard
      key={`${selection.anchorBlockId}|${selection.text}`}
      selection={selection}
      onAsk={onAsk}
      onClose={clear}
    />
  );
}

function AskCard({
  selection,
  onAsk,
  onClose,
}: {
  selection: ToplineSelection;
  onAsk: (
    anchorBlockId: string,
    selectedText: string,
    question: string,
    mode: AskMode,
  ) => void;
  onClose: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  // 'cta' = CTA 만, 'input' = 질문 입력 카드.
  const [stage, setStage] = useState<'cta' | 'input'>('cta');
  const [value, setValue] = useState('');
  const [mode, setMode] = useState<AskMode>('interview');
  const cardRef = useRef<HTMLDivElement>(null);

  const submit = useCallback(() => {
    const q = value.trim();
    if (!q) return;
    onAsk(selection.anchorBlockId, selection.text, q, mode);
    onClose();
  }, [selection, value, mode, onAsk, onClose]);

  // ESC + 바깥 클릭 닫기. 다음 tick 에 리스너 등록해 여는 클릭이 즉시 닫지 않게.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onDown(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) onClose();
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

  // CTA — solid ink pill + mono questions 아이콘. body 로 portal 하지 않고 인라인
  // fixed(모달 stacking context 안에서 z-popup 으로 뜸 — topline-selection 선례).
  if (stage === 'cta') {
    return (
      <div ref={cardRef} style={anchorStyle(selection.rect, 44)} className="z-popup">
        {/* eslint-disable-next-line react/forbid-elements -- CD S5c 질문 CTA 는 solid ink rounded-pill·mono 아이콘 인라인 chrome; Button variant 와 불일치 */}
        <button
          type="button"
          onClick={() => setStage('input')}
          className="inline-flex items-center gap-[7px] rounded-pill bg-ink px-3.5 py-[7px] text-md font-extrabold text-paper shadow-memphis-sm"
        >
          <DuotoneIcon name="questions" size={15} mono />
          {t('editAskCta')}
        </button>
      </div>
    );
  }

  // 질문 입력 카드.
  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label={t('editAskTitle')}
      style={anchorStyle(selection.rect, 180)}
      className="z-popup overflow-hidden rounded-panel border-2 border-ink bg-paper shadow-memphis-md-faint"
    >
      <div className="flex flex-col gap-[11px] px-3.5 py-3">
        {/* 선택 발췌 — border-l 2 amber. */}
        <div className="border-l-2 border-amber pl-3 text-xs leading-[1.6] text-mute-soft">
          <span className="bg-sun px-0.5 text-ink">{selection.text}</span>
        </div>
        {/* eslint-disable-next-line react/forbid-elements -- CD S5c 질문 입력은 rounded-control 인라인 chrome; Textarea primitive 고정 스타일과 불일치 */}
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
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
          }}
          rows={2}
          autoFocus
          placeholder={t('editAskPlaceholder')}
          aria-label={t('editAskTitle')}
          className="w-full resize-none rounded-control border-[1.5px] border-ink bg-paper px-3 py-2 text-md leading-[1.55] text-ink-2 outline-none placeholder:text-faint"
        />
        <div className="flex items-center gap-2">
          {(['interview', 'web'] as const).map((m) => (
            // eslint-disable-next-line react/forbid-elements -- CD S5c 대상 선택은 선택형 rounded-pill chrome(활성 rose·비활성 outline); Button variant 와 불일치
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={
                mode === m
                  ? 'inline-flex items-center rounded-pill border-2 border-ink bg-widget-header-rose px-3 py-[5px] text-xs font-extrabold text-ink'
                  : 'inline-flex items-center rounded-pill border-[1.5px] border-ink/[0.18] bg-paper px-3 py-[5px] text-xs font-bold text-mute'
              }
            >
              {m === 'interview' ? t('editAskModeInterview') : t('editAskModeWeb')}
            </button>
          ))}
          {/* eslint-disable-next-line react/forbid-elements -- CD S5c 묻기는 solid ink rounded-pill chrome; Button primary radius 와 불일치 */}
          <button
            type="button"
            onClick={submit}
            disabled={value.trim().length === 0}
            className="ml-auto inline-flex items-center rounded-pill bg-ink px-3.5 py-1.5 text-md font-extrabold text-paper disabled:opacity-45"
          >
            {t('editAskSend')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PendingQaCard — 답변 카드(앵커 블록 아래 인라인, S5c 3단계) ─────────
// 스트리밍/완료/에러 · 근거 없음 폴백. 넣기(keep) = 서버 병합, 버리기(discard) =
// 클라 롤백. 근거 없음이면(no_answer) 넣기 버튼 미렌더(§S5c).
export function PendingQaCard({
  qa,
  onKeep,
  onDiscard,
}: {
  qa: PendingQa;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  const streaming = qa.phase === 'streaming';
  const errored = qa.phase === 'error';
  const noAnswer = qa.phase === 'done' && !qa.answerMd.trim();
  return (
    <div
      aria-busy={streaming}
      className="flex flex-col gap-2.5 rounded-panel border-2 border-ink bg-paper-soft px-3.5 py-3"
    >
      {/* 질문 + 발췌 문맥. */}
      <div className="flex flex-col gap-1.5">
        <div className="text-md font-extrabold leading-[1.5] text-ink">
          {qa.question}
        </div>
        {qa.selectedExcerpt && (
          <div className="border-l-2 border-amber pl-2.5 font-mono-label text-xs leading-[1.5] text-mute-soft">
            &ldquo;{qa.selectedExcerpt}&rdquo;
          </div>
        )}
      </div>

      {/* 본문. */}
      {errored ? (
        <div className="text-md leading-[1.7] text-error-text">
          {qa.errorMsg === 'web_search_unavailable'
            ? t('editAskWebUnavailable')
            : t('editAskError')}
        </div>
      ) : noAnswer ? (
        <div className="rounded-control border-[1.5px] border-line bg-paper px-3 py-2.5 text-md leading-[1.7] text-mute">
          {t('editAskNoGround')}
        </div>
      ) : qa.answerMd ? (
        <div className="text-md leading-[1.8] text-ink-2">
          <ReportProse md={qa.answerMd} citations={qa.citations} />
        </div>
      ) : (
        <div className="flex items-center gap-2 font-mono-label text-xs uppercase tracking-[0.16em] text-lav-text">
          <span
            aria-hidden
            className="h-[7px] w-[7px] animate-pulse rounded-full bg-processing motion-reduce:animate-none"
          />
          {qa.mode === 'web' ? t('editAskThinkingWeb') : t('editAskThinking')}
        </div>
      )}

      {/* 액션 — 완료/에러 시. 근거 없음(noAnswer)이면 넣기 미렌더. */}
      {(qa.phase === 'done' || errored) && (
        <div className="flex items-center gap-2 border-t-[1.5px] border-line pt-2.5">
          {qa.phase === 'done' && !noAnswer && (
            // eslint-disable-next-line react/forbid-elements -- CD S5c 넣기는 solid ink rounded-pill chrome; Button primary radius 와 불일치
            <button
              type="button"
              onClick={onKeep}
              disabled={qa.saving}
              className="inline-flex items-center gap-1.5 rounded-pill bg-ink px-3.5 py-[7px] text-md font-extrabold text-paper shadow-memphis-sm-faint disabled:opacity-45"
            >
              ＋ {t('editAskKeep')}
            </button>
          )}
          {/* eslint-disable-next-line react/forbid-elements -- CD S5c 버리기는 outline rounded-pill chrome; Button variant 와 불일치 */}
          <button
            type="button"
            onClick={onDiscard}
            disabled={qa.saving}
            className="inline-flex items-center rounded-pill border-[1.5px] border-ink/20 bg-paper px-3.5 py-[7px] text-md font-bold text-mute disabled:opacity-45"
          >
            {t('editAskDiscard')}
          </button>
        </div>
      )}
    </div>
  );
}

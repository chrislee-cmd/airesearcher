'use client';

/* ────────────────────────────────────────────────────────────────────
   FileCard — 인터뷰 V2 파일 그리드(5×N)의 한 칸.

   카드 본체는 최소 정보(파일명 + 상태 dot)만 보여주고, 클릭하면 상세
   (용량 · 단어 · 문자 · 업로드일 · 상태)를 popover 로 띄운다. 옛 리스트는
   카드마다 용량/단어/첫·마지막 질문을 항상 펼쳐 파일이 몇 개만 돼도 세로로
   길어졌다 — 상세는 필요할 때(카드 클릭)만.

   Popover 는 radix 미설치 프로젝트라 citation-popover 와 같은 portal +
   position:fixed escape 패턴을 재사용한다(부모 overflow / 좁은 칼럼에서
   잘리지 않도록). design-system 토큰만 사용.
   ──────────────────────────────────────────────────────────────────── */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import type {
  InterviewDocument,
  InterviewDocumentStatus,
} from '@/hooks/use-interview-v2-documents';

const PANEL_W = 288; // = 18rem (w-72)
const GAP = 6; // trigger 와 패널 사이 간격

// "용량" — UTF-8 byte size of the captured text, formatted compactly.
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_KEY: Record<InterviewDocumentStatus, string> = {
  pending: 'statusPending',
  indexing: 'statusIndexing',
  done: 'statusDone',
  error: 'statusError',
};

export function FileCard({
  file,
  reading,
  readDone,
  analyzing,
  analyzed,
}: {
  file: InterviewDocument;
  // 검색 sweep 진행 중 이 카드가 지금 "읽는 중" 인지.
  reading?: boolean;
  // 검색 sweep 에서 이미 "읽음" 처리됐는지.
  readDone?: boolean;
  // 탑라인 생성 map 단계에서 지금 "분석 중" 인 파일(순차 진행 frontier).
  // 검색 sweep 과 독립 — 동시에 뜰 일은 드물지만 reading 이 우선한다.
  analyzing?: boolean;
  // 탑라인 map 이 이미 훑은 파일("분석됨").
  analyzed?: boolean;
}) {
  const t = useTranslations('InterviewsV2');
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // 열려 있는 동안 trigger 위치를 추적해 패널을 재배치 (스크롤/리사이즈 대응).
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      const vw = window.innerWidth;
      const w = Math.min(PANEL_W, vw - 16);
      const left = Math.max(8, Math.min(r.left, vw - w - 8));
      setPos({ left, top: r.bottom + GAP });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  // 바깥 클릭 / Escape 로 닫기.
  useEffect(() => {
    if (!open) return;
    function down(e: MouseEvent) {
      const node = e.target as Node;
      if (triggerRef.current?.contains(node)) return;
      if (panelRef.current?.contains(node)) return;
      setOpen(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', esc as EventListener);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', esc as EventListener);
    };
  }, [open]);

  // amore 하이라이트(테두리 + pulse) = 지금 능동 처리 중. 검색 "읽는 중" 또는
  // 탑라인 map "분석 중" frontier. reading(사용자 명시 검색) 이 우선.
  const active = reading || analyzing;
  // 상태 dot + 라벨 — 검색 sweep(읽는 중/읽음) · 탑라인 map(분석 중/분석됨) ·
  // 그 외 인덱싱 상태 순으로 분기.
  const dotClass =
    active || readDone || analyzed
      ? 'bg-amore'
      : file.index_status === 'done'
        ? 'bg-amore'
        : file.index_status === 'error'
          ? 'bg-warning'
          : 'bg-mute';
  const statusLabel = reading
    ? '읽는 중'
    : readDone
      ? '읽음'
      : analyzing
        ? '분석 중'
        : analyzed
          ? '분석됨'
          : t(STATUS_KEY[file.index_status]);

  // Chunk-level progress bar — only while this file is actively indexing and
  // the indexer has published a denominator (total_chunks). Older documents
  // (total_chunks null) and the search-sweep "읽는 중" state fall back to the
  // plain status dot + label below.
  const showProgress =
    !reading &&
    !analyzing &&
    !analyzed &&
    file.index_status === 'indexing' &&
    file.total_chunks != null &&
    file.total_chunks > 0;
  const pct = showProgress
    ? Math.min(100, Math.round((file.processed_chunks / file.total_chunks!) * 100))
    : 0;

  return (
    <>
      {/* Bespoke selectable file tile — no <Button> variant models a
          full-bleed content card (link/cta/icon per the rule msg don't fit);
          Button's Memphis border/shadow/justify-center would fight this flat
          left-aligned layout. Mirrors CitationPopover's native-button popover
          trigger. See PR body. */}
      {/* eslint-disable-next-line react/forbid-elements -- bespoke file tile, no Button variant fits (see comment above) */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex w-full flex-col items-start gap-1 rounded-sm border-[2px] p-3 text-left transition-colors ${
          active ? 'border-amore bg-amore-bg' : 'border-line-soft hover:border-ink'
        }`}
      >
        <div className="w-full truncate text-xs font-semibold text-ink">
          {file.filename}
        </div>
        {showProgress ? (
          <div className="mt-1 w-full space-y-1">
            <div className="h-1 w-full overflow-hidden rounded-xs bg-line-soft">
              <div
                className="h-full bg-amore transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="block text-xs-soft tabular-nums text-mute-soft">
              인덱싱 중 {file.processed_chunks}/{file.total_chunks} ({pct}%)
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <span
              className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dotClass} ${
                analyzing ? 'topline-analyzing-pulse' : ''
              }`}
              style={
                reading
                  ? { animation: 'trustChecking 0.9s ease-out infinite' }
                  : undefined
              }
              aria-hidden
            />
            <span className="text-xs-soft text-mute-soft">{statusLabel}</span>
          </div>
        )}
      </button>

      {open &&
        pos &&
        typeof window !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={file.filename}
            className="fixed z-overlay w-[min(18rem,calc(100vw-1rem))] rounded-sm border-[2px] border-ink bg-paper p-4 shadow-[3px_3px_0_black]"
            style={{ left: pos.left, top: pos.top }}
          >
            <div className="mb-2 truncate border-b border-line-soft pb-2 text-sm font-semibold text-ink-2">
              {file.filename}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs-soft">
              <dt className="text-mute">용량</dt>
              <dd className="tabular-nums text-ink-2">
                {formatBytes(file.byte_size)}
              </dd>
              <dt className="text-mute">단어</dt>
              <dd className="tabular-nums text-ink-2">
                {file.word_count.toLocaleString()}
              </dd>
              <dt className="text-mute">문자</dt>
              <dd className="tabular-nums text-ink-2">
                {file.char_count.toLocaleString()}
              </dd>
              <dt className="text-mute">상태</dt>
              <dd className="text-ink-2">{t(STATUS_KEY[file.index_status])}</dd>
              {file.total_chunks != null && file.total_chunks > 0 && (
                <>
                  <dt className="text-mute">청크</dt>
                  <dd className="tabular-nums text-ink-2">
                    {file.index_status === 'indexing'
                      ? `${file.processed_chunks.toLocaleString()} / ${file.total_chunks.toLocaleString()}`
                      : `${file.total_chunks.toLocaleString()}개`}
                  </dd>
                </>
              )}
              <dt className="text-mute">업로드</dt>
              <dd className="text-ink-2">
                {new Date(file.created_at).toLocaleString('ko-KR')}
              </dd>
            </dl>
            {/* 첫/마지막 질문 — Q&A 형태(질문+답변)로 담긴 문서일 때만 노출.
                문서 처음부터 끝까지 온전히 담겼음을 확인할 수 있다. */}
            {(file.first_question || file.last_question) && (
              <div className="mt-3 space-y-1.5 border-t border-line-soft pt-2 text-xs-soft">
                {file.first_question && (
                  <div>
                    <span className="text-mute">첫 질문</span>
                    <p className="mt-0.5 line-clamp-3 text-ink-2">
                      “{file.first_question}”
                    </p>
                  </div>
                )}
                {file.last_question && (
                  <div>
                    <span className="text-mute">마지막 질문</span>
                    <p className="mt-0.5 line-clamp-3 text-ink-2">
                      “{file.last_question}”
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

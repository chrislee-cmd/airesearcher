'use client';

/* ────────────────────────────────────────────────────────────────────
   SectionGap — 편집 모드 블록 사이 삽입 어포던스 (fresh · BUILD-SPEC §1.4 ·
   S5b .dc.html 비주얼 SSOT). 4상태:

   - 유휴(idle)  : height 26px 고정(레이아웃 점프 방지) · rose/55 선 · 20px 노드
                   border 1.4 line-empty · ＋ line-empty.
   - hover       : rose 선 + 중앙 라벨 pill(border 1.5 ink · rounded-nav ·
                   memphis-sm · 11.5/800 "여기에 절 넣기"). idle 과 같은 26px.
   - 열림(open)  : border 2 ink · rounded-panel · memphis-md-faint 카드 —
                   자연어 지시 textarea + 취소/넣기.
   - pending     : 별도 <PendingSectionCard>(2 dashed processing · lav-bg) 로
                   렌더 — 이 컴포넌트가 아니라 body 가 그 자리에 그린다.

   읽기 모드에는 이 컴포넌트가 아예 마운트되지 않는다(§0.4 하드 — 미렌더).
   섹션 생성 로직은 use-topline-section-insert 재사용(계약 무변경).
   ──────────────────────────────────────────────────────────────────── */

import { useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';

export function SectionGap({
  open,
  busy,
  onOpen,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSubmit: (prompt: string) => void;
}) {
  const t = useTranslations('InterviewsV2');
  const [draft, setDraft] = useState('');

  const submit = () => {
    const p = draft.trim();
    if (!p || busy) return;
    onSubmit(p);
    setDraft('');
  };

  // 열림 — 자연어 지시 카드(S5b 3번째 상태).
  if (open) {
    return (
      <div className="overflow-hidden rounded-panel border-2 border-ink bg-paper shadow-memphis-md-faint">
        <div className="flex flex-col gap-2.5 px-3.5 py-3">
          {/* eslint-disable-next-line react/forbid-elements -- CD S5b 지시 입력은 rounded-control 인라인 chrome; Textarea primitive 의 고정 스타일과 불일치(자동 높이 단행) */}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
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
              if (e.key === 'Escape') onClose();
            }}
            rows={2}
            autoFocus
            disabled={busy}
            placeholder={t('editSectionPlaceholder')}
            aria-label={t('editSectionAdd')}
            className="w-full resize-none rounded-control border-[1.5px] border-ink bg-paper px-3.5 py-2.5 text-md leading-[1.65] text-ink-2 outline-none placeholder:text-faint disabled:opacity-60"
          />
          <div className="flex items-center gap-2.5">
            <span className="font-mono-label text-xs text-mute-soft">
              {t('editSectionGroundedOnly')}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {/* eslint-disable-next-line react/forbid-elements -- CD S5b 취소는 rounded-pill outline chrome; Button variant 형태와 불일치 */}
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="inline-flex items-center rounded-pill border-[1.5px] border-ink/20 px-3.5 py-[7px] text-md font-bold text-mute disabled:opacity-45"
              >
                {t('editSectionCancel')}
              </button>
              {/* eslint-disable-next-line react/forbid-elements -- CD S5b 넣기는 solid ink rounded-pill chrome(memphis-sm-faint); Button primary radius 와 불일치 */}
              <button
                type="button"
                onClick={submit}
                disabled={busy || draft.trim().length === 0}
                className="inline-flex items-center rounded-pill bg-ink px-4 py-[7px] text-md font-extrabold text-paper shadow-memphis-sm-faint disabled:opacity-45"
              >
                {t('editSectionSubmit')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 유휴/hover — 26px 고정 행. group-hover 로 노드↔라벨 pill 스왑(둘 다 26px = 점프 0).
  return (
    <div className="group flex h-[var(--iv-gap-h)] items-center gap-2">
      <span aria-hidden className="h-[1.5px] flex-1 bg-rose/55 group-hover:bg-rose" />
      {/* 유휴 노드 — hover 시 숨김. */}
      <span
        aria-hidden
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-nav border-[1.4px] border-ink/[0.18] bg-paper text-xs font-extrabold leading-none text-line-empty group-hover:hidden"
      >
        ＋
      </span>
      {/* hover 라벨 pill — 유휴엔 숨김. 클릭 시 open. */}
      {/* eslint-disable-next-line react/forbid-elements -- CD S5b hover 라벨은 rounded-nav·memphis-sm 인라인 chrome; Button variant 형태와 불일치 */}
      <button
        type="button"
        onClick={onOpen}
        className="hidden shrink-0 items-center gap-1.5 rounded-nav border-[1.5px] border-ink bg-paper px-[11px] py-1 text-xs font-extrabold text-ink shadow-memphis-sm group-hover:inline-flex focus-visible:inline-flex"
      >
        ＋ {t('editSectionAddHere')}
      </button>
      <span aria-hidden className="h-[1.5px] flex-1 bg-rose/55 group-hover:bg-rose" />
    </div>
  );
}

// 섹션 생성 중 로딩 카드(S5b pending) — 2px dashed processing · lav-bg · 도트
// processing. 명령 제출 후 생성+영속이 끝날 때까지 그 gap 에 렌더된다(낙관적
// 자리표시). 성공 시 refetch 가 실제 inserted_section 으로 대체, 실패 시 제거.
export function PendingSectionCard({ prompt }: { prompt: string }) {
  const t = useTranslations('InterviewsV2');
  return (
    <div
      aria-busy
      className="flex items-center gap-[11px] rounded-panel border-2 border-dashed border-processing bg-lav-bg px-4 py-3.5"
    >
      <span
        aria-hidden
        className="h-[9px] w-[9px] shrink-0 animate-pulse rounded-full bg-processing motion-reduce:animate-none"
      />
      <div className="min-w-0 flex-1">
        <div className="text-md font-extrabold text-lav-text">
          {t('editSectionGenerating')}
        </div>
        <div className="mt-[3px] truncate font-mono-label text-xs text-lav-text">
          &ldquo;{prompt}&rdquo;
        </div>
      </div>
    </div>
  );
}

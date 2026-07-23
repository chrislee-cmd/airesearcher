'use client';

/* ────────────────────────────────────────────────────────────────────
   ProbingFullviewInject — 풀뷰 우 rail 최상단 "추가 질문 주입" 블록.
   design-handoff/inject-followup-fix/INJECT-FOLLOWUP-RESTYLE.md ·
   Widget Fullview Comps.dc.html (frame 01 · Probing · Live).

   #1171 이 복구한 inject 필드가 레거시 외형(얇은 입력 + 플랫 회색 버튼)으로
   렌더돼, CD 델타대로 현재 Memphis 시스템으로 fresh 리빌드한다. 레거시
   ProbingInjectField(호스트 research-context·공유 뷰어가 공유)는 그대로 두고,
   풀뷰 전용 프레젠테이션만 여기서 새로 짓는다(규칙 2c fresh build).

   기능은 불변 — 배선(onInject·IME-safe Enter/click 커밋·disabled-until-nonempty·
   PROBING_INJECT_QUESTION_MAX clamp·backfill 피드백)은 #1171 계약 그대로 재사용.
   외형만 CD 마크업/토큰(mono 미니라벨 · 1.5px ink radius22 입력 · amore 버튼 +
   shadow-memphis-sm · border-b rhythm)으로 교체한다.
   ──────────────────────────────────────────────────────────────────── */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChipInput } from '@/components/ui/chip-input';
import { PROBING_INJECT_QUESTION_MAX } from '@/lib/probing/live-channel';
import type { ProbingBackfillFeedback } from '../../widgets/probing/inject-field';

export function ProbingFullviewInject({
  onInject,
  disabled = false,
  backfillFeedback = null,
}: {
  // "주입"(Enter 또는 버튼 클릭) 시 1회 호출 = handleInjectQuestion(호스트).
  onInject: (question: string) => void;
  disabled?: boolean;
  // 신규 위젯 backfill 진행/결과 (호스트 전용, 없으면 미표시).
  backfillFeedback?: ProbingBackfillFeedback | null;
}) {
  const t = useTranslations('Probing');
  const [draft, setDraft] = useState('');
  const canInject = draft.trim().length > 0 && !disabled;

  function inject() {
    const value = draft.trim().slice(0, PROBING_INJECT_QUESTION_MAX);
    if (!value) return;
    onInject(value);
    setDraft('');
  }

  return (
    // 컨테이너 — 아래 thinking-stream 블록과 동일 border-b / pad 14×16 rhythm.
    <div className="border-b border-line px-4 py-[14px]">
      {/* mono 미니라벨 (10px/700/.14em uppercase · mute-soft) */}
      <div className="mb-[9px] font-mono-label text-xs font-bold uppercase tracking-[0.14em] text-mute-soft">
        {t('inject.label')}
      </div>

      {/* row — 입력(flex:1) + Inject 버튼(shrink-0), stretch 정렬 */}
      <div className="flex items-stretch gap-[9px]">
        <div className="flex min-w-0 flex-1 items-center overflow-hidden rounded-[var(--fv-radius-inject)] border-[1.5px] border-ink bg-paper px-4 py-[11px] focus-within:border-amore">
          <ChipInput
            value={draft}
            onChange={(e) =>
              setDraft(e.target.value.slice(0, PROBING_INJECT_QUESTION_MAX))
            }
            onCommit={inject}
            disabled={disabled}
            placeholder={t('inject.placeholder')}
            className="w-full flex-1 truncate text-lg"
          />
        </div>
        {/* amore CTA — border-2 ink · radius 22 · shadow-memphis-sm. Button
            primitive 의 어느 variant(primary=bg-ink)와도 불일치 → 셸 선례
            (probing-spotlight action chrome)대로 native + eslint-disable. */}
        {/* eslint-disable-next-line react/forbid-elements -- CD inject CTA (amore fill·border-2 ink·radius 22·shadow-memphis-sm) ≠ Button primitive variant (probing-spotlight 셸 선례와 동일). */}
        <button
          type="button"
          onClick={inject}
          disabled={!canInject}
          title={t('inject.injectTitle')}
          className="flex shrink-0 items-center rounded-[var(--fv-radius-inject)] border-2 border-ink bg-amore px-[18px] py-[11px] text-lg font-bold text-white shadow-memphis-sm transition-all duration-[var(--dur-fast)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          {t('inject.inject')}
        </button>
      </div>

      {/* helper — 11px mute-soft · lh 1.5 · mt 8 */}
      <p className="mt-2 text-sm leading-[1.5] text-mute-soft">
        {t('inject.fullviewHelper')}
      </p>

      {backfillFeedback && (
        <p className="mt-1.5 text-sm" aria-live="polite">
          {backfillFeedback.status === 'running' && (
            <span className="text-mute">{t('inject.backfillRunning')}</span>
          )}
          {backfillFeedback.status === 'backfilled' && (
            <span className="text-amore">
              {t('inject.backfillDone', { count: backfillFeedback.count })}
            </span>
          )}
          {backfillFeedback.status === 'empty' && (
            <span className="text-warning">{t('inject.backfillEmpty')}</span>
          )}
        </p>
      )}
    </div>
  );
}

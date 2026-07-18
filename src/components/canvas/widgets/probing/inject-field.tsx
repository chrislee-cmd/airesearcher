'use client';

/* ────────────────────────────────────────────────────────────────────
   ProbingInjectField — "추가 질문 주입" 입력 primitive.

   호스트 우패널(research-context)과 공유 협업 뷰어(share-persona-collab)가
   같은 write 진입점을 공유하도록 research-context 에서 추출
   (probing-share-collaborative-injection). 입력 후 "주입" 버튼(또는 Enter,
   ChipInput 의 IME-safe onCommit)으로 `onInject(question)` 를 1회 호출한다.

   호스트: onInject = handleInjectQuestion (좌 grid 위젯 생성 + AI think
   one-shot 주입). 뷰어: onInject = 채널 `inject` 이벤트 송출 → 호스트가
   같은 handleInjectQuestion 을 호출 → 동일 동작.

   backfillFeedback 은 호스트 전용(누적 대화 backfill 진행/결과). 뷰어는
   호스트 엔진 상태를 모르므로 넘기지 않는다.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Field } from '@/components/canvas/shell/field';
import { ChipInput } from '@/components/ui/chip-input';
import { Button } from '@/components/ui/button';
import { PROBING_INJECT_QUESTION_MAX } from '@/lib/probing/live-channel';

// PR (probing-custom-widget-backfill-and-priority-question): "주입" 으로 새
// 커스텀 위젯을 만들면 부모가 누적 대화 backfill 을 시도한다. 그 진행/결과를
// 입력창 아래 한 줄로 노출한다. (호스트 전용)
export type ProbingBackfillFeedback = {
  status: 'running' | 'backfilled' | 'empty';
  count: number;
};

export function ProbingInjectField({
  onInject,
  disabled = false,
  backfillFeedback = null,
  placeholder,
  confirmLabel,
}: {
  // "주입" 버튼 (또는 Enter) 클릭 시 1회 호출. 갱신과 무관.
  onInject: (question: string) => void;
  disabled?: boolean;
  // 신규 위젯 backfill 진행/결과 (없으면 미표시).
  backfillFeedback?: ProbingBackfillFeedback | null;
  placeholder?: string;
  // 제출 직후 잠깐 노출할 확인 문구. 토스트가 없는 공유 뷰어가 "보냈다" 를
  // 즉시 알 수 있게 한다(호스트는 토스트를 쓰므로 미전달).
  confirmLabel?: string;
}) {
  const t = useTranslations('Probing');
  const [draft, setDraft] = useState('');
  // 제출 시각 — confirmLabel 노출 게이트. 재제출마다 새 값으로 타이머 리셋.
  const [sentAt, setSentAt] = useState<number | null>(null);
  const canInject = draft.trim().length > 0 && !disabled;

  useEffect(() => {
    if (sentAt === null) return;
    const t = setTimeout(() => setSentAt(null), 2600);
    return () => clearTimeout(t);
  }, [sentAt]);

  function inject() {
    const value = draft.trim().slice(0, PROBING_INJECT_QUESTION_MAX);
    if (!value) return;
    onInject(value);
    setDraft('');
    if (confirmLabel) setSentAt(Date.now());
  }

  return (
    <Field
      label={t('inject.label')}
      description={t('inject.description')}
    >
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center rounded-xs border-2 border-ink bg-paper px-3 py-2 min-h-[44px] focus-within:border-amore">
          <ChipInput
            value={draft}
            onChange={(e) =>
              setDraft(e.target.value.slice(0, PROBING_INJECT_QUESTION_MAX))
            }
            onCommit={inject}
            disabled={disabled}
            placeholder={placeholder ?? t('inject.placeholder')}
            className="min-w-[140px] flex-1"
          />
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={inject}
          disabled={!canInject}
          title={t('inject.injectTitle')}
        >
          {t('inject.inject')}
        </Button>
      </div>

      {backfillFeedback && (
        <p className="mt-1.5 text-xs" aria-live="polite">
          {backfillFeedback.status === 'running' && (
            <span className="text-mute">{t('inject.backfillRunning')}</span>
          )}
          {backfillFeedback.status === 'backfilled' && (
            <span className="text-amore">
              {t('inject.backfillDone', { count: backfillFeedback.count })}
            </span>
          )}
          {backfillFeedback.status === 'empty' && (
            <span className="text-warning">
              {t('inject.backfillEmpty')}
            </span>
          )}
        </p>
      )}

      {confirmLabel && sentAt !== null && (
        <p className="mt-1.5 text-xs text-amore" aria-live="polite">
          {confirmLabel}
        </p>
      )}
    </Field>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import type {
  DeskResearchQuestion,
  DeskRqAnswer,
} from '@/components/desk-job-provider';

type TDesk = ReturnType<typeof useTranslations<'Desk'>>;

const CONFIDENCE_ICON: Record<DeskRqAnswer['confidence'], string> = {
  high: '🟢',
  medium: '🟡',
  low: '🔴',
};

// RQ 하나 = 독립 카드. 구조화 데이터 (job.research_questions + rq_answers)
// 기반이라 markdown 파싱 의존 0 — confidence pill / missing-data 까지 안정적.
// desk-card-body 의 옛 RqFindingsSection list item 을 카드 톤으로 재구성.
export function RQCard({
  rq,
  answer,
  tDesk,
}: {
  rq: DeskResearchQuestion;
  answer: DeskRqAnswer | undefined;
  tDesk: TDesk;
}) {
  return (
    <article className="scroll-mt-4 rounded-sm border-2 border-ink bg-paper-soft p-3.5 shadow-[2px_2px_0_var(--color-ink)]">
      <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[.18em] text-mute">
        <span>{rq.id}</span>
        <span className="text-amore">{rq.category}</span>
        <span>
          {tDesk('importance')} {rq.importance}/5
        </span>
        {answer && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-pill border border-line bg-white px-2 py-0.5 normal-case tracking-normal text-mute">
            <span aria-hidden>{CONFIDENCE_ICON[answer.confidence]}</span>
            <span>
              {tDesk('confidenceLabel')} · {answer.confidence}
            </span>
          </span>
        )}
      </div>
      <p className="mt-2 text-sm font-semibold leading-snug text-ink-2">
        {rq.question}
      </p>
      {answer && (
        <>
          <div className="mt-2 whitespace-pre-line text-sm leading-[1.7] text-ink-2">
            {answer.answer_md}
          </div>
          {answer.missing_data.length > 0 && (
            <div className="mt-3 rounded-xs border border-line-soft bg-white px-3 py-2 text-xs text-mute">
              <div className="text-xs uppercase tracking-[.18em] text-mute-soft">
                {tDesk('missingDataLabel')}
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {answer.missing_data.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </article>
  );
}

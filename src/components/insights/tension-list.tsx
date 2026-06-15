'use client';

import type { TensionWithQuotes } from '@/lib/insights-qualitative-load';

// Variant B — paired-quote card list.
// One card per (participant, axis) tension. The two anchor quotes sit
// side by side, mirroring the "검색 우선" UX: a reader can scan and copy
// the verbatim utterance for either pole without re-fetch.
function TensionCard({ tension }: { tension: TensionWithQuotes }) {
  const dominant: 'lo' | 'hi' | 'even' =
    tension.lo_val > tension.hi_val
      ? 'lo'
      : tension.hi_val > tension.lo_val
        ? 'hi'
        : 'even';
  return (
    <div className="border border-line bg-paper p-4 rounded-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13.5px] font-semibold text-ink-2">
          {tension.axis}
        </h3>
        <span className="shrink-0 text-[11px] tabular-nums text-mute-soft">
          {tension.participant_name}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <QuoteBlock
          label="lo"
          val={tension.lo_val}
          quote={tension.lo_quote}
          highlight={dominant === 'lo'}
        />
        <QuoteBlock
          label="hi"
          val={tension.hi_val}
          quote={tension.hi_quote}
          highlight={dominant === 'hi'}
        />
      </div>
    </div>
  );
}

function QuoteBlock({
  label,
  val,
  quote,
  highlight,
}: {
  label: 'lo' | 'hi';
  val: number;
  quote: TensionWithQuotes['lo_quote'];
  highlight: boolean;
}) {
  return (
    <div
      className={`border bg-paper p-3 rounded-sm ${
        highlight ? 'border-amore' : 'border-line-soft'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={`eyebrow-mute ${highlight ? 'text-amore' : ''}`}
        >
          {label}
        </span>
        <span className="text-[10.5px] tabular-nums text-mute-soft">
          {(val * 100).toFixed(0)}%
        </span>
      </div>
      {quote ? (
        <p className="mt-1.5 text-[12px] leading-[1.55] text-ink-2">
          {quote.text}
        </p>
      ) : (
        <p className="mt-1.5 text-[11px] italic text-mute-soft">
          인용구 누락 (원본 quote 삭제됨)
        </p>
      )}
    </div>
  );
}

export function TensionList({ tensions }: { tensions: TensionWithQuotes[] }) {
  if (tensions.length === 0) {
    return (
      <p className="text-[11.5px] leading-[1.55] text-mute-soft">
        이 분석에는 긴장 데이터가 없습니다 (PR 5b 이전 생성된 분석은 새
        분석으로 다시 실행하면 자동 생성됩니다).
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {tensions.map((t) => (
        <TensionCard key={t.id} tension={t} />
      ))}
    </div>
  );
}

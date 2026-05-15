'use client';

import { useEffect, useRef } from 'react';
import {
  useInterviewJob,
  type ThinkingEvent,
} from './interview-job-provider';

export function ThinkingPanel() {
  const { thinkingLog, isWorking, clearThinking } = useInterviewJob();
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [thinkingLog.length]);

  if (thinkingLog.length === 0 && !isWorking) return null;

  return (
    <section className="mt-6 border border-line bg-paper-soft [border-radius:14px]">
      <header className="flex items-center justify-between border-b border-line-soft px-4 py-2">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-1.5 w-1.5 [border-radius:9999px] ${
              isWorking ? 'animate-pulse bg-amore' : 'bg-mute-soft'
            }`}
          />
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
            Thinking · {thinkingLog.length} events
          </span>
        </div>
        {thinkingLog.length > 0 && !isWorking && (
          <button
            onClick={clearThinking}
            className="text-[10px] uppercase tracking-[0.18em] text-mute-soft hover:text-ink-2"
          >
            clear
          </button>
        )}
      </header>
      <div
        ref={scrollerRef}
        className="max-h-[320px] overflow-y-auto px-4 py-3 font-mono text-[12px] leading-[1.7]"
      >
        {thinkingLog.map((evt) => (
          <EventLine key={evt.id} evt={evt} />
        ))}
      </div>
    </section>
  );
}

function EventLine({ evt }: { evt: ThinkingEvent }) {
  switch (evt.type) {
    case 'reading':
      return (
        <div className="text-mute">
          <span className="mr-2 text-amore">›</span>
          <span className="text-ink-2">reading</span>{' '}
          <span className="text-mute-soft">{evt.filename}</span>{' '}
          <span className="text-mute-soft">
            ({evt.chars.toLocaleString()} chars)
          </span>
        </div>
      );
    case 'snippet':
      return (
        <div className="ml-4 italic text-mute-soft">
          “{evt.text}…”
        </div>
      );
    case 'item':
      return (
        <div className="mt-1.5">
          <div className="text-ink-2">
            <span className="mr-2 text-amore">Q.</span>
            {evt.question}
          </div>
          {evt.voc && (
            <div className="ml-6 italic text-mute">
              <span className="not-italic mr-2 text-mute-soft">VOC:</span>“
              {evt.voc}”
            </div>
          )}
        </div>
      );
    case 'complete':
      return (
        <div className="mt-1 border-t border-line-soft pt-1 text-amore">
          ✓ {evt.filename}: {evt.total - evt.invalid}/{evt.total} verbatim verified
          {evt.invalid > 0 && (
            <span className="text-warning"> ({evt.invalid} dropped)</span>
          )}
        </div>
      );
    case 'aggregate_start':
      return (
        <div className="mt-3 text-amore">
          ▷ aggregating per-file extractions into the cross-file matrix…
        </div>
      );
    case 'aggregate_done':
      return (
        <div className="mt-1 text-amore">
          ✓ matrix complete · {evt.rows} rows
        </div>
      );
  }
}

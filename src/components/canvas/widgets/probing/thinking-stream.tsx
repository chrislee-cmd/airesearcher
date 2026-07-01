'use client';

/* ────────────────────────────────────────────────────────────────────
   ProbingThinkingStream — 우패널 4-layer 중 B 번. AI 의 사고 흐름을
   실시간 텍스트로 보여주는 영역.

   PR (probing-question-thinking-flow): `/api/probing/think` SSE 라인
   스트림 중 `THINK: ...` prefix 라인을 누적 표시. 사용자가 다 읽지
   않아도 OK — "AI 가 일하는 중" 시그널 역할. auto-scroll bottom.

   부모 (probing-card) 가 think route 의 stream 을 line buffer 로
   파싱해서 ThinkingEvent[] state 로 흘려준다. ThinkingPulse 는 stream
   진행 중 amore dot pulse — 사용자가 "AI 가 살아 있다" 인지 가능.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useRef } from 'react';
import type { ThinkingEvent } from '../probing-types';

export function ProbingThinkingStream({
  events,
  isStreaming,
}: {
  events: ThinkingEvent[];
  isStreaming: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  // auto-scroll bottom — 새 라인이 도착할 때마다 가장 최근 사고를 보여준다.
  // 사용자가 위로 스크롤 중일 때도 강제로 끌어내리진 않으면 좋겠지만 본
  // 영역은 ~30초 사고가 흐르는 곳이라 단순 강제 스크롤이 자연스럽다 (사용자
  // 시선이 popup / history 로 옮겨가는 게 정상 흐름).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <section className="flex flex-col border-b-[2px] border-line-soft bg-paper">
      <header className="flex items-center justify-between px-4 pb-1 pt-2.5">
        <span className="text-xs uppercase tracking-[0.22em] text-mute-soft">
          AI 의 사고 흐름
        </span>
        <ThinkingPulse active={isStreaming} />
      </header>
      <div
        ref={scrollerRef}
        className="max-h-[180px] overflow-y-auto px-4 pb-3 pt-1 text-sm leading-relaxed text-ink-2"
      >
        {events.length === 0 ? (
          <span className="italic text-mute-soft">
            발화가 누적되면 AI 의 사고 흐름이 표시됩니다…
          </span>
        ) : (
          <ul className="space-y-1">
            {events.map((ev) => (
              <li key={ev.id} className="whitespace-pre-wrap">
                <span className="mr-1.5 text-mute-soft" aria-hidden>
                  ›
                </span>
                {ev.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ThinkingPulse({ active }: { active: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.18em] text-mute-soft"
      aria-live="polite"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          active ? 'bg-amore probing-thinking-pulse' : 'bg-line-soft'
        }`}
        aria-hidden
      />
      {active ? '생각 중' : '대기'}
    </span>
  );
}

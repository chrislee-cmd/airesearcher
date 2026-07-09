'use client';

// 공유 협업 뷰어 — 프로빙 페르소나 read-only 그리드 + 양방향 우패널
// (probing-share-collaborative-injection).
//
// #507 은 read-only 2컬럼 그리드 + 질문 리스트였다. 협업화는 호스트 편집 뷰를
// 미러한다: 좌/메인 = 3컬럼 위젯 그리드(PersonaPanel 재사용, read-only), 우패널 =
//   ① 추가 질문 주입 필드(read-WRITE — 유일한 write 진입점, 채널 inject 송출)
//   ② AI 사고 흐름(read-only, think broadcast)
//   ③ 제안된 질문 전부(read-only, persona 스냅샷 questions)
//
// read-only 불변: 위젯은 순수 표시(PersonaPanel 에 onRemove 미전달 → × 없음),
// 편집/드래그/삭제 진입점 0. 유일한 write = 주입 필드 → onInject → 호스트가
// 자기 주입 파이프라인을 그대로 실행 → persona/think 재브로드캐스트로 미러.

import { useEffect, useRef, useState } from 'react';
import { PersonaPanel } from '@/components/canvas/widgets/probing/persona-panel';
import { ProbingThinkingStream } from '@/components/canvas/widgets/probing/thinking-stream';
import { ProbingInjectField } from '@/components/canvas/widgets/probing/inject-field';
import {
  DEFAULT_PERSONA_PANELS,
  CUSTOM_PANEL_ICON,
} from '@/components/canvas/widgets/probing/persona-section-meta';
import type { ThinkingEvent } from '@/components/canvas/widgets/probing-types';
import type { ProbingPersonaSection } from '@/lib/probing-prompts';
import type {
  ProbingPersonaSnapshot,
  ProbingPersonaSnapshotQuestion,
} from '@/lib/probing-persona-snapshot';

// 기본 섹션 key → 아이콘. custom 섹션은 조각 글리프.
const ICON_BY_KEY = new Map(
  DEFAULT_PERSONA_PANELS.map((p) => [p.key as string, p.icon]),
);

function toSection(
  panel: ProbingPersonaSnapshot['reflection'][number],
): ProbingPersonaSection {
  return {
    summary: panel.summary,
    signals: panel.signals,
    confidence: panel.confidence,
  };
}

// 질문 중요도 → 점 글리프(호스트 편집 뷰 history row 와 동일 표기). importance
// 는 optional string 이라 알 수 없는 값은 점 없이 라벨만.
const IMPORTANCE_DOTS: Record<string, { dots: string; cls: string }> = {
  high: { dots: '●●●', cls: 'text-warning' },
  medium: { dots: '●●○', cls: 'text-amore' },
  low: { dots: '●○○', cls: 'text-mute' },
};

// 제안 질문 한 줄 — read-only(액션 버튼 없음). ★ 핀은 좌측 강조 border.
function QuestionRow({ q }: { q: ProbingPersonaSnapshotQuestion }) {
  const imp = q.importance ? IMPORTANCE_DOTS[q.importance] : undefined;
  const technique = q.technique?.trim();
  return (
    <li
      className={`rounded-xs border bg-paper px-3 py-2 ${
        q.is_starred ? 'border-amore border-l-[3px]' : 'border-line-soft'
      }`}
    >
      <div className="mb-1 flex items-center gap-2">
        {imp && (
          <span className={`text-xs tracking-[0.18em] ${imp.cls}`} aria-hidden>
            {imp.dots}
          </span>
        )}
        {technique && (
          <span className="text-xs uppercase tracking-[0.18em] text-mute-soft">
            {technique}
          </span>
        )}
        {q.is_starred && (
          <span className="text-xs text-amore" aria-label="별표">
            ★
          </span>
        )}
      </div>
      <p className="text-sm leading-snug text-ink-2">{q.text}</p>
      {q.rationale && q.rationale.trim() && (
        <p className="mt-1.5 text-xs leading-relaxed text-mute">{q.rationale}</p>
      )}
    </li>
  );
}

export function SharePersonaCollab({
  snapshot,
  thinkingEvents,
  thinkingStreaming,
  onInject,
  labels,
}: {
  snapshot: ProbingPersonaSnapshot;
  thinkingEvents: ThinkingEvent[];
  thinkingStreaming: boolean;
  onInject: (question: string) => void;
  labels: {
    grid: string;
    questions: string;
    questionsEmpty: string;
    inject: string;
    thinking: string;
  };
}) {
  const panels = snapshot.reflection;
  // 핀(★) 된 질문을 위로 — 호스트 편집 뷰 history 정렬과 동일.
  const questions = [...snapshot.questions].sort((a, b) => {
    if (a.is_starred !== b.is_starred) return a.is_starred ? -1 : 1;
    return 0;
  });

  // 새 위젯 ephemeral 하이라이트 — 브로드캐스트로 도착한 스냅샷에서 이전에 없던
  // 패널 key 를 감지해 마운트 엔트런스 애니메이션을 1회 재생한다(호스트 grid 와
  // 동일 UX). 초기 스냅샷의 key 는 seen 처리해 첫 렌더는 애니메이션 없음.
  const seenKeysRef = useRef<Set<string> | null>(null);
  const [recentKeys, setRecentKeys] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const currentKeys = panels.map((p) => p.key);
    // 빈 스냅샷은 기준선/디프 대상 아님(empty→첫 내용 전환에서 전 패널 flash 방지).
    if (currentKeys.length === 0) return;
    if (seenKeysRef.current === null) {
      // 첫 내용 스냅샷 = 기준선(애니메이션 없음). 이후 새 key 만 하이라이트.
      seenKeysRef.current = new Set(currentKeys);
      return;
    }
    const seen = seenKeysRef.current;
    const fresh = currentKeys.filter((k) => !seen.has(k));
    if (fresh.length === 0) return;
    fresh.forEach((k) => seen.add(k));
    setRecentKeys((prev) => {
      const next = new Set(prev);
      fresh.forEach((k) => next.add(k));
      return next;
    });
    // 키별 fire-and-forget 타이머(effect cleanup 에 묶지 않아 다음 스냅샷이
    // 해제 타이머를 취소하지 않는다).
    fresh.forEach((k) => {
      setTimeout(() => {
        setRecentKeys((prev) => {
          if (!prev.has(k)) return prev;
          const next = new Set(prev);
          next.delete(k);
          return next;
        });
      }, 2000);
    });
  }, [panels]);

  return (
    <div className="flex w-full flex-col gap-6 lg:flex-row">
      {/* 메인 — 3컬럼 위젯 그리드(read-only). */}
      <div className="min-w-0 flex-1">
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mute-soft">
            {labels.grid}
          </h2>
          {panels.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {panels.map((p) => (
                <PersonaPanel
                  key={p.key}
                  icon={ICON_BY_KEY.get(p.key) ?? CUSTOM_PANEL_ICON}
                  title={p.title}
                  section={toSection(p)}
                  highlight={recentKeys.has(p.key)}
                />
              ))}
            </div>
          ) : (
            <p className="text-md text-mute">{labels.questionsEmpty}</p>
          )}
        </section>
      </div>

      {/* 우패널 — 주입(write) / 사고 흐름(read) / 제안 질문(read). */}
      <aside className="w-full shrink-0 space-y-6 lg:w-[340px]">
        <section className="space-y-2 border border-line bg-paper p-4 rounded-sm">
          <ProbingInjectField
            onInject={onInject}
            placeholder="응답자에게 즉시 던질 질문을 입력하세요"
            confirmLabel="✓ 질문을 보냈어요 — 곧 좌측 위젯과 사고 흐름에 반영됩니다"
          />
          <p className="text-xs leading-relaxed text-mute-soft">
            {labels.inject}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mute-soft">
            {labels.thinking}
          </h2>
          <div className="overflow-hidden border border-line rounded-sm">
            <ProbingThinkingStream
              events={thinkingEvents}
              isStreaming={thinkingStreaming}
            />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mute-soft">
            {labels.questions}
          </h2>
          {questions.length > 0 ? (
            <ul className="space-y-1.5">
              {questions.map((q) => (
                <QuestionRow key={q.id} q={q} />
              ))}
            </ul>
          ) : (
            <p className="text-md text-mute">{labels.questionsEmpty}</p>
          )}
        </section>
      </aside>
    </div>
  );
}

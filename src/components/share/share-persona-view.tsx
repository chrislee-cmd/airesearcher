// 공유 뷰어 프로빙 페르소나 — read-only 렌더(#476).
//
// 데이터 = probing_sessions.persona_snapshot(#493) 스냅샷. 편집 뷰의 라이브
// 패널(ReflectionPane/QuestionPane)은 세션 SSE·갱신/생성 액션 props 에 묶여
// 있어 그대로 마운트하면 "지금 갱신 / 한 번 더 생각" 같은 생성 진입점이 노출된다
// (결정 3 위반). 그래서 라이브 패널이 쓰는 **리프 렌더 primitive(PersonaPanel)**
// 를 그대로 재사용해 그리드를 재구성하고(렌더 결과 동일), 질문 영역은 편집
// 뷰 history row 와 같은 디자인 토큰으로 액션 버튼 없이 표시만 한다.
//
// PersonaPanel 은 순수 표시 컴포넌트라 onRemove 를 넘기지 않으면 × 도 없다.

import { PersonaPanel } from '@/components/canvas/widgets/probing/persona-panel';
import {
  DEFAULT_PERSONA_PANELS,
  CUSTOM_PANEL_ICON,
} from '@/components/canvas/widgets/probing/persona-section-meta';
import type { ProbingPersonaSection } from '@/lib/probing-prompts';
import type {
  ProbingPersonaSnapshot,
  ProbingPersonaSnapshotQuestion,
} from '@/lib/probing-persona-snapshot';

// 기본 섹션 key → 아이콘. 스냅샷에 담긴 custom 섹션은 조각 글리프로.
const ICON_BY_KEY = new Map(
  DEFAULT_PERSONA_PANELS.map((p) => [p.key as string, p.icon]),
);

// 스냅샷 패널 → PersonaPanel 이 받는 section shape(summary/signals/confidence).
function toSection(
  panel: ProbingPersonaSnapshot['reflection'][number],
): ProbingPersonaSection {
  return {
    summary: panel.summary,
    signals: panel.signals,
    confidence: panel.confidence,
  };
}

// 질문 중요도 → 점 글리프(편집 뷰 history row 와 동일 표기). 스냅샷 importance
// 는 optional string 이라 알 수 없는 값은 점 없이 라벨만.
const IMPORTANCE_DOTS: Record<string, { dots: string; cls: string }> = {
  high: { dots: '●●●', cls: 'text-warning' },
  medium: { dots: '●●○', cls: 'text-amore' },
  low: { dots: '●○○', cls: 'text-mute' },
};

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

export function SharePersonaView({
  snapshot,
  labels,
}: {
  snapshot: ProbingPersonaSnapshot;
  labels: { grid: string; questions: string; questionsEmpty: string };
}) {
  const panels = snapshot.reflection;
  // 핀(★) 된 질문을 위로 — 편집 뷰 history 정렬과 동일.
  const questions = [...snapshot.questions].sort((a, b) => {
    if (a.is_starred !== b.is_starred) return a.is_starred ? -1 : 1;
    return 0;
  });

  return (
    <div className="space-y-8">
      {panels.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mute-soft">
            {labels.grid}
          </h2>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {panels.map((p) => (
              <PersonaPanel
                key={p.key}
                icon={ICON_BY_KEY.get(p.key) ?? CUSTOM_PANEL_ICON}
                title={p.title}
                section={toSection(p)}
              />
            ))}
          </div>
        </section>
      )}

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
    </div>
  );
}

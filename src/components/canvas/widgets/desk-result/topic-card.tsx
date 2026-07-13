'use client';

import type { DeskTopic } from '@/lib/desk-report-parser';
import { DeskMarkdownBody } from './desk-markdown';

// Findings / Competitive 섹션 안의 `### 토픽` 하나 = sub-card. 섹션 카드보다
// 한 단계 얕은 Memphis 톤 (2px border + 2px shadow + paper-soft) 으로 시각
// 계층을 만든다. 본문은 컴팩트 markdown.
export function TopicCard({ topic }: { topic: DeskTopic }) {
  return (
    // eslint-disable-next-line no-restricted-syntax -- DS-2 가 정확 일치 memphis 토큰 부재로 유지한 잔존(ink 색 오프셋 shadow — 새 토큰 임의 신설 금지). DS-6 lint gate baseline.
    <article className="scroll-mt-4 rounded-sm border-2 border-ink bg-paper-soft p-3 shadow-[2px_2px_0_var(--color-ink)]">
      <header className="mb-2 text-sm font-semibold leading-snug text-ink-2">
        {topic.title}
      </header>
      {topic.body && (
        <div className="min-w-0">
          <DeskMarkdownBody source={topic.body} compact />
        </div>
      )}
    </article>
  );
}

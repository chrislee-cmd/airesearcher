'use client';

import { useTranslations } from 'next-intl';
import type { Citation } from '@/lib/interview-v2/types';

// Interview V2 search — a single citation card. Rendered in the collapsible
// 근거 list under an answer; the inline [chunk_id] badge in the answer
// markdown scrolls to (and briefly highlights) its matching card via the
// `data-citation-id` attribute, scoped within its own Q/A pair so repeated
// chunk_ids across turns don't collide.

export function CitationCard({
  citation,
  highlighted = false,
}: {
  citation: Citation;
  highlighted?: boolean;
}) {
  const t = useTranslations('InterviewsV2');
  return (
    <div
      data-citation-id={citation.chunk_id}
      className={`scroll-mt-4 rounded-sm border p-3 transition-colors duration-300 ${
        highlighted ? 'border-amore bg-amore-bg' : 'border-line-soft bg-paper'
      }`}
    >
      <div className="flex items-center gap-2 text-xs-soft">
        <span className="shrink-0 font-mono text-mute-soft">
          [{citation.chunk_id}]
        </span>
        <span className="min-w-0 truncate font-semibold text-ink-2">
          {citation.filename}
        </span>
        {citation.project_name && (
          <span className="min-w-0 shrink truncate text-mute">
            · {citation.project_name}
          </span>
        )}
        <span className="ml-auto shrink-0 whitespace-nowrap text-mute">
          {t('searchScore')} {Math.round(citation.score * 100)}%
        </span>
      </div>
      <div className="mt-2 whitespace-pre-wrap text-sm leading-[1.7] text-ink-2">
        {citation.excerpt}
      </div>
    </div>
  );
}

'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Citation } from '@/lib/interview-v2/types';
import { CitationPopover } from '@/components/ui/citation-popover';
import { CitationCard } from './citation-card';

// Interview V2 search — one question + streamed answer turn.
//
// The answer is retrieval-grounded markdown with inline [chunk_id]
// citations. We render it with react-markdown; the inline [12] tokens are
// rewritten to markdown links (#cite-12) so react-markdown parses them as
// anchors, and the `a` component swaps those anchors for inline citation
// badges. Clicking a badge opens a popover with the cited chunk's original
// excerpt (filename / project / score / text) — the answer stays the focus
// and the full 근거 list below is collapsed by default.
//
// Citation data comes from `candidates` (the route's x-citations header =
// every retrieved chunk with faithful filename/excerpt/score), keyed by the
// chunk_ids the model actually cited inline. Same philosophy as the route:
// retrieval is authoritative, we don't trust model-echoed fields.

export type QAData = {
  question: string;
  answer_md: string;
  candidates: Citation[];
  streaming?: boolean;
  error?: string | null;
};

// Match inline [123] citations, but not markdown links [123](url).
function citeToken(): RegExp {
  return /\[(\d+)\](?!\()/g;
}

// Rewrite inline [id] tokens (only those we can resolve) into markdown
// links so react-markdown turns them into anchors we can style as badges.
function withCiteLinks(answer: string, valid: Set<string>): string {
  return answer.replace(citeToken(), (full, id: string) =>
    valid.has(id) ? `[${id}](#cite-${id})` : full,
  );
}

// Ordered, de-duped list of chunk_ids actually cited inline (and resolvable
// against the retrieved candidates).
function citedIds(answer: string, valid: Set<string>): string[] {
  const re = citeToken();
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    const id = m[1];
    if (valid.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export function QAPair({ data }: { data: QAData }) {
  const t = useTranslations('InterviewsV2');
  const { question, answer_md, candidates, streaming, error } = data;

  const valid = useMemo(
    () => new Set(candidates.map((c) => c.chunk_id)),
    [candidates],
  );
  const byId = useMemo(
    () => new Map(candidates.map((c) => [c.chunk_id, c])),
    [candidates],
  );
  const cited = useMemo(
    () =>
      citedIds(answer_md, valid)
        .map((id) => byId.get(id))
        .filter((c): c is Citation => Boolean(c)),
    [answer_md, valid, byId],
  );
  const processed = useMemo(
    () => withCiteLinks(answer_md, valid),
    [answer_md, valid],
  );

  const components = useMemo<Components>(
    () => ({
      a: ({ href, children }) => {
        if (href && href.startsWith('#cite-')) {
          const id = href.slice('#cite-'.length);
          const cit = byId.get(id);
          // withCiteLinks only links resolvable ids, so cit is present —
          // fall back to plain text defensively if it ever isn't.
          if (!cit) return <>[{children}]</>;
          return (
            <CitationPopover citation={cit}>{children}</CitationPopover>
          );
        }
        return (
          <a
            href={href ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="break-words text-amore underline decoration-amore/40 underline-offset-2 hover:decoration-amore"
          >
            {children}
          </a>
        );
      },
      h1: ({ children }) => (
        <h1 className="mb-2 mt-4 text-lg font-semibold text-ink first:mt-0">
          {children}
        </h1>
      ),
      h2: ({ children }) => (
        <h2 className="mb-2 mt-3 text-md font-semibold text-ink-2 first:mt-0">
          {children}
        </h2>
      ),
      h3: ({ children }) => (
        <h3 className="mb-1 mt-3 text-md font-semibold text-ink-2 first:mt-0">
          {children}
        </h3>
      ),
      p: ({ children }) => (
        <p className="my-1.5 text-md leading-[1.7] text-ink-2">{children}</p>
      ),
      ul: ({ children }) => (
        <ul className="my-1.5 list-disc space-y-1 pl-5 text-md leading-[1.7] marker:text-mute-soft">
          {children}
        </ul>
      ),
      ol: ({ children }) => (
        <ol className="my-1.5 list-decimal space-y-1 pl-5 text-md leading-[1.7] marker:text-mute-soft">
          {children}
        </ol>
      ),
      li: ({ children }) => <li className="text-ink-2">{children}</li>,
      strong: ({ children }) => (
        <strong className="font-semibold text-ink">{children}</strong>
      ),
      blockquote: ({ children }) => (
        <blockquote className="my-2 border-l-2 border-amore bg-amore-bg px-3 py-1 text-md italic text-ink-2">
          {children}
        </blockquote>
      ),
      code: ({ children }) => (
        <code className="rounded-xs border border-line bg-paper-soft px-1 py-0.5 font-mono text-sm text-ink-2">
          {children}
        </code>
      ),
      table: ({ children }) => (
        <div className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-sm">{children}</table>
        </div>
      ),
      th: ({ children }) => (
        <th className="border border-line-soft bg-paper-soft px-2 py-1 text-left text-xs font-semibold uppercase tracking-[0.18em] text-mute-soft">
          {children}
        </th>
      ),
      td: ({ children }) => (
        <td className="border border-line-soft px-2 py-1 align-top text-ink-2">
          {children}
        </td>
      ),
    }),
    [byId],
  );

  const answerEmpty = answer_md.trim().length === 0;

  return (
    <div className="space-y-3">
      {/* Question — right-aligned, amore tint. */}
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-sm border border-line bg-amore-bg px-4 py-2.5 text-md leading-[1.6] text-ink-2">
          {question}
        </div>
      </div>

      {/* Answer — full-width so tables/lists don't get squeezed. */}
      <div className="rounded-sm border border-line-soft bg-paper px-5 py-4">
        {answerEmpty && streaming ? (
          <div className="flex items-center gap-2 text-sm uppercase tracking-[0.22em] text-amore">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
            {t('searchGenerating')}
          </div>
        ) : error ? (
          <div className="text-md text-warning">{error}</div>
        ) : (
          <div>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
              {processed}
            </ReactMarkdown>
            {streaming && (
              <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-amore align-text-bottom" />
            )}
          </div>
        )}

        {cited.length > 0 && (
          <details className="group mt-4 border-t border-line-soft pt-3">
            <summary className="flex cursor-pointer select-none list-none items-center gap-1 text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
              <span
                aria-hidden
                className="inline-block transition-transform group-open:rotate-90"
              >
                ›
              </span>
              {t('searchSourcesSummary', { count: cited.length })}
            </summary>
            <div className="mt-2 space-y-2">
              {cited.map((c) => (
                <CitationCard key={c.chunk_id} citation={c} />
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

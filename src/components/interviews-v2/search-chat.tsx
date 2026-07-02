'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Citation } from '@/lib/interview-v2/types';
import { parseSearchStream } from '@/lib/interview-v2/parse-stream';
import { QAPair, type QAData } from './qa-pair';
import { QuestionInput } from './question-input';

// Interview V2 search — ChatGPT-style chat surface for a project.
//
// POST /api/interviews/v2/search returns one of two shapes, distinguished by
// content-type:
//   • text/plain  — streamObject partial-JSON body (the normal answer path);
//                    parsed live by parseSearchStream.
//   • application/json — the no_answer / short-circuit path (a complete
//                    { answer_md, citations, no_answer } object).
// Both carry an `x-citations` header = every retrieved chunk, which we use as
// the authoritative source for the citation cards (filename/excerpt/score),
// keyed by the chunk_ids the answer cites inline.

function readCitationsHeader(res: Response): Citation[] {
  const raw = res.headers.get('x-citations');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    return Array.isArray(parsed) ? (parsed as Citation[]) : [];
  } catch {
    return [];
  }
}

function Intro() {
  const t = useTranslations('InterviewsV2');
  const examples = [
    t('searchExample1'),
    t('searchExample2'),
    t('searchExample3'),
  ];
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="max-w-[420px]">
        <h3 className="text-lg font-semibold text-ink-2">
          {t('searchIntroTitle')}
        </h3>
        <p className="mt-2 text-md text-mute">{t('searchIntroHint')}</p>
        <ul className="mt-3 space-y-1.5 text-md italic text-mute-soft">
          {examples.map((q) => (
            <li key={q}>· {q}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function SearchChat({ projectId }: { projectId: string | null }) {
  const t = useTranslations('InterviewsV2');
  const [history, setHistory] = useState<QAData[]>([]);
  const [pending, setPending] = useState<QAData | null>(null);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Keep the tail in view as new turns land / the streamed answer grows.
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [history, pending]);

  const submit = useCallback(
    async (question: string) => {
      if (busy) return;
      setBusy(true);
      setPending({ question, answer_md: '', candidates: [], streaming: true });

      try {
        const res = await fetch('/api/interviews/v2/search', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            question,
            ...(projectId ? { project_id: projectId } : {}),
          }),
        });

        if (!res.ok || !res.body) {
          const raw = await res.text().catch(() => '');
          let detail = '';
          try {
            detail = (JSON.parse(raw) as { error?: string }).error ?? '';
          } catch {
            // non-JSON error body
          }
          setPending(null);
          setHistory((h) => [
            ...h,
            {
              question,
              answer_md: '',
              candidates: [],
              error: detail ? `${t('searchError')} (${detail})` : t('searchError'),
            },
          ]);
          return;
        }

        const candidates = readCitationsHeader(res);
        setPending((p) => (p ? { ...p, candidates } : p));

        let answer = '';
        const contentType = res.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          // no_answer / short-circuit path — a complete object, not a stream.
          const body = (await res.json().catch(() => ({}))) as {
            answer_md?: string;
          };
          answer = body.answer_md ?? '';
          setPending((p) => (p ? { ...p, answer_md: answer } : p));
        } else {
          for await (const chunk of parseSearchStream(res.body)) {
            answer = chunk.answer_md;
            setPending((p) => (p ? { ...p, answer_md: answer } : p));
          }
        }

        setHistory((h) => [
          ...h,
          { question, answer_md: answer, candidates, streaming: false },
        ]);
        setPending(null);
      } catch {
        setPending(null);
        setHistory((h) => [
          ...h,
          { question, answer_md: '', candidates: [], error: t('searchError') },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, projectId, t],
  );

  const empty = history.length === 0 && !pending;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {empty ? (
          <Intro />
        ) : (
          <div className="space-y-6">
            {history.map((h, i) => (
              <QAPair key={i} data={h} />
            ))}
            {pending && <QAPair data={pending} />}
          </div>
        )}
        <div ref={scrollRef} />
      </div>
      <div className="shrink-0 border-t border-line-soft px-4 py-3">
        <QuestionInput onSubmit={submit} disabled={busy} />
      </div>
    </div>
  );
}

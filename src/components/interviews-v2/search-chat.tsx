'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Citation, SearchArtifact } from '@/lib/interview-v2/types';
import { track as trackEvent } from '@/lib/analytics/events';
import { parseSearchStream } from '@/lib/interview-v2/parse-stream';
import { QAPair, type QAData } from './qa-pair';
import { QuestionInput } from './question-input';

// Search scope is decided by the caller, not by an in-chat toggle
// (사용자 결정 2026-07-03 — supersedes the PR #631 scope toggle). The scope
// is expressed entirely through the `projectIds` prop:
//   • null       → this project only (project-detail chat). currentProject
//                   supplies the id we actually query + the header name.
//   • []          → every project (whole-org cross search).
//   • [id, …]     → exactly the picked project set (CrossProjectPicker).
// The header renders a read-only summary of that scope; there is no longer
// an in-chat control to change it.
type CurrentProject = { id: string; name: string };

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

function Intro({ cross }: { cross: boolean }) {
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
          {t(cross ? 'crossIntroTitle' : 'searchIntroTitle')}
        </h3>
        <p className="mt-2 text-md text-mute">
          {t(cross ? 'crossIntroHint' : 'searchIntroHint')}
        </p>
        <ul className="mt-3 space-y-1.5 text-md italic text-mute-soft">
          {examples.map((q) => (
            <li key={q}>· {q}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function SearchChat({
  projectIds,
  currentProject,
  onSearchStart,
}: {
  projectIds: string[] | null;
  currentProject?: CurrentProject;
  // Fired the moment a query is submitted — lets the file list run its
  // per-search "reading" sweep. Optional so other callers are unaffected.
  onSearchStart?: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  const [history, setHistory] = useState<QAData[]>([]);
  const [pending, setPending] = useState<QAData | null>(null);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // cross = the query spans more than a single project (either an explicit
  // pick set or the whole org). null ⇒ single-project (detail) chat.
  const cross = projectIds !== null;

  // Read-only scope summary for the header.
  const scopeLabel =
    projectIds === null
      ? t('scopeCurrentProject', { name: currentProject?.name ?? '' })
      : projectIds.length === 0
        ? t('scopeAll')
        : t('scopeSelected', { count: projectIds.length });

  // Keep the tail in view as new turns land / the streamed answer grows.
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [history, pending]);

  const submit = useCallback(
    async (question: string) => {
      if (busy) return;
      onSearchStart?.();
      // Analytics — 검색 실행 계측. scope: 단일 프로젝트(null) → 'single',
      // 전체 org([]) → 'cross', 선택 집합([id,…]) → 'multi'.
      const scope =
        projectIds === null
          ? 'single'
          : projectIds.length === 0
            ? 'cross'
            : 'multi';
      trackEvent('widget_action', {
        widget: 'interviews',
        action: 'search_query',
        metadata: { scope },
      });
      setBusy(true);
      setPending({
        question,
        answer_md: '',
        candidates: [],
        artifacts: [],
        streaming: true,
      });

      try {
        const res = await fetch('/api/interviews/v2/search', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // Scope wire: single-project (projectIds null) sends the current
          // project's id so retrieval stays scoped to it; a pick set / whole
          // org sends project_ids (backend PR #632). Sending project_ids: null
          // would fall back to "no filter" server-side, so we only send the
          // key that matches the active scope.
          body: JSON.stringify({
            question,
            ...(projectIds === null
              ? currentProject
                ? { project_id: currentProject.id }
                : {}
              : { project_ids: projectIds }),
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
        let artifacts: SearchArtifact[] = [];
        const contentType = res.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          // no_answer / short-circuit path — a complete object, not a stream.
          // This path never carries artifacts (no evidence to ground them).
          const body = (await res.json().catch(() => ({}))) as {
            answer_md?: string;
          };
          answer = body.answer_md ?? '';
          setPending((p) => (p ? { ...p, answer_md: answer } : p));
        } else {
          for await (const chunk of parseSearchStream(res.body)) {
            answer = chunk.answer_md;
            artifacts = chunk.artifacts;
            setPending((p) => (p ? { ...p, answer_md: answer, artifacts } : p));
          }
        }

        setHistory((h) => [
          ...h,
          { question, answer_md: answer, candidates, artifacts, streaming: false },
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
    [busy, projectIds, currentProject, t, onSearchStart],
  );

  const empty = history.length === 0 && !pending;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Scope summary — read-only. The caller fixes the scope via the
          `projectIds` prop; this header just reflects it. */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line-soft px-5 py-2.5">
        <span className="text-xs-soft text-mute-soft">{t('searchScope')}</span>
        <span className="truncate text-xs-soft font-semibold text-ink-2">
          {scopeLabel}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {empty ? (
          <Intro cross={cross} />
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

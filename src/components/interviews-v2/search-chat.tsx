'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Citation, SearchArtifact } from '@/lib/interview-v2/types';
import { track as trackEvent } from '@/lib/analytics/events';
import { parseSearchStream } from '@/lib/interview-v2/parse-stream';
import { QAPair, type QAData } from './qa-pair';
import type { SearchPhase } from './search-phase';
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

function Intro({ cross, file }: { cross: boolean; file: boolean }) {
  const t = useTranslations('InterviewsV2');
  const examples = [
    t('searchExample1'),
    t('searchExample2'),
    t('searchExample3'),
  ];
  // Precedence: single-file scope is the narrowest, so it wins over cross.
  const titleKey = file
    ? 'fileIntroTitle'
    : cross
      ? 'crossIntroTitle'
      : 'searchIntroTitle';
  const hintKey = file
    ? 'fileIntroHint'
    : cross
      ? 'crossIntroHint'
      : 'searchIntroHint';
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="max-w-[420px]">
        <h3 className="text-lg font-semibold text-ink-2">{t(titleKey)}</h3>
        <p className="mt-2 text-md text-mute">{t(hintKey)}</p>
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
  documentId,
  documentName,
  onSearchStart,
}: {
  projectIds: string[] | null;
  currentProject?: CurrentProject;
  // Single-file search scope (file-detail card). When set, retrieval is
  // narrowed to this one document — the narrowest scope, taking precedence
  // over projectIds. documentName drives the "이 파일에서 검색" label.
  documentId?: string;
  documentName?: string;
  // Fired the moment a query is submitted — lets the file list run its
  // per-search "reading" sweep. Optional so other callers are unaffected.
  onSearchStart?: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  const [history, setHistory] = useState<QAData[]>([]);
  const [pending, setPending] = useState<QAData | null>(null);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Single-file scope is the narrowest and wins over the project scope.
  const file = !!documentId;
  // cross = the query spans more than a single project (either an explicit
  // pick set or the whole org). null ⇒ single-project (detail) chat.
  const cross = !file && projectIds !== null;

  // Read-only scope summary for the header.
  const scopeLabel = file
    ? t('scopeCurrentFile', { name: documentName ?? '' })
    : projectIds === null
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
      // Analytics — 검색 실행 계측. scope: 단일 파일(documentId) → 'file',
      // 단일 프로젝트(null) → 'single', 전체 org([]) → 'cross', 선택
      // 집합([id,…]) → 'multi'.
      const scope = file
        ? 'file'
        : projectIds === null
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
        phase: 'sending',
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
            // Single-file scope sends document_id (+ the owning project_id so
            // the audit row is attributed) and supersedes the project scope.
            ...(documentId ? { document_id: documentId } : {}),
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

        // Response head is back → retrieval is done, evidence is in hand
        // (x-citations). We're now waiting on the first answer token.
        const candidates = readCitationsHeader(res);
        setPending((p) => (p ? { ...p, candidates, phase: 'searching' } : p));

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
          // Phase is tracked in a local (React state inside an async loop would
          // read stale). answer_md growth drives searching→answering; once it
          // settles (idle) with citations in hand we assume the answer is done
          // and artifacts are being verified → 'artifacts' (결정 2).
          let phase: SearchPhase = 'searching';
          let lastAnswerLen = 0;
          let idleCount = 0;
          for await (const chunk of parseSearchStream(res.body)) {
            answer = chunk.answer_md;
            artifacts = chunk.artifacts;

            if (phase === 'searching' && answer.length > 0) phase = 'answering';

            if (answer.length > lastAnswerLen) {
              lastAnswerLen = answer.length;
              idleCount = 0;
            } else {
              idleCount++;
            }

            // Answer settled (~500ms idle) + the model grounded it → the
            // silent artifact-verify window we're labelling.
            if (
              phase === 'answering' &&
              idleCount >= 5 &&
              chunk.citations.length > 0
            ) {
              phase = 'artifacts';
            }

            setPending((p) =>
              p ? { ...p, answer_md: answer, artifacts, phase } : p,
            );
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
    [busy, projectIds, currentProject, documentId, file, t, onSearchStart],
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
          <Intro cross={cross} file={file} />
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
        <QuestionInput
          onSubmit={submit}
          disabled={busy}
          placeholder={file ? t('fileSearchPlaceholder') : undefined}
        />
      </div>
    </div>
  );
}

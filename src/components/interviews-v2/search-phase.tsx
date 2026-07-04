'use client';

import { useTranslations } from 'next-intl';

// Interview V2 search — per-turn phase feedback.
//
// A single search turn moves through several stages. The answer text streams
// live (visible), but after `answer_md` completes the server re-verifies and
// materializes artifacts (tables/charts) — a 1-2s window that used to be
// **silent**, reading as "did it freeze?" (사용자 사고 2026-07-04). This tiny
// state machine gives each stage a label so the surface is never mute.
//
// Client-only: the search route / streamObject body is untouched. Phase is
// inferred from `parseSearchStream` partials (see search-chat.tsx submit()).
export type SearchPhase =
  | 'idle' // no turn in flight
  | 'sending' // query POSTed, awaiting the response head
  | 'searching' // retrieval done, awaiting the first answer token
  | 'answering' // answer_md streaming (text visible)
  | 'artifacts' // answer_md settled, artifacts being verified/built
  | 'done' // turn complete (artifacts render)
  | 'error'; // request failed (surfaced inline as its own error row)

// Only the in-flight stages carry an inline label. idle/done/error render
// nothing here (error has its own inline row in QAPair).
const PHASE_LABEL_KEY: Partial<Record<SearchPhase, string>> = {
  sending: 'searchPhaseSending',
  searching: 'searchPhaseSearching',
  answering: 'searchPhaseAnswering',
  artifacts: 'searchPhaseArtifacts',
};

export function PhaseStatus({ phase }: { phase: SearchPhase }) {
  const t = useTranslations('InterviewsV2');
  const key = PHASE_LABEL_KEY[phase];
  if (!key) return null;
  return (
    <div className="mt-2 flex items-center gap-2 text-sm text-mute">
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
      <span>{t(key)}</span>
    </div>
  );
}

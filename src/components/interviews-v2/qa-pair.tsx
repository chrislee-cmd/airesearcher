'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Citation, SearchArtifact } from '@/lib/interview-v2/types';
import { CitationPopover } from '@/components/ui/citation-popover';
import { AnswerArtifactRenderer } from './answer-artifact-renderer';
import { PhaseStatus, type SearchPhase } from './search-phase';

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
//
// 근거 표시 (CD S6·6b 리스킨): 답변 말풍선 하단에 "근거 응답자 N명" 푸터 +
// 응답자 코드 칩(cited 근거를 document 단위로 dedupe). 발췌·점수 전문은 인라인
// 시테이션 배지의 팝오버가 제공하므로 예전의 접이식 근거 카드 리스트는 이
// 푸터로 대체된다(근거 접근 회귀 없음 — 팝오버 유지). 검색 파이프라인/데이터
// 무변경, 순수 프레젠테이션.

export type QAData = {
  question: string;
  answer_md: string;
  candidates: Citation[];
  // Phase 1 structured artifacts (table + quote list). Streamed alongside
  // answer_md and rendered below it once each entry completes.
  artifacts?: SearchArtifact[];
  streaming?: boolean;
  // In-flight stage of this turn — drives the inline phase label so the
  // post-answer artifact-verify window is never silent. Only set while a turn
  // is pending; history turns leave it undefined (equivalent to 'done').
  phase?: SearchPhase;
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

// 근거 응답자 라벨 — CD 6b 는 각 근거 파일을 응답자 코드(R02·R07…)로 압축해
// 칩으로 보여준다. 파일명에 R-코드가 있으면 두 자리로 정규화하고, 없으면
// 확장자 뗀 파일명(과길면 말줄임)으로 폴백한다. 순수 프레젠테이션 파생 —
// 검색 파이프라인/데이터는 건드리지 않는다.
function respondentLabel(filename: string): string {
  const m = filename.match(/R\s*_?(\d{1,3})/i);
  if (m) return `R${m[1].padStart(2, '0')}`;
  const base = filename.replace(/\.[^.]+$/, '');
  return base.length > 14 ? `${base.slice(0, 13)}…` : base;
}

export function QAPair({ data }: { data: QAData }) {
  const t = useTranslations('InterviewsV2');
  const { question, answer_md, candidates, artifacts, streaming, phase, error } =
    data;

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
  // 근거 응답자 — cited 근거를 document_id(없으면 파일명) 단위로 dedupe 해
  // 응답자 칩 세트를 만든다. 등장 순서 유지.
  const respondents = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; label: string }[] = [];
    for (const c of cited) {
      const key = c.document_id || c.filename;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, label: respondentLabel(c.filename) });
    }
    return out;
  }, [cited]);
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
  // 아티팩트 미생성 폴백 (CD 6b) — 답변은 끝났는데 표/차트가 없고 근거 응답자가
  // 1~2명뿐이면(3건 미만) 집계표를 만들지 못했음을 알린다. 근거가 0이거나 3+
  // 이거나 스트리밍/에러 중엔 뜨지 않는다. 대화 파이프라인 무변경 — 이미 손에
  // 있는 근거 수에 대한 프레젠테이션 주석일 뿐이다(보수적 해석, PR 본문 명시).
  const showFallback =
    !streaming &&
    !error &&
    !answerEmpty &&
    (artifacts?.length ?? 0) === 0 &&
    respondents.length >= 1 &&
    respondents.length < 3;

  return (
    <div className="space-y-4">
      {/* 사용자 말풍선 — 우측·rose·radius 14/14/4/14·shadow 2px2px0 ink. */}
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-sm rounded-br-xs border-2 border-ink bg-widget-header-rose px-4 py-2.5 text-md leading-[1.7] text-ink shadow-memphis-sm">
          {question}
        </div>
      </div>

      {/* 응답 말풍선 — 좌측·paper·radius 14/14/14/4·shadow 3px3px0 ink/14. */}
      <div className="flex justify-start">
        <div className="w-full max-w-[92%] overflow-hidden rounded-sm rounded-bl-xs border-2 border-ink bg-paper shadow-memphis-md-faint">
          <div className="px-5 py-4">
            {answerEmpty && streaming ? (
              // Pre-answer stages (sending/searching) — prefer the phase label,
              // fall back to the generic "generating" pill if no phase was set.
              phase && phase !== 'idle' && phase !== 'done' ? (
                <PhaseStatus phase={phase} />
              ) : (
                <div className="flex items-center gap-2 text-sm uppercase tracking-[0.22em] text-amore">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
                  {t('searchGenerating')}
                </div>
              )
            ) : error ? (
              <div className="text-md text-warning">{error}</div>
            ) : (
              <div>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={components}
                >
                  {processed}
                </ReactMarkdown>
                {streaming && (
                  <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-amore align-text-bottom" />
                )}
                {/* Answer text is settled but the turn is still streaming — the
                    post-answer artifact-verify window. Label it so it isn't
                    silent (answering/artifacts self-hide otherwise). */}
                {streaming && phase && <PhaseStatus phase={phase} />}
              </div>
            )}

            {/* Hold artifacts until the turn completes — no partial tables/charts
                mid-stream (결정 3). While streaming, the 'artifacts' phase label
                above stands in for them. */}
            {!streaming && artifacts && artifacts.length > 0 && (
              <AnswerArtifactRenderer artifacts={artifacts} />
            )}
          </div>

          {/* 근거 응답자 푸터 — mono eyebrow + 응답자 코드 칩. */}
          {respondents.length > 0 && (
            <div
              className="bg-paper-soft px-5 py-3"
              style={{ borderTop: '1.5px solid var(--color-line)' }}
            >
              <div
                className="mb-2 font-mono-label font-bold uppercase text-mute-soft"
                style={{ fontSize: 10, letterSpacing: '0.14em' }}
              >
                {t('searchRespondentSources', { count: respondents.length })}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {respondents.map((r) => (
                  <span
                    key={r.key}
                    className="inline-flex items-center rounded-chip bg-paper font-mono-label font-bold text-ink"
                    style={{
                      fontSize: 10.5,
                      padding: '3px 9px',
                      border: '1.4px solid var(--color-line-strong)',
                    }}
                  >
                    {r.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 아티팩트 미생성 폴백 — 중립 muted 말풍선(shadow 없음). */}
      {showFallback && (
        <div className="flex justify-start">
          <div
            className="max-w-[82%] rounded-sm rounded-bl-xs bg-paper-soft px-4 py-3 text-sm leading-[1.75] text-mute"
            style={{ border: '1.5px solid var(--color-line)' }}
          >
            {t('searchNoArtifactFallback')}
          </div>
        </div>
      )}
    </div>
  );
}

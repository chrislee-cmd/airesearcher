'use client';

import { useCallback, useMemo, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { InterviewChat } from '@/components/interview-chat';
import type { IndexStatus } from '@/components/interview-job-provider';

// 우측 패널 — 키워드 검색 (pg_trgm) + 코퍼스 채팅 (기존 InterviewChat) 토글.
// PPT 변환기는 별 spec — 자리만 disabled 버튼으로 남겨 사용자에게 후속 작업
// 이 예정임을 신호한다.

type SearchHit = {
  chunk_id: number;
  document_id: string;
  content: string;
  filename: string;
  heading_path: string[];
  is_quote: boolean;
};

type Mode = 'search' | 'chat';

const SNIPPET_MAX = 320;

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 본문 일부를 매칭 첫 위치 주변으로 윈도잉. 챕터 전체를 한 번에 다 보여주면
// 결과 카드가 너무 커지니, 매칭 첫 위치 기준 좌우 일정 chars 만 노출하고
// 양 끝을 ellipsis 로 잘라낸다.
function makeWindowedSnippet(content: string, query: string): string {
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) {
    return content.length > SNIPPET_MAX
      ? content.slice(0, SNIPPET_MAX) + '…'
      : content;
  }
  const half = Math.floor(SNIPPET_MAX / 2);
  const start = Math.max(0, idx - half);
  const end = Math.min(content.length, start + SNIPPET_MAX);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < content.length ? '…' : '';
  return prefix + content.slice(start, end) + suffix;
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const re = new RegExp(`(${escapeRegex(query)})`, 'gi');
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        re.test(part) ? (
          <mark
            key={i}
            className="bg-amore-bg text-ink-2 font-semibold px-0.5 rounded-xs"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function ResultCard({ hit, query }: { hit: SearchHit; query: string }) {
  const snippet = useMemo(
    () => makeWindowedSnippet(hit.content, query),
    [hit.content, query],
  );
  const heading =
    hit.heading_path.length > 0 ? hit.heading_path.join(' › ') : '(루트)';
  return (
    <li className="border border-line bg-paper p-4 rounded-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs uppercase tracking-[0.18em] text-mute-soft">
        <span className="text-ink-2 font-medium normal-case tracking-normal">
          {hit.filename || '(파일명 없음)'}
        </span>
        <span>§ {heading}</span>
        {hit.is_quote && (
          <span className="text-amore">VERBATIM</span>
        )}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-md leading-[1.7] text-ink-2">
        <HighlightedText text={snippet} query={query} />
      </p>
    </li>
  );
}

export function InterviewSearchPanel({
  jobId,
  indexStatus,
}: {
  jobId: string | null;
  indexStatus: IndexStatus;
}) {
  const [mode, setMode] = useState<Mode>('search');
  const [query, setQuery] = useState('');
  const [committedQuery, setCommittedQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSearch =
    !!jobId &&
    indexStatus === 'done' &&
    query.trim().length > 0 &&
    !searching;

  const handleSearch = useCallback(async () => {
    if (!jobId) return;
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearching(true);
    setError(null);
    setCommittedQuery(trimmed);
    try {
      const res = await fetch('/api/interviews/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId, q: trimmed }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof json?.error === 'string'
            ? json.error
            : `검색 실패: HTTP ${res.status}`,
        );
        setHits([]);
        return;
      }
      const raw = Array.isArray(json?.hits) ? (json.hits as SearchHit[]) : [];
      setHits(raw);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network_error');
      setHits([]);
    } finally {
      setSearching(false);
    }
  }, [jobId, query]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (
        e.key === 'Enter' &&
        !(e.nativeEvent as KeyboardEvent['nativeEvent'] & { isComposing?: boolean })
          .isComposing
      ) {
        e.preventDefault();
        if (canSearch) void handleSearch();
      }
    },
    [canSearch, handleSearch],
  );

  const tabCls = (active: boolean) =>
    `!border-0 !rounded-none !px-3 !py-2 !text-sm uppercase tracking-[0.22em] ${
      active
        ? '!text-ink-2 !border-b-2 !border-amore'
        : '!text-mute hover:!text-ink-2'
    }`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 모드 토글 */}
      <div className="flex shrink-0 items-center justify-between border-b border-line-soft px-5">
        <div className="inline-flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setMode('search')}
            className={tabCls(mode === 'search')}
          >
            🔍 키워드 검색
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setMode('chat')}
            className={tabCls(mode === 'chat')}
            title={
              indexStatus === 'done'
                ? undefined
                : '코퍼스 인덱싱 완료 후 사용할 수 있어요.'
            }
          >
            📨 코퍼스에 질문하기
          </Button>
        </div>
        <Button
          variant="ghost"
          size="xs"
          disabled
          className="!text-sm uppercase tracking-[0.22em] !text-mute-soft"
          title="별 작업으로 준비 중 — 인터뷰 검색 결과/응답을 슬라이드로 자동 생성."
        >
          📊 PPT 변환기 (준비 중)
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {mode === 'search' ? (
          <div className="space-y-5">
            <div className="flex items-stretch gap-2">
              <div className="flex-1">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={
                    indexStatus === 'done'
                      ? '키워드 검색 — 예: 광고, 재구매, 가격 (Enter)'
                      : '코퍼스 인덱싱 완료 후 검색할 수 있어요.'
                  }
                  disabled={!jobId || indexStatus !== 'done'}
                />
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleSearch()}
                disabled={!canSearch}
                className="!text-sm uppercase tracking-[0.18em]"
              >
                {searching ? '검색 중…' : '검색'}
              </Button>
            </div>

            {error && (
              <div className="border border-warning bg-paper px-4 py-3 text-md text-warning rounded-sm">
                {error}
              </div>
            )}

            {hits === null ? (
              <EmptyState
                tone="subtle"
                title={
                  indexStatus === 'done'
                    ? '키워드를 입력하면 인덱싱된 인터뷰에서 관련 발화를 즉시 찾아드려요.'
                    : '코퍼스 인덱싱이 완료되면 검색할 수 있어요.'
                }
              />
            ) : hits.length === 0 ? (
              <EmptyState
                tone="subtle"
                title={`"${committedQuery}" 와(과) 일치하는 발화가 없습니다.`}
                description="다른 키워드를 시도하거나 채팅 모드로 자연어 질문해 보세요."
              />
            ) : (
              <div className="space-y-3">
                <div className="text-xs uppercase tracking-[0.22em] text-mute-soft">
                  결과 {hits.length}건
                </div>
                <ul className="space-y-3">
                  {hits.map((h) => (
                    <ResultCard
                      key={h.chunk_id}
                      hit={h}
                      query={committedQuery}
                    />
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <InterviewChat jobId={jobId} indexStatus={indexStatus} />
        )}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCountUp } from '@/hooks/use-count-up';

type Quote = {
  id: number;
  participant_name: string;
  theme: string | null;
  sentiment: number | null;
  text: string;
  source_file: string | null;
  source_offset: number | null;
};

type SearchResponse = {
  quotes?: Quote[];
  nextCursor?: number | null;
  error?: string;
};

// The server matches the raw query as a single ILIKE substring (one
// trigram-backed pattern against name/theme/text), so highlight that
// same substring verbatim. No operator-stripping needed — the previous
// implementation parsed phrases/exclusions because the server was on
// websearch_to_tsquery; that path is gone in 0027.
function extractHighlightTokens(query: string): string[] {
  const trimmed = query.trim();
  return trimmed.length > 0 ? [trimmed] : [];
}

function HighlightedText({ text, tokens }: { text: string; tokens: string[] }) {
  if (tokens.length === 0) return <>{text}</>;
  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            className="rounded-[2px] bg-amore/15 px-[1px] text-ink"
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

export function QuoteSearchPanel({ jobId }: { jobId: string }) {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [results, setResults] = useState<Quote[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  // 결과 카운트 count-up — "N개 일치" 의 N 이 새 검색 결과 수까지 부드럽게
  // 증가/감소. reduced-motion 시 즉시 최종값(훅이 내부 존중).
  const displayCount = useCountUp(results.length);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  // Single-flight: a stale request that resolves after a newer one started
  // must NOT overwrite results. The ref-versioned guard drops late responses.
  const reqIdRef = useRef(0);
  useEffect(() => {
    if (!debouncedQ) return;
    const myReq = ++reqIdRef.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reflect async fetch result
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch('/api/insights/quotes/search', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jobId, q: debouncedQ }),
        });
        const json: SearchResponse = await res.json();
        if (myReq !== reqIdRef.current) return;
        if (!res.ok) {
          setError(json.error ?? `http_${res.status}`);
          setResults([]);
          setCursor(null);
          return;
        }
        setResults(json.quotes ?? []);
        setCursor(json.nextCursor ?? null);
        setHasSearched(true);
      } catch (e) {
        if (myReq !== reqIdRef.current) return;
        setError(e instanceof Error ? e.message : 'network_error');
      } finally {
        if (myReq === reqIdRef.current) setLoading(false);
      }
    })();
  }, [jobId, debouncedQ]);

  async function loadMore() {
    if (cursor == null || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch('/api/insights/quotes/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId, q: debouncedQ, cursor }),
      });
      const json: SearchResponse = await res.json();
      if (!res.ok) {
        setError(json.error ?? `http_${res.status}`);
        return;
      }
      setResults((prev) => [...prev, ...(json.quotes ?? [])]);
      setCursor(json.nextCursor ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network_error');
    } finally {
      setLoadingMore(false);
    }
  }

  const tokens = useMemo(
    () => extractHighlightTokens(debouncedQ),
    [debouncedQ],
  );

  return (
    <div className="border border-line bg-paper p-5 rounded-sm">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="text-md font-medium text-ink-2">인용구 검색</div>
        <div className="text-sm text-mute-soft">단어 일부만 입력해도 매칭</div>
      </div>
      <Input
        type="search"
        placeholder="이름·테마·발화 내용 검색"
        value={q}
        onChange={(e) => {
          const next = e.target.value;
          setQ(next);
          // Reset on clear right here so the effect can stay a pure
          // "fetch on non-empty query" loop (no setState-in-effect lint
          // warning, no cascading render on initial mount).
          if (next.trim().length === 0) {
            setResults([]);
            setCursor(null);
            setHasSearched(false);
            setError(null);
          }
        }}
        autoComplete="off"
        spellCheck={false}
      />

      {error && (
        <div className="mt-3 text-sm text-warning">{error}</div>
      )}

      {debouncedQ && (
        <div className="mt-4 text-sm text-mute-soft tabular-nums">
          {loading
            ? '검색 중…'
            : results.length === 0 && hasSearched
              ? '일치하는 인용구가 없습니다'
              : `${displayCount}개${cursor != null ? '+' : ''} 일치`}
        </div>
      )}

      {results.length > 0 && (
        <ul className="stagger mt-3 divide-y divide-line-soft">
          {results.map((row) => (
            <li key={row.id} className="py-3">
              <div className="flex items-baseline justify-between gap-3 text-sm text-mute-soft">
                <span className="truncate font-medium text-ink-2">
                  {row.participant_name}
                </span>
                <span className="shrink-0 truncate">
                  {row.theme ? row.theme : '—'}
                  {row.source_file ? ` · ${row.source_file}` : ''}
                </span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-md leading-[1.55] text-ink">
                <HighlightedText text={row.text} tokens={tokens} />
              </p>
            </li>
          ))}
        </ul>
      )}

      {cursor != null && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="secondary"
            size="sm"
            onClick={loadMore}
            disabled={loadingMore}
            loading={loadingMore}
            loadingLabel="불러오는 중…"
          >
            더 보기
          </Button>
        </div>
      )}
    </div>
  );
}

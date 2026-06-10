'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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

// Pull out the substrings that should render with <mark> highlighting.
// We strip websearch operators (-exclude, OR/AND, double-quotes) so the
// visual highlight tracks what actually contributed to a positive match,
// not the raw query string the user typed.
function extractHighlightTokens(query: string): string[] {
  const phrases: string[] = [];
  const stripped = query.replace(/"([^"]+)"/g, (_, captured: string) => {
    phrases.push(captured);
    return ' ';
  });
  const words = stripped
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0 && !w.startsWith('-'))
    .filter((w) => {
      const upper = w.toUpperCase();
      return upper !== 'OR' && upper !== 'AND';
    });
  return [...phrases, ...words];
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
    <div className="border border-line bg-paper p-5 [border-radius:14px]">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="text-[12.5px] font-medium text-ink-2">인용구 검색</div>
        <div className="text-[11px] text-mute-soft">
          {`구문 "..." · 제외 -단어 · OR 지원`}
        </div>
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
        <div className="mt-3 text-[11.5px] text-warning">{error}</div>
      )}

      {debouncedQ && (
        <div className="mt-4 text-[11px] text-mute-soft tabular-nums">
          {loading
            ? '검색 중…'
            : results.length === 0 && hasSearched
              ? '일치하는 인용구가 없습니다'
              : `${results.length}개${cursor != null ? '+' : ''} 일치`}
        </div>
      )}

      {results.length > 0 && (
        <ul className="mt-3 divide-y divide-line-soft">
          {results.map((row) => (
            <li key={row.id} className="py-3">
              <div className="flex items-baseline justify-between gap-3 text-[11px] text-mute-soft">
                <span className="truncate font-medium text-ink-2">
                  {row.participant_name}
                </span>
                <span className="shrink-0 truncate">
                  {row.theme ? row.theme : '—'}
                  {row.source_file ? ` · ${row.source_file}` : ''}
                </span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-[1.55] text-ink">
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

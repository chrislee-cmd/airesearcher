'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import type { IndexStatus } from './interview-job-provider';

// Chat surface for PR-2 of the interview redesign. Renders inside the
// 결과 화면 tab system in interview-analyzer.tsx. Streaming POST shape is
// the same plain-text pattern used by /api/reports/generate — we just
// accumulate the body into the in-flight assistant message and let
// react-markdown re-render on each chunk.

const MAX_MESSAGES = 100;
const TOAST_TIMEOUT = 5000;

type ChatCitation = {
  document_id: string;
  chunk_id: number;
  filename: string;
  heading_path: string[];
};

type ChatMessage = {
  // Local id (crypto.randomUUID) for React keys. Persisted DB id from
  // the GET history endpoint lives in dbId so the two can co-exist
  // during a single session.
  id: string;
  dbId?: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: ChatCitation[];
  // Set on the assistant turn that is currently being streamed. UI
  // shows a typing cursor and disables the input while true.
  streaming?: boolean;
};

type IndexInfo = {
  status: IndexStatus;
  document_count: number;
  chunk_count: number;
};

const PLACEHOLDER_EXAMPLES = [
  '응답자들이 가장 자주 언급한 페인포인트는?',
  '제품 A 와 B 를 비교한 발언만 모아줘',
  '재구매 의향이 높은 응답자들의 공통점은?',
];

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random()}`;
}

function ChatMarkdown({ source }: { source: string }) {
  // Trimmed-down version of the editorial markdown styling in
  // video-analyzer.tsx — chat messages render in a narrower column and
  // we want less vertical air per element so threads stay scannable.
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="mb-2 mt-4 text-xl font-semibold text-ink first:mt-0">
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="mb-2 mt-3 text-lg font-semibold text-ink-2 first:mt-0">
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
          <code className="border border-line bg-paper-soft px-1 py-0.5 font-mono text-sm text-ink-2 rounded-xs">
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
      }}
    >
      {source}
    </ReactMarkdown>
  );
}

function CitationsList({ items }: { items: ChatCitation[] }) {
  // De-dupe by (filename, heading_path) so the same chunk pulled twice
  // doesn't render twice. The model's in-body [N] references can repeat
  // freely; the bibliography stays clean.
  const seen = new Set<string>();
  const unique: ChatCitation[] = [];
  for (const c of items) {
    const key = `${c.filename}::${c.heading_path.join(' > ')}::${c.chunk_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }
  if (unique.length === 0) return null;
  return (
    <div className="mt-3 border-t border-line-soft pt-3">
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
        근거
      </div>
      <ul className="space-y-1">
        {unique.map((c, i) => {
          const heading =
            c.heading_path.length > 0 ? c.heading_path.join(' > ') : '(루트)';
          return (
            <li key={`${c.chunk_id}-${i}`} className="text-sm leading-[1.6]">
              <span className="text-mute-soft tabular-nums">[{i + 1}]</span>{' '}
              <span className="text-ink-2">{c.filename}</span>
              <span className="text-mute"> § {heading}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  // User turns sit on the right with a tinted background; assistant
  // turns flow full-width on the left so long responses (tables, lists)
  // don't get squeezed.
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] border border-line bg-paper-soft px-4 py-3 rounded-sm">
          <div className="whitespace-pre-wrap text-md leading-[1.65] text-ink-2">
            {message.content}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="border border-line-soft bg-paper px-5 py-4 rounded-sm">
        {message.content.trim().length === 0 && message.streaming ? (
          <div className="flex items-center gap-2 text-sm uppercase tracking-[0.22em] text-amore">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
            응답 생성 중
          </div>
        ) : (
          <ChatMarkdown source={message.content} />
        )}
        {message.citations && message.citations.length > 0 && (
          <CitationsList items={message.citations} />
        )}
      </div>
    </div>
  );
}

export function InterviewChat({
  jobId,
  indexStatus,
}: {
  jobId: string | null;
  indexStatus: IndexStatus;
}) {
  const [info, setInfo] = useState<IndexInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Fetch index status (document_count / chunk_count) for the header
  // strip. We pass through whatever the provider already reported as
  // status — the GET is just for the counts. setState calls run inside
  // queueMicrotask so they don't trip react-hooks/set-state-in-effect
  // (the rule fires when state writes happen synchronously in the
  // effect body — see interview-job-provider.tsx for the same pattern).
  useEffect(() => {
    let cancelled = false;
    if (!jobId) {
      queueMicrotask(() => {
        if (!cancelled) setInfo(null);
      });
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      try {
        const res = await fetch(
          `/api/interviews/index/status?job_id=${encodeURIComponent(jobId)}`,
        );
        if (!res.ok) return;
        const j = (await res.json()) as IndexInfo;
        if (!cancelled) setInfo(j);
      } catch {
        // Non-fatal — the header just won't show the counts.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, indexStatus, reindexing]);

  // Restore conversation on mount / job change. Only fires once the
  // job is indexed — pre-index there is no thread to restore.
  useEffect(() => {
    let cancelled = false;
    if (!jobId || indexStatus !== 'done') {
      queueMicrotask(() => {
        if (cancelled) return;
        setMessages([]);
        setHistoryLoaded(true);
      });
      return () => {
        cancelled = true;
      };
    }
    queueMicrotask(() => {
      if (!cancelled) setHistoryLoaded(false);
    });
    void (async () => {
      try {
        const res = await fetch(
          `/api/interviews/chat?job_id=${encodeURIComponent(jobId)}`,
        );
        if (!res.ok) return;
        const j = (await res.json()) as {
          messages: {
            id: string;
            role: 'user' | 'assistant';
            content: string;
            citations: ChatCitation[] | null;
            created_at: string;
          }[];
        };
        if (cancelled) return;
        setMessages(
          j.messages.map((m) => ({
            id: newId(),
            dbId: m.id,
            role: m.role,
            content: m.content,
            citations: m.citations ?? undefined,
          })),
        );
      } catch {
        // Leave the thread empty — fresh conversation is still usable.
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, indexStatus]);

  // Auto-scroll to the tail whenever a new message lands or the
  // currently-streaming reply grows. Ref the bottom sentinel and use
  // scrollIntoView so this works even inside a scroll container we
  // didn't author.
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages]);

  // Auto-dismiss the inline error after a few seconds so the user
  // doesn't have to manually clear it before the next attempt.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), TOAST_TIMEOUT);
    return () => clearTimeout(t);
  }, [error]);

  const canSend = useMemo(
    () =>
      !!jobId &&
      indexStatus === 'done' &&
      historyLoaded &&
      input.trim().length > 0 &&
      messages.length < MAX_MESSAGES &&
      !sending,
    [jobId, indexStatus, historyLoaded, input, messages.length, sending],
  );

  const send = useCallback(async () => {
    if (!jobId) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    if (sending) return;
    if (messages.length >= MAX_MESSAGES) {
      setError('대화가 100개 메시지에 도달했습니다. 새 인터뷰 잡에서 이어 가세요.');
      return;
    }
    setSending(true);
    setError(null);

    const userMsg: ChatMessage = {
      id: newId(),
      role: 'user',
      content: trimmed,
    };
    const placeholderId = newId();
    const placeholder: ChatMessage = {
      id: placeholderId,
      role: 'assistant',
      content: '',
      streaming: true,
    };
    const nextMessages = [...messages, userMsg, placeholder];
    setMessages(nextMessages);
    setInput('');

    // Send only role + content to keep the wire format small.
    const conversation = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const res = await fetch('/api/interviews/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          interview_job_id: jobId,
          conversation,
        }),
      });
      if (!res.ok || !res.body) {
        const raw = await res.text().catch(() => '');
        let detail = '';
        try {
          const parsed = raw ? (JSON.parse(raw) as { error?: string }) : {};
          detail = parsed.error ?? '';
        } catch {
          // raw was not JSON
        }
        setError(
          detail === 'not_indexed'
            ? '인덱스가 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.'
            : detail || `요청 실패: HTTP ${res.status}`,
        );
        // Roll back the placeholder so the user can retry without
        // staring at an empty assistant card.
        setMessages((prev) => prev.filter((m) => m.id !== placeholderId));
        return;
      }

      // Citations arrive in a response header — set them on the
      // placeholder before the body finishes streaming so the근거
      // section renders alongside the text.
      const rawCitations = res.headers.get('x-citations');
      let citations: ChatCitation[] | undefined;
      if (rawCitations) {
        try {
          citations = JSON.parse(decodeURIComponent(rawCitations)) as ChatCitation[];
        } catch {
          citations = undefined;
        }
      }
      if (citations) {
        setMessages((prev) =>
          prev.map((m) => (m.id === placeholderId ? { ...m, citations } : m)),
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === placeholderId ? { ...m, content: acc } : m,
          ),
        );
      }
      // Flush any trailing buffered bytes the streaming loop missed.
      acc += decoder.decode();
      setMessages((prev) =>
        prev.map((m) =>
          m.id === placeholderId
            ? { ...m, content: acc, streaming: false }
            : m,
        ),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'network_error';
      setError(`요청 실패: ${msg}`);
      setMessages((prev) => prev.filter((m) => m.id !== placeholderId));
    } finally {
      setSending(false);
    }
  }, [input, jobId, messages, sending]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter submits, Shift+Enter inserts a newline — same convention
      // as most chat surfaces. We also bail when composition (IME) is
      // active so Korean / Japanese typists don't fire mid-word.
      if (
        e.key === 'Enter' &&
        !e.shiftKey &&
        !(e.nativeEvent as KeyboardEvent['nativeEvent'] & { isComposing?: boolean })
          .isComposing
      ) {
        e.preventDefault();
        if (canSend) void send();
      }
    },
    [canSend, send],
  );

  const runReindex = useCallback(async () => {
    if (!jobId) return;
    setReindexing(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/interviews/index/run-now?job_id=${encodeURIComponent(jobId)}`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        if (j?.error === 'no_corpus') {
          setError(
            '이 인터뷰는 인덱싱 대상이 아닙니다 (PR-1 이전 생성된 잡). 새 인터뷰 잡을 만들어 주세요.',
          );
        } else {
          setError(`인덱싱 실패: ${j?.error ?? `HTTP ${res.status}`}`);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network_error');
    } finally {
      setReindexing(false);
    }
  }, [jobId]);

  // No persisted snapshot yet (pre-analysis state). Render a hint and
  // bail — there's nothing to chat with until the report is saved.
  if (!jobId) {
    return (
      <div className="border border-line-soft bg-paper-soft px-5 py-6 text-md text-mute rounded-sm">
        분석이 완료되면 이 코퍼스에 자유롭게 질문할 수 있어요. 잠시만 기다려
        주세요.
      </div>
    );
  }

  if (indexStatus !== 'done') {
    // Indexed-but-failed (`error`) and still-indexing branches share the
    // same disabled shell — different copy + a "지금 인덱싱" CTA when we
    // know retrying is reasonable.
    const label =
      indexStatus === 'indexing'
        ? '코퍼스를 인덱싱하고 있어요. 잠시 후 다시 시도해 주세요.'
        : indexStatus === 'error'
          ? '인덱싱 중 오류가 발생했어요. 다시 시도하거나 인터뷰를 다시 실행해 주세요.'
          : '이 인터뷰는 아직 인덱싱되지 않아 채팅 기능을 사용할 수 없습니다.';
    return (
      <div className="space-y-3">
        <div className="border border-line-soft bg-paper-soft px-5 py-6 rounded-sm">
          <p className="text-md text-mute">{label}</p>
          {(indexStatus === 'pending' ||
            indexStatus === 'error' ||
            indexStatus === 'idle') && (
            <div className="mt-3">
              <Button
                variant="primary"
                size="xs"
                onClick={runReindex}
                disabled={reindexing}
                className="!text-sm uppercase tracking-[0.18em]"
              >
                {reindexing ? '인덱싱 중…' : '지금 인덱싱'}
              </Button>
            </div>
          )}
        </div>
        {error && (
          <div className="border border-warning bg-paper px-4 py-3 text-md text-warning rounded-sm">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header strip — chunk / document counts. Hidden until the GET
          status call returns so the strip doesn't flash 0/0 mid-load. */}
      {info && (
        <div className="flex items-center justify-between border-b border-line-soft pb-2 text-sm text-mute">
          <span>
            <span className="text-ink-2 font-medium tabular-nums">
              {info.document_count}
            </span>
            개 인터뷰 ·{' '}
            <span className="text-ink-2 font-medium tabular-nums">
              {info.chunk_count}
            </span>
            개 청크 인덱싱됨
          </span>
          <span className="text-xs uppercase tracking-[0.22em] text-mute-soft">
            대화 {messages.length} / {MAX_MESSAGES}
          </span>
        </div>
      )}

      {/* Thread — empty-state guidance lives here so the user sees
          actionable examples instead of a blank slate. */}
      <div className="min-h-[280px] space-y-4">
        {messages.length === 0 ? (
          <div className="border border-line-soft bg-paper-soft px-5 py-6 rounded-sm">
            <p className="text-md text-mute">
              이 코퍼스에 자유롭게 질문해 보세요. 예시:
            </p>
            <ul className="mt-2 space-y-1.5 text-md italic text-mute-soft">
              {PLACEHOLDER_EXAMPLES.map((q) => (
                <li key={q}>· {q}</li>
              ))}
            </ul>
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
        <div ref={scrollRef} />
      </div>

      {error && (
        <div className="border border-warning bg-paper px-4 py-3 text-md text-warning rounded-sm">
          {error}
        </div>
      )}

      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="질문을 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈)"
            disabled={sending || messages.length >= MAX_MESSAGES}
          />
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void send()}
          disabled={!canSend}
          className="!text-sm uppercase tracking-[0.18em]"
        >
          전송
        </Button>
      </div>
    </div>
  );
}

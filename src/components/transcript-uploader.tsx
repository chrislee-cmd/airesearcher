'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { useRequireAuth } from './auth-provider';
import { track } from './mixpanel-provider';

const MAX_BYTES = 25 * 1024 * 1024;

const ACCEPT =
  'audio/*,video/*,text/plain,text/markdown,.txt,.md,.markdown,.csv,.json,.log,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

type Status = 'queued' | 'transcribing' | 'done' | 'error';

type Item = {
  id: string;
  file: File;
  status: Status;
  transcript?: string;
  error?: string;
  expanded?: boolean;
  outputChars?: number;
};

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fileKind(file: File): 'audio' | 'video' | 'text' | 'docx' | 'other' {
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  if (/\.(docx|doc)$/i.test(file.name)) return 'docx';
  if (
    file.type.startsWith('text/') ||
    file.type === 'application/json' ||
    /\.(txt|md|markdown|csv|json|log)$/i.test(file.name)
  ) {
    return 'text';
  }
  return 'other';
}

export function TranscriptUploader() {
  const t = useTranslations('Features.uploader');
  const tCommon = useTranslations('Common');
  const requireAuth = useRequireAuth();
  const router = useRouter();

  const [items, setItems] = useState<Item[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const queuedCount = items.filter((i) => i.status === 'queued').length;
  const doneCount = items.filter((i) => i.status === 'done').length;

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files);
    const next: Item[] = arr.map((file) => {
      const oversize = file.size > MAX_BYTES;
      return {
        id:
          (typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`) as string,
        file,
        status: oversize ? 'error' : 'queued',
        error: oversize ? 'fileTooLarge' : undefined,
      };
    });
    setItems((prev) => [...prev, ...next]);
  }, []);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    if (!dragOver) setDragOver(true);
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    if (e.currentTarget === e.target) setDragOver(false);
  }

  function remove(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function clear() {
    setItems([]);
  }

  function toggleExpanded(id: string) {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, expanded: !i.expanded } : i)),
    );
  }

  async function processOne(id: string) {
    setItems((prev) =>
      prev.map((i) =>
        i.id === id ? { ...i, status: 'transcribing', error: undefined } : i,
      ),
    );
    const target = items.find((i) => i.id === id);
    if (!target) return;
    track('transcribe_start', {
      type: target.file.type,
      size: target.file.size,
    });

    const fd = new FormData();
    fd.append('file', target.file);

    try {
      const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) {
        setItems((prev) =>
          prev.map((i) =>
            i.id === id
              ? { ...i, status: 'error', error: json.error ?? res.statusText }
              : i,
          ),
        );
        track('transcribe_error', { reason: json.error });
      } else {
        setItems((prev) =>
          prev.map((i) =>
            i.id === id
              ? {
                  ...i,
                  status: 'done',
                  transcript: json.transcript,
                  outputChars: json.output_chars,
                  expanded: true,
                }
              : i,
          ),
        );
        track('transcribe_success', {});
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'network_error';
      setItems((prev) =>
        prev.map((i) =>
          i.id === id ? { ...i, status: 'error', error: msg } : i,
        ),
      );
    }
  }

  async function startAll() {
    requireAuth(() => {
      void runAll();
    });
  }

  async function runAll() {
    if (running) return;
    setRunning(true);
    const queue = items.filter((i) => i.status === 'queued').map((i) => i.id);
    for (const id of queue) {
      // Sequential — keeps cost predictable and stays well under any rate limit.
      // Concurrent batching can come later.
      await processOne(id);
    }
    setRunning(false);
    // Refresh server components (topbar credits) after the batch.
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        className={`flex cursor-pointer flex-col items-center justify-center border bg-paper py-12 text-center transition-colors duration-[120ms] [border-radius:4px] ${
          dragOver
            ? 'border-amore bg-amore-bg'
            : 'border-dashed border-line hover:border-mute-soft'
        }`}
        style={{ borderStyle: dragOver ? 'solid' : 'dashed' }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <div className="text-[13.5px] font-medium text-ink-2">
          {dragOver ? t('dropActive') : t('dropHere')}
        </div>
        <div className="mt-2 text-[11.5px] text-mute-soft">{t('supported')}</div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
          className="mt-5 border border-line bg-paper px-4 py-1.5 text-[11.5px] text-mute transition-colors duration-[120ms] hover:text-ink-2 [border-radius:4px]"
        >
          {t('browse')}
        </button>
      </div>

      {items.length > 0 && (
        <>
          <div className="flex items-center justify-between border-b border-line-soft pb-2 text-[11.5px] text-mute">
            <span className="tabular-nums">
              {doneCount === items.length
                ? t('filesDone', { done: doneCount, total: items.length })
                : queuedCount > 0
                ? t('filesQueued', { count: queuedCount })
                : t('filesDone', { done: doneCount, total: items.length })}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={clear}
                disabled={running}
                className="border border-line px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-mute transition-colors duration-[120ms] hover:text-ink-2 disabled:opacity-40 [border-radius:4px]"
              >
                {t('clear')}
              </button>
              <button
                onClick={startAll}
                disabled={queuedCount === 0 || running}
                className="border border-ink bg-ink px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-paper transition-colors duration-[120ms] hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
              >
                {running ? tCommon('loading') : t('transcribeAll')}
              </button>
            </div>
          </div>

          <ul className="border border-line bg-paper [border-radius:4px]">
            {items.map((item) => (
              <FileRow
                key={item.id}
                item={item}
                onRemove={() => remove(item.id)}
                onToggle={() => toggleExpanded(item.id)}
                t={t}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function FileRow({
  item,
  onRemove,
  onToggle,
  t,
}: {
  item: Item;
  onRemove: () => void;
  onToggle: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const kind = fileKind(item.file);
  return (
    <li className="border-t border-line-soft first:border-t-0">
      <div className="flex items-center gap-4 px-5 py-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
          {kind}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-ink-2">{item.file.name}</div>
          <div className="mt-0.5 flex items-center gap-3 text-[11px] text-mute-soft tabular-nums">
            <span>{formatBytes(item.file.size)}</span>
            <StatusPill status={item.status} t={t} />
            {item.status === 'done' && item.outputChars !== undefined && (
              <span className="text-amore">
                {item.outputChars.toLocaleString()} chars
              </span>
            )}
            {item.error && (
              <span className="text-warning">
                {item.error === 'fileTooLarge' ? t('fileTooLarge') : item.error}
              </span>
            )}
          </div>
        </div>
        {item.status === 'done' && item.transcript && (
          <button
            onClick={onToggle}
            className="text-[11px] uppercase tracking-[0.18em] text-mute transition-colors duration-[120ms] hover:text-ink-2"
          >
            {item.expanded ? t('hideTranscript') : t('viewTranscript')}
          </button>
        )}
        <button
          onClick={onRemove}
          aria-label={t('remove')}
          className="text-[11px] uppercase tracking-[0.18em] text-mute-soft transition-colors duration-[120ms] hover:text-warning"
        >
          ✕
        </button>
      </div>
      {item.status === 'done' && item.transcript && item.expanded && (
        <div className="border-t border-line-soft px-5 pb-4 pt-3">
          <pre className="whitespace-pre-wrap text-[12.5px] leading-[1.75] text-ink-2">
            {item.transcript}
          </pre>
        </div>
      )}
    </li>
  );
}

function StatusPill({
  status,
  t,
}: {
  status: Status;
  t: ReturnType<typeof useTranslations>;
}) {
  const map: Record<Status, { text: string; cls: string }> = {
    queued: { text: t('queued'), cls: 'text-mute-soft' },
    transcribing: { text: t('transcribing'), cls: 'text-amore' },
    done: { text: t('done'), cls: 'text-amore' },
    error: { text: t('error'), cls: 'text-warning' },
  };
  const { text, cls } = map[status];
  return (
    <span
      className={`uppercase tracking-[0.22em] text-[10px] font-semibold ${cls}`}
    >
      {text}
    </span>
  );
}

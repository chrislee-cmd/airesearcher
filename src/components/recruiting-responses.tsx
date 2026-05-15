'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DownloadMenu } from './ui/download-menu';
import type {
  FormColumn,
  FormResponseRow,
  FormResponses,
} from '@/lib/google-forms';
import { EmptyState } from '@/components/ui/empty-state';

type PublishedForm = {
  formId: string;
  title: string;
  responderUri: string;
  editUri: string;
  createdAt: string;
};

type Props = {
  // Bumped by the parent every time a new form is published so we can
  // refresh the list without polling /list on a tight loop.
  publishVersion: number;
  // null = unknown yet, false = connected but old scope.
  hasResponsesScope: boolean | null;
};

const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes per spec

function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escapeCsvCell(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(data: FormResponses): string {
  const header = ['응답시각', ...data.columns.map((c) => c.title)];
  const rows = data.rows.map((r) => [
    formatTime(r.lastSubmittedTime),
    ...data.columns.map((c) => r.answers[c.questionId] ?? ''),
  ]);
  return [header, ...rows]
    .map((row) => row.map(escapeCsvCell).join(','))
    .join('\n');
}

async function buildXlsxBlob(data: FormResponses): Promise<Blob> {
  const XLSX = await import('xlsx');
  const header = ['응답시각', ...data.columns.map((c) => c.title)];
  const aoa: (string | number)[][] = [
    header,
    ...data.rows.map((r) => [
      formatTime(r.lastSubmittedTime),
      ...data.columns.map((c) => r.answers[c.questionId] ?? ''),
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Responses');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

type ResponseState = {
  data: FormResponses | null;
  loading: boolean;
  error: string | null;
  syncedAt: number | null;
};

// Persist the last successful sync per form in localStorage so navigating
// away and back doesn't blow away the table. We only persist `data` and
// `syncedAt` — `loading`/`error` are session-only signals.
const STORAGE_KEY = 'recruiting_responses_v1';

type PersistedEntry = { data: FormResponses; syncedAt: number };

function loadPersisted(): Record<string, PersistedEntry> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PersistedEntry>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writePersisted(map: Record<string, PersistedEntry>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota / serialization errors are non-fatal for the UI.
  }
}

export function RecruitingResponses({ publishVersion, hasResponsesScope }: Props) {
  const [forms, setForms] = useState<PublishedForm[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [responses, setResponses] = useState<Record<string, ResponseState>>(
    () => {
      const persisted = loadPersisted();
      const out: Record<string, ResponseState> = {};
      for (const [formId, entry] of Object.entries(persisted)) {
        out[formId] = {
          data: entry.data,
          loading: false,
          error: null,
          syncedAt: entry.syncedAt,
        };
      }
      return out;
    },
  );

  const fetchList = useCallback(async () => {
    try {
      const res = await fetch('/api/recruiting/google/forms/list');
      if (!res.ok) {
        if (res.status === 401) return; // not signed in yet — silent
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `list_failed: ${res.statusText}`);
      }
      const j = (await res.json()) as { forms: PublishedForm[] };
      setForms(j.forms);
      setListError(null);
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'list_failed');
    }
  }, []);

  useEffect(() => {
    void fetchList();
  }, [fetchList, publishVersion]);

  const removeForm = useCallback(async (formId: string) => {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        '이 폼을 목록에서 제거할까요? Google Forms 자체는 그대로 남습니다.',
      );
      if (!ok) return;
    }
    try {
      const res = await fetch(
        `/api/recruiting/google/forms/${encodeURIComponent(formId)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `delete_failed: ${res.statusText}`);
      }
    } catch (e) {
      // Surface the failure but don't block local cleanup if the row is
      // already gone server-side.
      console.error('[recruiting] delete form failed', e);
    }
    setForms((prev) => (prev ? prev.filter((x) => x.formId !== formId) : prev));
    setResponses((prev) => {
      const next = { ...prev };
      delete next[formId];
      return next;
    });
    const persisted = loadPersisted();
    delete persisted[formId];
    writePersisted(persisted);
  }, []);

  const fetchResponses = useCallback(
    async (formId: string) => {
      setResponses((prev) => ({
        ...prev,
        [formId]: {
          data: prev[formId]?.data ?? null,
          loading: true,
          error: null,
          syncedAt: prev[formId]?.syncedAt ?? null,
        },
      }));
      try {
        const res = await fetch(
          `/api/recruiting/google/forms/${encodeURIComponent(formId)}/responses`,
        );
        const j = await res.json();
        if (!res.ok) {
          throw new Error(j.error ?? `responses_failed: ${res.statusText}`);
        }
        const data = j as FormResponses;
        const syncedAt = Date.now();
        setResponses((prev) => ({
          ...prev,
          [formId]: { data, loading: false, error: null, syncedAt },
        }));
        // Persist to localStorage so the table survives navigation.
        const persisted = loadPersisted();
        persisted[formId] = { data, syncedAt };
        writePersisted(persisted);
      } catch (e) {
        setResponses((prev) => ({
          ...prev,
          [formId]: {
            data: prev[formId]?.data ?? null,
            loading: false,
            error: e instanceof Error ? e.message : 'responses_failed',
            syncedAt: prev[formId]?.syncedAt ?? null,
          },
        }));
      }
    },
    [],
  );

  // Auto-poll every 30 min while the tab is visible. We pull all forms
  // sequentially to stay well under the Forms API per-user quota.
  const formsRef = useRef<PublishedForm[] | null>(null);
  formsRef.current = forms;
  useEffect(() => {
    if (!hasResponsesScope) return;
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const list = formsRef.current ?? [];
      for (const f of list) void fetchResponses(f.formId);
    };
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [fetchResponses, hasResponsesScope]);

  if (!forms || forms.length === 0) {
    return null;
  }

  return (
    <div className="mt-10 border-t border-line pt-8">
      <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
        발행한 폼 응답
      </h2>
      <p className="mt-1 text-[11px] text-mute-soft">
        30분마다 자동 동기화되며, 새로고침 버튼으로 즉시 갱신할 수 있습니다.
      </p>
      {listError && (
        <div className="mt-3 border border-amore bg-amore-bg p-3 text-[12px] text-amore [border-radius:14px]">
          폼 목록 로드 오류: {listError}
        </div>
      )}
      {hasResponsesScope === false && (
        <div className="mt-3 border border-line-soft bg-paper p-3 text-[12px] text-ink-2 [border-radius:14px]">
          응답 동기화는 새 권한이 필요합니다.{' '}
          <button
            type="button"
            onClick={() => {
              window.location.href = '/api/recruiting/google/start';
            }}
            className="text-amore underline-offset-2 hover:underline"
          >
            Google 재연결
          </button>
        </div>
      )}

      <ul className="mt-5 space-y-6">
        {forms.map((f) => {
          const state = responses[f.formId];
          return (
            <li key={f.formId} className="border border-line bg-paper [border-radius:14px]">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-ink">
                    {f.title || '(제목 없음)'}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-mute-soft">
                    <span>발행 {formatTime(f.createdAt)}</span>
                    <a
                      href={f.editUri}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-mute hover:text-ink-2 hover:underline"
                    >
                      편집
                    </a>
                    <a
                      href={f.responderUri}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-mute hover:text-ink-2 hover:underline"
                    >
                      응답 폼
                    </a>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums text-[11px] text-mute-soft">
                    {state?.syncedAt
                      ? `동기화 ${formatTime(new Date(state.syncedAt).toISOString())}`
                      : '아직 동기화 안 됨'}
                  </span>
                  <button
                    type="button"
                    onClick={() => void fetchResponses(f.formId)}
                    disabled={state?.loading || hasResponsesScope === false}
                    className="border border-line bg-paper px-3 py-1 text-[11.5px] text-ink-2 transition-colors duration-[120ms] hover:border-ink-2 disabled:cursor-not-allowed disabled:opacity-40 [border-radius:14px]"
                  >
                    {state?.loading ? '동기화 중…' : '새로고침'}
                  </button>
                  <DownloadMenu
                    tone="ghost"
                    align="end"
                    disabled={!state?.data || state.data.rows.length === 0}
                    items={[
                      {
                        format: 'csv',
                        kind: 'blob',
                        filename: `${f.title || 'responses'}.csv`,
                        build: () =>
                          new Blob(
                            ['﻿' + buildCsv(state!.data!)],
                            { type: 'text/csv;charset=utf-8' },
                          ),
                      },
                      {
                        format: 'xlsx',
                        kind: 'blob',
                        filename: `${f.title || 'responses'}.xlsx`,
                        build: () => buildXlsxBlob(state!.data!),
                      },
                    ]}
                  />
                  <button
                    type="button"
                    onClick={() => void removeForm(f.formId)}
                    title="이 폼을 목록에서 제거 (Google Forms 원본은 유지)"
                    className="border border-line bg-paper px-3 py-1 text-[11.5px] text-mute transition-colors duration-[120ms] hover:border-amore hover:text-amore [border-radius:14px]"
                  >
                    제거
                  </button>
                </div>
              </header>

              {state?.error && (
                <div className="border-b border-line-soft bg-amore-bg px-4 py-2 text-[12px] text-amore">
                  오류: {state.error}
                </div>
              )}

              {state?.data ? (
                state.data.rows.length === 0 ? (
                  <EmptyState tone="subtle" title="아직 수집된 응답이 없습니다." />
                ) : (
                  <ResponseTable columns={state.data.columns} rows={state.data.rows} />
                )
              ) : (
                <EmptyState tone="subtle" title="새로고침을 눌러 응답을 불러오세요." />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const DEFAULT_TIME_COL_WIDTH = 160;
const DEFAULT_VALUE_COL_WIDTH = 200;
const MIN_COL_WIDTH = 60;

function ResponseTable({
  columns,
  rows,
}: {
  columns: FormColumn[];
  rows: FormResponseRow[];
}) {
  // Per-column widths in px. The first slot is the "응답시각" column,
  // the rest line up with `columns`. Disabling cell wrap means rows
  // are always one line tall, so the user can drag any column header's
  // right edge to widen/narrow that column.
  const [widths, setWidths] = useState<number[]>(() => [
    DEFAULT_TIME_COL_WIDTH,
    ...columns.map(() => DEFAULT_VALUE_COL_WIDTH),
  ]);
  // If the column set changes (different form selected), reset widths.
  // Seed during render via identity-tracking to satisfy React's
  // set-state-in-effect rule.
  const [seededColumns, setSeededColumns] = useState(columns);
  if (columns !== seededColumns) {
    setSeededColumns(columns);
    setWidths([
      DEFAULT_TIME_COL_WIDTH,
      ...columns.map(() => DEFAULT_VALUE_COL_WIDTH),
    ]);
  }

  const dragRef = useRef<{ idx: number; startX: number; startW: number } | null>(
    null,
  );

  function startResize(idx: number, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      idx,
      startX: e.clientX,
      startW: widths[idx] ?? DEFAULT_VALUE_COL_WIDTH,
    };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const next = Math.max(MIN_COL_WIDTH, d.startW + (ev.clientX - d.startX));
      setWidths((prev) => {
        const out = [...prev];
        out[d.idx] = next;
        return out;
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <div className="overflow-x-auto">
      <table
        className="border-collapse text-[12px]"
        style={{ tableLayout: 'fixed' }}
      >
        <colgroup>
          {widths.map((w, i) => (
            <col key={i} style={{ width: `${w}px` }} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-paper text-left">
            <th
              className="sticky left-0 z-[2] border-b border-line-soft bg-paper px-3 py-2 font-semibold text-ink-2"
              style={{ position: 'relative' }}
            >
              <span className="block truncate">응답시각</span>
              <ResizeHandle onMouseDown={(e) => startResize(0, e)} />
            </th>
            {columns.map((c, i) => (
              <th
                key={c.questionId}
                className="border-b border-line-soft px-3 py-2 font-semibold text-ink-2"
                style={{ position: 'relative' }}
              >
                <span className="block truncate" title={c.title}>
                  {c.title}
                </span>
                <ResizeHandle onMouseDown={(e) => startResize(i + 1, e)} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.responseId} className="align-top">
              <td className="sticky left-0 z-[1] overflow-hidden whitespace-nowrap border-b border-line-soft bg-paper px-3 py-2 tabular-nums text-mute">
                {formatTime(r.lastSubmittedTime)}
              </td>
              {columns.map((c) => (
                <td
                  key={c.questionId}
                  className="overflow-hidden whitespace-nowrap border-b border-line-soft px-3 py-2 text-ink-2"
                  title={r.answers[c.questionId] ?? ''}
                >
                  {r.answers[c.questionId] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResizeHandle({
  onMouseDown,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <span
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation="vertical"
      className="absolute right-0 top-0 z-[3] h-full w-[6px] -translate-x-[1px] cursor-col-resize select-none bg-transparent hover:bg-line"
      // Prevent text selection during drag
      style={{ userSelect: 'none' }}
    />
  );
}

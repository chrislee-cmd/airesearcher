'use client';

/* ────────────────────────────────────────────────────────────────────
   Recruiting widget bottom-align outputs.

   - useRecruitingForms()  : fetches /api/recruiting/google/forms/list and
     polls every 30 s (matches PROJECT.md §spec). Refetches on `publishVersion`
     bump so a fresh publish surfaces immediately without waiting for the
     poll tick.
   - RecruitingFormsModal  : "더보기" overlay listing all forms (table) for
     when the widget shows only the most recent 2.
   - RecruitingOutputRow   : shared row body (title + meta + CTA cluster)
     used both inside <WidgetOutputs> and inside the modal so the rendering
     stays consistent.

   Sheet linkage policy:
     - publish path auto-creates a Sheet when the user has the Sheets scope.
     - rows where sheetUrl is null show a "시트 연결" button that hits the
       link-sheet endpoint. A 412 (reconsent_required) bounces the user to
       the share-scoped Google start URL.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';

export type RecruitingForm = {
  formId: string;
  title: string;
  responderUri: string;
  editUri: string;
  sheetUrl: string | null;
  createdAt: string;
};

const POLL_INTERVAL_MS = 30 * 1000;
// When forms/list keeps failing (e.g. prod migration not yet applied),
// back the polling cadence way off after a few attempts so console + Vercel
// logs aren't carpeted with one 500 every 30 s per open canvas widget.
const POLL_INTERVAL_BACKOFF_MS = 5 * 60 * 1000;
const POLL_FAILURE_THRESHOLD = 3;

function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type UseRecruitingFormsOpts = {
  // Set true once the user has connected Google — there's nothing to
  // fetch otherwise (the endpoint is unauthenticated-safe but returns
  // 401 for unconnected users and we'd just churn).
  enabled: boolean;
  // Parent bumps this every time a publish completes so we refresh
  // immediately instead of waiting for the 30 s tick.
  publishVersion: number;
};

export function useRecruitingForms({ enabled, publishVersion }: UseRecruitingFormsOpts) {
  const [forms, setForms] = useState<RecruitingForm[]>([]);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  // Track consecutive refetch failures so the interval poll can back off
  // when the backend is sustained-failing. ref (not state) so the bump
  // doesn't trigger a re-render or invalidate the setInterval closure.
  const failureCountRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await fetch('/api/recruiting/google/forms/list');
      if (!res.ok) {
        failureCountRef.current += 1;
        return;
      }
      const json = (await res.json()) as { forms?: RecruitingForm[] };
      setForms(json.forms ?? []);
      failureCountRef.current = 0;
    } catch {
      // network blips are silent — keep the previous list visible.
      failureCountRef.current += 1;
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- network refetch on mount/version bump
    void refetch();
  }, [refetch, publishVersion]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timerId: number | undefined;
    function schedule() {
      const delay =
        failureCountRef.current >= POLL_FAILURE_THRESHOLD
          ? POLL_INTERVAL_BACKOFF_MS
          : POLL_INTERVAL_MS;
      timerId = window.setTimeout(async () => {
        if (cancelled) return;
        await refetch();
        if (!cancelled) schedule();
      }, delay);
    }
    schedule();
    return () => {
      cancelled = true;
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, [enabled, refetch]);

  const linkSheet = useCallback(async (formId: string) => {
    setLinking(formId);
    setLinkError(null);
    try {
      const res = await fetch(
        `/api/recruiting/google/forms/${encodeURIComponent(formId)}/link-sheet`,
        { method: 'POST' },
      );
      const json = (await res.json().catch(() => ({}))) as {
        sheetUrl?: string;
        error?: string;
      };
      if (res.status === 412 && json.error === 'reconsent_required') {
        // Sheets scope missing — bounce to the share-scope start URL
        // (which uses prompt=consent so the user can grant the extra
        // scope). They'll land back on this page after consent.
        window.location.href = '/api/recruiting/google/start?share=1';
        return;
      }
      if (!res.ok || !json.sheetUrl) {
        setLinkError(json.error ?? `link_failed: ${res.statusText}`);
        return;
      }
      // Optimistically patch the row so the CTA flips without a refetch.
      setForms((prev) =>
        prev.map((f) =>
          f.formId === formId ? { ...f, sheetUrl: json.sheetUrl ?? null } : f,
        ),
      );
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : 'link_failed');
    } finally {
      setLinking(null);
    }
  }, []);

  return {
    forms,
    loading,
    linking,
    linkError,
    refetch,
    linkSheet,
  };
}

export function RecruitingOutputActions({
  form,
  linking,
  onLinkSheet,
}: {
  form: RecruitingForm;
  linking: boolean;
  onLinkSheet: (formId: string) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3">
      {form.sheetUrl ? (
        <a
          href={form.sheetUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-sm uppercase tracking-[0.18em] text-amore hover:underline"
        >
          응답 시트
        </a>
      ) : (
        <Button
          variant="link"
          size="sm"
          onClick={() => onLinkSheet(form.formId)}
          disabled={linking}
          className="uppercase tracking-[0.18em]"
        >
          {linking ? '연결 중…' : '시트 연결'}
        </Button>
      )}
      <a
        href={form.responderUri}
        target="_blank"
        rel="noreferrer noopener"
        className="text-sm uppercase tracking-[0.18em] text-ink-2 hover:text-amore"
      >
        응답폼
      </a>
    </div>
  );
}

export function RecruitingFormsModal({
  open,
  onClose,
  forms,
  linking,
  linkError,
  onLinkSheet,
}: {
  open: boolean;
  onClose: () => void;
  forms: RecruitingForm[];
  linking: string | null;
  linkError: string | null;
  onLinkSheet: (formId: string) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`리크루팅 산출물 (${forms.length})`}
    >
      {linkError && (
        <div className="mb-3 border border-amore bg-amore-bg p-3 text-md text-amore rounded-sm">
          시트 연결 오류: {linkError}
        </div>
      )}
      {forms.length === 0 ? (
        <div className="rounded-xs border border-dashed border-line-soft bg-paper px-4 py-6 text-center text-md text-mute-soft">
          아직 발행된 폼이 없습니다
        </div>
      ) : (
        <ul className="divide-y divide-line-soft border border-line bg-paper rounded-sm">
          {forms.map((f) => (
            <li
              key={f.formId}
              className="flex items-start gap-4 px-4 py-3 text-md"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-lg text-ink-2">
                  {f.title || '제목 없음'}
                </div>
                <div className="mt-0.5 text-sm text-mute-soft tabular-nums">
                  발행 {formatTime(f.createdAt)}
                </div>
              </div>
              <RecruitingOutputActions
                form={f}
                linking={linking === f.formId}
                onLinkSheet={onLinkSheet}
              />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export { formatTime };

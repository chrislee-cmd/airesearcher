'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { MochiLoader } from '@/components/ui/mochi-loader';
import {
  isContactColumnTitle,
  isPrivacyConsentColumnTitle,
} from '@/lib/recruiting/contact-filter';
import type { FormColumn, FormResponseRow } from '@/lib/google-forms';

type ResponsesPayload = {
  formId: string;
  title: string;
  columns: FormColumn[];
  rows: FormResponseRow[];
};

// Privacy: the server already strips contact columns + the consent
// column before sending, but we re-apply the same predicates on the
// client so the table stays safe if a future server change misses one.
function visibleColumns(columns: FormColumn[]): FormColumn[] {
  return columns.filter(
    (c) => !isContactColumnTitle(c.title) && !isPrivacyConsentColumnTitle(c.title),
  );
}

function formatSubmittedAt(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Local date + 24h time — recruiters scan responses in their tz.
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function AttendeeReviewModal({
  open,
  onClose,
  formId,
  responderUri,
}: {
  open: boolean;
  onClose: () => void;
  formId: string;
  responderUri?: string;
}) {
  const [data, setData] = useState<ResponsesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/recruiting/google/forms/${encodeURIComponent(formId)}/responses`,
      );
      const j = (await res.json().catch(() => ({}))) as
        | ResponsesPayload
        | { error?: string };
      if (!res.ok) {
        throw new Error(
          ('error' in j && j.error) || `responses_failed: ${res.statusText}`,
        );
      }
      setData(j as ResponsesPayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'responses_failed');
    } finally {
      setLoading(false);
    }
  }, [formId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [open, load]);

  const columns = useMemo(
    () => (data ? visibleColumns(data.columns) : []),
    [data],
  );

  const filtered = useMemo(() => {
    if (!data) return [] as FormResponseRow[];
    const q = search.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter((r) =>
      Object.values(r.answers).some((v) =>
        v.toLowerCase().includes(q),
      ),
    );
  }, [data, search]);

  const total = data?.rows.length ?? 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="full"
      title={`모집 현황 — ${total}명 응답`}
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="응답 본문에서 검색"
          size="sm"
          fullWidth={false}
          className="w-[280px]"
        />
        <div className="flex items-center gap-3 text-sm text-mute">
          <span className="tabular-nums text-mute-soft">
            총 {total}명 · 표시 {filtered.length}명
          </span>
          {responderUri && (
            <a
              href={responderUri}
              target="_blank"
              rel="noreferrer noopener"
              className="text-amore underline-offset-2 hover:underline"
            >
              참석자 폼 열기
            </a>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? '갱신 중…' : '새로고침'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            닫기
          </Button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-auto bg-paper">
        {loading && !data ? (
          <div className="flex h-full items-center justify-center">
            <MochiLoader size={36} />
          </div>
        ) : error ? (
          <div className="p-5">
            <div className="border-[2px] border-warning-line bg-warning-bg shadow-[2px_2px_0_var(--color-warning)] p-3 text-md text-ink-2 rounded-sm">
              응답을 불러오지 못했어요: {error}
            </div>
          </div>
        ) : !data || total === 0 ? (
          <div className="flex h-full items-center justify-center p-8">
            <EmptyState
              tone="subtle"
              title="아직 응답이 없습니다"
              description="설문 링크를 공유한 뒤 응답이 들어오면 여기서 확인할 수 있어요. 전화번호·이메일은 표시되지 않습니다."
            />
          </div>
        ) : (
          <ResponseTable columns={columns} rows={filtered} />
        )}
      </div>

      <footer className="shrink-0 border-t border-line-soft bg-paper-soft px-5 py-2 text-xs-soft text-mute-soft">
        개인정보 보호를 위해 전화번호·이메일은 표에서 제외됩니다.
      </footer>
    </Modal>
  );
}

function ResponseTable({
  columns,
  rows,
}: {
  columns: FormColumn[];
  rows: FormResponseRow[];
}) {
  return (
    <table className="w-full border-collapse text-md">
      <thead className="sticky top-0 z-table-sticky bg-paper-soft text-left">
        <tr>
          <th className="border-b border-line-soft px-3 py-2 text-xs-soft uppercase tracking-[0.04em] text-mute-soft">
            응답 시각
          </th>
          {columns.map((c) => (
            <th
              key={c.questionId}
              className="border-b border-line-soft px-3 py-2 text-xs-soft uppercase tracking-[0.04em] text-mute-soft"
            >
              {c.title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.responseId}
            className="border-b border-line-soft last:border-b-0"
          >
            <td className="px-3 py-2 align-top tabular-nums text-mute">
              {formatSubmittedAt(r.lastSubmittedTime || r.createTime)}
            </td>
            {columns.map((c) => (
              <td
                key={c.questionId}
                className="px-3 py-2 align-top text-ink-2"
              >
                {r.answers[c.questionId] || (
                  <span className="text-mute-soft">—</span>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

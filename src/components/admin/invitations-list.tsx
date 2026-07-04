'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export type InvitationStatus = 'pending' | 'sent' | 'declined' | 'archived';

export type InvitationRow = {
  id: string;
  requester_user_id: string;
  project_id: string | null;
  form_id: string;
  response_ids: string[];
  status: InvitationStatus;
  admin_note: string | null;
  created_at: string;
  processed_at: string | null;
  requester_email: string;
  requester_name: string | null;
  form_title: string;
};

type StatusFilter = InvitationStatus | 'all';
const FILTERS: StatusFilter[] = ['pending', 'sent', 'declined', 'archived', 'all'];

const STATUS_LABEL: Record<InvitationStatus, string> = {
  pending: '대기',
  sent: '발송',
  declined: '거절',
  archived: '보관',
};

function statusColor(status: InvitationStatus): string {
  switch (status) {
    case 'pending':
      return 'text-amore';
    case 'sent':
      return 'text-ink';
    case 'declined':
      return 'text-warning';
    case 'archived':
      return 'text-mute-soft';
  }
}

export function InvitationsList({
  invitations,
}: {
  invitations: InvitationRow[];
}) {
  const [rows, setRows] = useState(invitations);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = rows.filter(
    (i) => statusFilter === 'all' || i.status === statusFilter,
  );
  const selected = rows.find((i) => i.id === selectedId) ?? null;

  function handleUpdated(updated: InvitationRow) {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  return (
    <div className="flex h-full">
      {/* 좌 = 요청 리스트 */}
      <aside className="flex w-96 shrink-0 flex-col overflow-hidden border-r border-line-soft">
        <header className="space-y-2 border-b border-line-soft p-4">
          <h2 className="text-sm font-semibold text-ink">
            리크루팅 요청 ({filtered.length})
          </h2>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((s) => (
              <Button
                key={s}
                variant="ghost"
                size="xs"
                onClick={() => setStatusFilter(s)}
                className={`!rounded-pill !px-2.5 !py-0.5 ${
                  statusFilter === s
                    ? 'border-ink bg-amore-bg text-ink'
                    : 'border-line-soft text-mute'
                }`}
              >
                {s === 'all' ? '전체' : STATUS_LABEL[s]}
              </Button>
            ))}
          </div>
        </header>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {filtered.map((i) => (
            <li key={i.id}>
              <Button
                variant="ghost"
                fullWidth
                onClick={() => setSelectedId(i.id)}
                className={`!flex !flex-col !items-start !justify-start !gap-0.5 !whitespace-normal !rounded-none !border-0 !px-3 !py-3 border-b border-line-soft text-left ${
                  selectedId === i.id ? 'bg-amore-bg' : ''
                }`}
              >
                <span className="max-w-full truncate text-sm font-semibold text-ink">
                  {i.requester_email}
                </span>
                <span className="max-w-full truncate text-xs text-mute">
                  {i.form_title}
                </span>
                <span className="text-xs-soft text-mute-soft">
                  {i.response_ids.length}명 ·{' '}
                  {new Date(i.created_at).toLocaleDateString('ko-KR')} ·{' '}
                  <span className={statusColor(i.status)}>
                    {STATUS_LABEL[i.status]}
                  </span>
                </span>
              </Button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="p-4 text-sm text-mute">해당 상태의 요청이 없습니다.</li>
          )}
        </ul>
      </aside>

      {/* 우 = 상세 (선정된 응답자 연락처) */}
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        {!selected ? (
          <p className="py-24 text-center text-sm text-mute">
            좌측에서 요청을 선택하세요.
          </p>
        ) : (
          <InvitationDetail
            key={selected.id}
            invitation={selected}
            onUpdated={handleUpdated}
          />
        )}
      </main>
    </div>
  );
}

type ContactColumn = { questionId: string; title: string };
type ContactRow = { responseId: string; answers: Record<string, string> };
type ContactsPayload = {
  columns: ContactColumn[];
  rows: ContactRow[];
  contactQuestionIds: string[];
};

function InvitationDetail({
  invitation,
  onUpdated,
}: {
  invitation: InvitationRow;
  onUpdated: (row: InvitationRow) => void;
}) {
  const [contacts, setContacts] = useState<ContactsPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [note, setNote] = useState(invitation.admin_note ?? '');
  const [saving, setSaving] = useState<InvitationStatus | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    // This component is keyed by invitation.id in the parent, so it remounts on
    // every selection change — state starts fresh and we don't (and mustn't,
    // per the no-cascading-render lint) reset it synchronously here.
    let cancelled = false;
    fetch(`/api/recruiting/invitations/${invitation.id}/contacts`)
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error ?? 'load_failed');
        return data as ContactsPayload;
      })
      .then((data) => {
        if (!cancelled) setContacts(data);
      })
      .catch((e) => {
        if (!cancelled)
          setLoadError(e instanceof Error ? e.message : 'load_failed');
      });
    return () => {
      cancelled = true;
    };
  }, [invitation.id]);

  async function changeStatus(status: InvitationStatus) {
    setSaving(status);
    setSaveError(null);
    try {
      const res = await fetch(`/api/recruiting/invitations/${invitation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, admin_note: note.trim() || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'update_failed');
      onUpdated({
        ...invitation,
        status,
        admin_note: note.trim() || null,
        processed_at:
          data?.invitation?.processed_at ?? new Date().toISOString(),
      });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'update_failed');
    } finally {
      setSaving(null);
    }
  }

  const contactSet = new Set(contacts?.contactQuestionIds ?? []);

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-ink">
          {invitation.requester_email}
        </h1>
        <p className="text-sm text-mute">{invitation.form_title}</p>
        <p className="text-xs-soft text-mute-soft">
          {invitation.response_ids.length}명 ·{' '}
          {new Date(invitation.created_at).toLocaleString('ko-KR')} · 현재 상태:{' '}
          <span className={statusColor(invitation.status)}>
            {STATUS_LABEL[invitation.status]}
          </span>
        </p>
      </header>

      {/* 연락처 테이블 (super admin 만 — 값 전체 노출) */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink">
          선정된 응답자 연락처
        </h2>
        {loadError ? (
          <p className="text-sm text-warning">
            연락처를 불러오지 못했습니다: {loadError}
          </p>
        ) : !contacts ? (
          <p className="text-sm text-mute">불러오는 중…</p>
        ) : contacts.rows.length === 0 ? (
          <p className="text-sm text-mute">
            선정된 응답을 폼에서 찾지 못했습니다.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-sm border border-line-soft">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line">
                  {contacts.columns.map((c) => (
                    <th
                      key={c.questionId}
                      className={`whitespace-nowrap p-2 text-left font-semibold ${
                        contactSet.has(c.questionId)
                          ? 'text-amore'
                          : 'text-mute'
                      }`}
                    >
                      {c.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {contacts.rows.map((r) => (
                  <tr
                    key={r.responseId}
                    className="border-b border-line-soft align-top"
                  >
                    {contacts.columns.map((c) => (
                      <td
                        key={c.questionId}
                        className={`p-2 ${
                          contactSet.has(c.questionId)
                            ? 'font-medium text-ink'
                            : 'text-mute'
                        }`}
                      >
                        {r.answers[c.questionId] || '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 상태 변경 + admin_note */}
      <section className="space-y-3 border-t border-line-soft pt-4">
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          label="관리자 메모"
          placeholder="처리 메모 (선택)"
        />
        {saveError && (
          <p className="text-sm text-warning">처리 실패: {saveError}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => changeStatus('sent')}
            disabled={saving !== null}
          >
            {saving === 'sent' ? '처리 중…' : '초대 완료'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => changeStatus('declined')}
            disabled={saving !== null}
          >
            {saving === 'declined' ? '처리 중…' : '거절'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => changeStatus('archived')}
            disabled={saving !== null}
          >
            {saving === 'archived' ? '처리 중…' : '보관'}
          </Button>
        </div>
      </section>
    </div>
  );
}

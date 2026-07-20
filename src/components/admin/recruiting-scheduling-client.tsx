'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FileDropZone } from '@/components/ui/file-drop-zone';

export type SchedBatch = {
  id: string;
  title: string;
  created_at: string;
};

// participant_token is deliberately absent — PR4 surfaces it via the public
// participant link; the PR1 list never renders it.
export type SchedCandidate = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  fields: Record<string, string>;
};

type Props = {
  batches: SchedBatch[];
  selectedBatchId: string | null;
  candidates: SchedCandidate[];
};

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function RecruitingSchedulingClient({
  batches,
  selectedBatchId,
  candidates,
}: Props) {
  const router = useRouter();
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Extra (non email/name/phone) columns present across the batch, preserved in
  // `fields`. Union so a candidate missing a key still renders an empty cell.
  const fieldColumns = Array.from(
    new Set(candidates.flatMap((c) => Object.keys(c.fields))),
  ).sort();

  function selectBatch(id: string) {
    router.push(`/admin/recruiting-scheduling?batch=${id}`);
  }

  async function createBatch() {
    const title = newTitle.trim();
    if (!title || creating) return;
    setCreating(true);
    setMessage(null);
    try {
      const res = await fetch('/api/scheduling/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) {
        setMessage('배치 생성에 실패했습니다.');
        return;
      }
      const { batch } = (await res.json()) as { batch: SchedBatch };
      setNewTitle('');
      router.push(`/admin/recruiting-scheduling?batch=${batch.id}`);
      router.refresh();
    } finally {
      setCreating(false);
    }
  }

  async function uploadFile(file: File) {
    if (!selectedBatchId || uploading) return;
    setUploading(true);
    setMessage(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(
        `/api/scheduling/batches/${selectedBatchId}/upload`,
        { method: 'POST', body },
      );
      const json = (await res.json().catch(() => ({}))) as {
        upserted?: number;
        skippedNoEmail?: number;
        error?: string;
      };
      if (!res.ok) {
        setMessage(
          json.error === 'no_candidates'
            ? '이메일 컬럼이 있는 후보자를 찾지 못했습니다.'
            : '업로드에 실패했습니다.',
        );
        return;
      }
      const skipped = json.skippedNoEmail
        ? ` (이메일 없음 ${json.skippedNoEmail}행 제외)`
        : '';
      setMessage(`${json.upserted ?? 0}명 반영됨${skipped}.`);
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-ink">후보자 인터뷰 스케줄링</h1>
        <p className="text-sm text-mute">
          배치를 선택하거나 새로 만들고, CSV/XLSX 로 후보자를 업로드하세요.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-b border-line pb-6">
        <div className="min-w-[220px]">
          <Select
            label="배치"
            value={selectedBatchId ?? ''}
            onChange={(e) => selectBatch(e.target.value)}
            options={batches.map((b) => ({ value: b.id, label: b.title }))}
            disabled={batches.length === 0}
          />
        </div>
        <div className="flex items-end gap-2">
          <Input
            label="새 배치"
            placeholder="배치 이름"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createBatch();
            }}
          />
          <Button
            variant="secondary"
            onClick={createBatch}
            disabled={!newTitle.trim() || creating}
          >
            {creating ? '생성 중…' : '생성'}
          </Button>
        </div>
      </div>

      {selectedBatchId ? (
        <>
          <FileDropZone
            accept=".csv,.xlsx"
            maxSizeBytes={MAX_UPLOAD_BYTES}
            disabled={uploading}
            onFiles={(files) => {
              if (files[0]) uploadFile(files[0]);
            }}
            onError={() => setMessage('파일이 너무 큽니다 (최대 10MB).')}
            label={uploading ? '업로드 중…' : '후보자 파일 업로드'}
            helperText="CSV 또는 XLSX · 이메일 기준 병합(재업로드 시 갱신)"
            className="px-6 py-12"
          />

          {message && <p className="text-sm text-ink">{message}</p>}

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-mute">
                  <th className="px-3 py-2 font-medium">이메일</th>
                  <th className="px-3 py-2 font-medium">이름</th>
                  <th className="px-3 py-2 font-medium">전화</th>
                  {fieldColumns.map((col) => (
                    <th key={col} className="px-3 py-2 font-medium">
                      {col}
                    </th>
                  ))}
                  {/* 슬롯 / 공유링크 컬럼 자리 — PR2(캘린더)·PR4(참여자링크)에서 채움. */}
                  <th className="px-3 py-2 font-medium text-mute-soft">슬롯</th>
                  <th className="px-3 py-2 font-medium text-mute-soft">공유링크</th>
                </tr>
              </thead>
              <tbody>
                {candidates.length === 0 ? (
                  <tr>
                    <td
                      className="px-3 py-6 text-center text-mute"
                      colSpan={5 + fieldColumns.length}
                    >
                      아직 후보자가 없습니다. 파일을 업로드하세요.
                    </td>
                  </tr>
                ) : (
                  candidates.map((c) => (
                    <tr key={c.id} className="border-b border-line-soft">
                      <td className="px-3 py-2 text-ink">{c.email}</td>
                      <td className="px-3 py-2 text-ink">{c.name ?? '—'}</td>
                      <td className="px-3 py-2 text-ink">{c.phone ?? '—'}</td>
                      {fieldColumns.map((col) => (
                        <td key={col} className="px-3 py-2 text-mute">
                          {c.fields[col] ?? ''}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-mute-soft">—</td>
                      <td className="px-3 py-2 text-mute-soft">—</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="text-sm text-mute">
          배치를 먼저 만들면 후보자를 업로드할 수 있습니다.
        </p>
      )}
    </div>
  );
}

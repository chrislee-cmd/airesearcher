'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';

export type QaTesterRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  is_qa_tester: boolean;
  created_at: string;
};

export function QaTesterList({ profiles: initial }: { profiles: QaTesterRow[] }) {
  const [profiles, setProfiles] = useState(initial);
  const [filter, setFilter] = useState('');
  const supabase = createClient();

  const toggle = async (id: string, next: boolean) => {
    // Optimistic update — flip immediately, roll back if the write fails.
    setProfiles((prev) =>
      prev.map((p) => (p.id === id ? { ...p, is_qa_tester: next } : p)),
    );
    const { error } = await supabase
      .from('profiles')
      .update({ is_qa_tester: next })
      .eq('id', id);
    if (error) {
      setProfiles((prev) =>
        prev.map((p) => (p.id === id ? { ...p, is_qa_tester: !next } : p)),
      );
      alert(`실패: ${error.message}`);
    }
  };

  // React Compiler is enabled in this repo, so these derived values are
  // memoized automatically — no manual useMemo needed.
  const q = filter.trim().toLowerCase();
  const filtered = !q
    ? profiles
    : profiles.filter(
        (p) =>
          (p.email && p.email.toLowerCase().includes(q)) ||
          (p.full_name && p.full_name.toLowerCase().includes(q)),
      );

  const qaCount = profiles.filter((p) => p.is_qa_tester).length;

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-ink">
          QA Testers{' '}
          <span className="text-mute-soft font-normal">
            ({qaCount}/{profiles.length})
          </span>
        </h1>
        <Input
          size="sm"
          fullWidth={false}
          placeholder="email 또는 이름으로 검색"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-64"
        />
      </header>

      <table className="w-full text-sm">
        <thead className="border-b-2 border-line-soft text-mute">
          <tr>
            <th className="text-left p-2 font-medium">Email</th>
            <th className="text-left p-2 font-medium">Name</th>
            <th className="text-left p-2 font-medium">가입일</th>
            <th className="text-center p-2 font-medium">QA Tester</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((p) => (
            <tr key={p.id} className="border-b border-line-soft">
              <td className="p-2 text-ink">{p.email ?? '—'}</td>
              <td className="p-2 text-ink">{p.full_name ?? '—'}</td>
              <td className="p-2 text-mute">
                {new Date(p.created_at).toLocaleDateString('ko-KR')}
              </td>
              <td className="p-2 text-center">
                <Checkbox
                  checked={p.is_qa_tester}
                  onChange={(e) => toggle(p.id, e.target.checked)}
                  aria-label={`${p.email ?? p.id} QA tester 토글`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {filtered.length === 0 && (
        <p className="text-sm text-mute text-center py-24">
          {profiles.length === 0
            ? '프로필이 없어요.'
            : '검색 결과가 없어요.'}
        </p>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/toast-provider';

// PR-SEC5 — Danger Zone with two-step account erase.
//
// Step 1: user clicks "계정 삭제" → confirm modal opens.
// Step 2: user types their own email exactly → POST /api/account/delete.
//
// The email re-entry is the same idiom GitHub / Stripe use for irreversible
// account ops. It's not a security control — the session cookie already
// proves identity — but it forces a deliberate keystroke and matches user
// expectations for a destructive action.

type Props = {
  email: string;
};

export function DangerZone({ email }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const matches = confirmEmail.trim().toLowerCase() === email.toLowerCase();

  function openConfirm() {
    setConfirmEmail('');
    setOpen(true);
  }

  function closeConfirm() {
    if (busy) return;
    setOpen(false);
  }

  async function handleDelete() {
    if (!matches || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/account/delete', { method: 'POST' });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        toast.push(body?.error ?? '삭제에 실패했습니다.', { tone: 'warn' });
        setBusy(false);
        return;
      }

      // Auth row is gone; clear the local session before we redirect so
      // the landing page doesn't try to use a now-invalid sb-* cookie.
      const supabase = createClient();
      await supabase.auth.signOut().catch(() => {});

      router.replace('/');
      router.refresh();
    } catch {
      toast.push('네트워크 오류가 발생했습니다.', { tone: 'warn' });
      setBusy(false);
    }
  }

  return (
    <section className="mt-12 border border-warning bg-paper p-6 rounded-sm">
      <div className="text-xs font-bold uppercase tracking-[0.18em] text-warning">
        위험 구역
      </div>
      <h2 className="mt-2 text-xl font-semibold tracking-[-0.01em] text-ink-2">
        계정 삭제
      </h2>
      <p className="mt-2 max-w-[640px] text-md leading-[1.7] text-mute">
        계정과 연결된 모든 데이터를 영구적으로 삭제합니다. 워크스페이스, 업로드한 자료,
        진행 중인 분석 결과를 포함하며 되돌릴 수 없습니다. 결제·환불·감사 기록은
        법적 의무에 따라 비식별 상태로 보관됩니다.
      </p>
      <div className="mt-5">
        <Button variant="destructive" size="md" onClick={openConfirm}>
          계정 삭제…
        </Button>
      </div>

      <Modal
        open={open}
        onClose={closeConfirm}
        size="sm"
        title="계정을 정말 삭제하시겠어요?"
        description="이 작업은 되돌릴 수 없습니다. 확인을 위해 본인 이메일을 그대로 입력해 주세요."
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={closeConfirm}
              disabled={busy}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={!matches || busy}
              loading={busy}
              loadingLabel="삭제 중…"
            >
              영구 삭제
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-md leading-[1.65] text-ink-2">
            계정 이메일{' '}
            <span className="font-semibold text-ink">{email}</span> 을(를)
            아래에 다시 입력해 주세요.
          </p>
          <Input
            type="email"
            autoComplete="off"
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            placeholder={email}
            aria-label="확인 이메일"
            disabled={busy}
          />
        </div>
      </Modal>
    </section>
  );
}

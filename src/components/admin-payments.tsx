'use client';

import { useState, useTransition } from 'react';

type TaxInvoice = {
  bizNo?: string;
  company?: string;
  ceo?: string;
  managerName?: string;
  managerEmail?: string;
};

type Payment = {
  id: string;
  org_id: string;
  bundle_id: string;
  credits: number;
  amount_krw: number;
  status: string;
  bank_reference: string | null;
  tax_invoice: TaxInvoice | null;
  created_at: string;
  paid_at: string | null;
  organizations: { name: string } | null;
};

function formatKrw(n: number) {
  return new Intl.NumberFormat('ko-KR').format(n) + '원';
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

const STATUS_LABEL: Record<string, string> = {
  pending: '입금대기',
  paid: '완료',
  failed: '실패',
  refunded: '환불',
  cancelled: '취소',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-amore',
  paid: 'text-ink-2',
  failed: 'text-warning',
  refunded: 'text-mute',
  cancelled: 'text-mute',
};

export function AdminPayments({ initialPayments }: { initialPayments: Payment[] }) {
  const [payments, setPayments] = useState<Payment[]>(initialPayments);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [, startTransition] = useTransition();

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    window.setTimeout(() => setToast(null), 3500);
  }

  async function fetchPayments(status: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/payments?status=${status}`);
      const json = await res.json();
      if (res.ok) setPayments(json.payments ?? []);
    } finally {
      setLoading(false);
    }
  }

  function changeFilter(status: string) {
    setStatusFilter(status);
    startTransition(() => { fetchPayments(status); });
  }

  async function confirm(id: string) {
    setConfirming(id);
    try {
      const res = await fetch(`/api/billing/admin/confirm-bank/${id}`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast('크레딧 지급 완료', true);
        setPayments((prev) =>
          prev.map((p) => p.id === id ? { ...p, status: 'paid', paid_at: new Date().toISOString() } : p),
        );
      } else {
        showToast(json.error ?? '오류가 발생했습니다', false);
      }
    } finally {
      setConfirming(null);
    }
  }

  const filters = ['pending', 'paid', 'all'];

  return (
    <div>
      {/* Filter tabs */}
      <div className="flex gap-1">
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => changeFilter(f)}
            className={`px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] [border-radius:4px] ${
              statusFilter === f
                ? 'bg-ink text-paper'
                : 'border border-line text-mute hover:text-ink-2'
            }`}
          >
            {f === 'pending' ? '입금대기' : f === 'paid' ? '완료' : '전체'}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="mt-4 overflow-x-auto">
        {loading ? (
          <p className="py-8 text-center text-[12px] text-mute">불러오는 중…</p>
        ) : payments.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-mute">결제 내역이 없습니다.</p>
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-line text-left">
                {['신청일시', '조직', '번들', '금액', '크레딧', '입금자명', '세금계산서', '상태', ''].map((h) => (
                  <th key={h} className="pb-2 pr-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-mute-soft">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-line-soft">
                  <td className="py-3 pr-4 tabular-nums text-mute">{formatDate(p.created_at)}</td>
                  <td className="py-3 pr-4 font-medium text-ink-2">{p.organizations?.name ?? '—'}</td>
                  <td className="py-3 pr-4 text-mute">{p.bundle_id}</td>
                  <td className="py-3 pr-4 tabular-nums text-ink-2">{formatKrw(p.amount_krw)}</td>
                  <td className="py-3 pr-4 tabular-nums text-ink-2">{p.credits.toLocaleString()}</td>
                  <td className="py-3 pr-4 font-mono font-semibold tracking-[0.06em] text-amore">
                    {p.bank_reference ?? '—'}
                  </td>
                  <td className="py-3 pr-4">
                    {p.tax_invoice ? (
                      <span title={`${p.tax_invoice.bizNo} · ${p.tax_invoice.company}`} className="cursor-help underline decoration-dotted">
                        요청
                      </span>
                    ) : (
                      <span className="text-mute-soft">—</span>
                    )}
                  </td>
                  <td className={`py-3 pr-4 font-semibold ${STATUS_COLOR[p.status] ?? 'text-mute'}`}>
                    {STATUS_LABEL[p.status] ?? p.status}
                  </td>
                  <td className="py-3">
                    {p.status === 'pending' && (
                      <button
                        type="button"
                        disabled={confirming === p.id}
                        onClick={() => confirm(p.id)}
                        className="border border-amore px-3 py-1 text-[11px] font-semibold text-amore hover:bg-amore hover:text-paper disabled:opacity-40 [border-radius:4px]"
                      >
                        {confirming === p.id ? '처리 중…' : '입금 확인'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2"
          role="status"
          aria-live="polite"
        >
          <div className={`border px-4 py-2 text-[12px] font-semibold [border-radius:4px] ${
            toast.ok ? 'border-ink bg-ink text-paper' : 'border-warning bg-paper text-warning'
          }`}>
            {toast.msg}
          </div>
        </div>
      )}
    </div>
  );
}

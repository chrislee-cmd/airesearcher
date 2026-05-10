'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AdminUsageReport, ProviderUsage } from '@/lib/admin/types';

type Props = { report: AdminUsageReport };

// Super-admin cross-provider usage dashboard. Shows live usage + cost +
// remaining balance per connected service. Each row degrades gracefully
// when the provider doesn't expose a usage API on the keys we hold.
export function AdminApiUsage({ report: initial }: Props) {
  const t = useTranslations('AdminApiUsage');
  const [report, setReport] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const totals = useMemo(() => {
    let costUsd = 0;
    let balanceUsd = 0;
    let okCount = 0;
    let configuredCount = 0;
    for (const p of report.providers) {
      if (typeof p.costUsd === 'number') costUsd += p.costUsd;
      if (typeof p.balanceUsd === 'number') balanceUsd += p.balanceUsd;
      if (p.status === 'ok') okCount += 1;
      if (p.status !== 'unconfigured') configuredCount += 1;
    }
    return { costUsd, balanceUsd, okCount, configuredCount };
  }, [report]);

  async function refresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const res = await fetch('/api/admin/api-usage', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as AdminUsageReport;
      setReport(json);
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="mx-auto max-w-[960px] space-y-6">
      <header className="flex items-end justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amore">
            {t('label')}
          </div>
          <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.01em] text-ink">
            {t('title')}
          </h1>
          <p className="mt-1 text-[12.5px] text-mute">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10.5px] tabular-nums text-mute-soft">
            {new Date(report.generatedAt).toLocaleString('ko-KR')}
          </span>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="border border-line bg-paper px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-2 transition-colors duration-[120ms] hover:border-ink disabled:cursor-not-allowed disabled:text-mute-soft [border-radius:4px]"
          >
            {refreshing ? t('refreshing') : t('refresh')}
          </button>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard
          label={t('totals.connected')}
          value={`${totals.configuredCount} / ${report.providers.length}`}
        />
        <SummaryCard
          label={t('totals.cost')}
          value={formatUsd(totals.costUsd)}
          hint={t('totals.costHint')}
        />
        <SummaryCard
          label={t('totals.balance')}
          value={formatUsd(totals.balanceUsd)}
          hint={t('totals.balanceHint')}
        />
      </section>

      {refreshError && (
        <div className="border border-warning/40 bg-warning/5 px-3 py-2 text-[12px] text-warning [border-radius:4px]">
          {refreshError}
        </div>
      )}

      <section className="space-y-2">
        {report.providers.map((p) => (
          <ProviderRow key={p.id} provider={p} />
        ))}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="border border-line bg-paper px-4 py-3 [border-radius:4px]">
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
        {label}
      </div>
      <div className="mt-1 text-[20px] font-semibold tabular-nums tracking-[-0.01em] text-ink">
        {value}
      </div>
      {hint && (
        <div className="mt-1 text-[10.5px] text-mute-soft">{hint}</div>
      )}
    </div>
  );
}

function ProviderRow({ provider: p }: { provider: ProviderUsage }) {
  const t = useTranslations('AdminApiUsage');
  return (
    <article className="border border-line bg-paper px-4 py-3 [border-radius:4px]">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold tracking-[-0.005em] text-ink">
            {p.name}
          </span>
          <StatusPill status={p.status} />
        </div>
        {p.dashboardUrl && (
          <a
            href={p.dashboardUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-mute-soft hover:text-amore"
          >
            {t('openDashboard')} ↗
          </a>
        )}
      </header>

      {p.error && p.status === 'error' && (
        <div className="mt-2 text-[11.5px] text-warning">{p.error}</div>
      )}
      {p.error && p.status !== 'error' && p.error !== undefined && (
        <div className="mt-2 text-[11px] text-mute-soft">{p.error}</div>
      )}

      <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1.5 text-[12px]">
        {p.periodLabel && (
          <span className="text-[10.5px] uppercase tracking-[0.18em] text-mute-soft">
            {p.periodLabel}
          </span>
        )}
        {typeof p.costUsd === 'number' && (
          <Stat label={t('row.cost')} value={formatUsd(p.costUsd)} />
        )}
        {typeof p.balanceUsd === 'number' && (
          <Stat label={t('row.balance')} value={formatUsd(p.balanceUsd)} />
        )}
        {p.balanceLabel && (
          <Stat label={t('row.balance')} value={p.balanceLabel} />
        )}
        {p.metrics?.map((m) => (
          <Stat key={m.label} label={m.label} value={m.value} />
        ))}
      </div>

      <footer className="mt-3 flex flex-wrap gap-1.5">
        {p.envKeys.map((k) => (
          <span
            key={k.key}
            className={`border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] [border-radius:2px] ${
              k.present
                ? 'border-line-soft text-mute'
                : 'border-warning/40 text-warning'
            }`}
            title={k.present ? t('env.present') : t('env.missing')}
          >
            {k.key}
          </span>
        ))}
      </footer>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.18em] text-mute-soft">
        {label}
      </span>
      <span className="font-semibold tabular-nums text-ink-2">{value}</span>
    </span>
  );
}

function StatusPill({ status }: { status: ProviderUsage['status'] }) {
  const t = useTranslations('AdminApiUsage');
  const cls =
    status === 'ok'
      ? 'border-amore text-amore'
      : status === 'error'
        ? 'border-warning text-warning'
        : 'border-line-soft text-mute-soft';
  return (
    <span
      className={`border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.22em] [border-radius:2px] ${cls}`}
    >
      {t(`status.${status}`)}
    </span>
  );
}

function formatUsd(n: number) {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
}

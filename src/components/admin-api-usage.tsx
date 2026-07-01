'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AdminUsageReport, ProviderUsage } from '@/lib/admin/types';
import type { UsageSnapshot } from '@/lib/admin/snapshots';
import { ChromeButton } from './ui/chrome-button';
import { Button } from './ui/button';

type Props = { report: AdminUsageReport; baseline: UsageSnapshot | null };

// current - baseline, floored at 0. Provider cumulative only grows until
// the next reset, so a negative diff means the baseline is newer than the
// live figure (transient) — show $0 rather than a confusing negative.
function estimatedInvoice(costUsd: number, baselineUsd: number): number {
  return Math.max(0, costUsd - baselineUsd);
}

// Super-admin cross-provider usage dashboard. Shows live usage + cost +
// remaining balance per connected service. Each row degrades gracefully
// when the provider doesn't expose a usage API on the keys we hold.
export function AdminApiUsage({ report: initial, baseline: initialBaseline }: Props) {
  const t = useTranslations('AdminApiUsage');
  const [report, setReport] = useState(initial);
  const [baseline, setBaseline] = useState(initialBaseline);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [saving, setSaving] = useState<'save' | 'reset' | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const baselineMap = baseline?.providers ?? null;

  const totals = useMemo(() => {
    let costUsd = 0;
    let balanceUsd = 0;
    let estimatedUsd = 0;
    let okCount = 0;
    let configuredCount = 0;
    for (const p of report.providers) {
      if (typeof p.costUsd === 'number') {
        costUsd += p.costUsd;
        const base = baselineMap?.[p.id]?.cumulative_usd;
        if (typeof base === 'number') {
          estimatedUsd += estimatedInvoice(p.costUsd, base);
        }
      }
      if (typeof p.balanceUsd === 'number') balanceUsd += p.balanceUsd;
      if (p.status === 'ok') okCount += 1;
      if (p.status !== 'unconfigured') configuredCount += 1;
    }
    return { costUsd, balanceUsd, estimatedUsd, okCount, configuredCount };
  }, [report, baselineMap]);

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

  // Save / reset both persist current cumulative as the new baseline;
  // they hit different endpoints only so the audit note differs.
  async function saveBaseline(kind: 'save' | 'reset') {
    setSaving(kind);
    setSaveError(null);
    try {
      const url =
        kind === 'reset'
          ? '/api/admin/api-usage/snapshot/reset'
          : '/api/admin/api-usage/snapshot';
      const res = await fetch(url, { method: 'POST', cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const snap = (await res.json()) as UsageSnapshot;
      setBaseline(snap);
      // Pull fresh live numbers so "예상 청구액" reads $0 right after save.
      await refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="mx-auto max-w-[960px] space-y-6">
      <header className="flex items-end justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-amore">
            {t('label')}
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-0.01em] text-ink">
            {t('title')}
          </h1>
          <p className="mt-1 text-md text-mute">{t('subtitle')}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-3">
            <span className="text-xs-soft tabular-nums text-mute-soft">
              {new Date(report.generatedAt).toLocaleString('ko-KR')}
            </span>
            <ChromeButton
              variant="default"
              size="sm"
              uppercase
              onClick={refresh}
              disabled={refreshing}
              className="!px-3 !text-sm tracking-[0.18em] disabled:!text-mute-soft"
            >
              {refreshing ? t('refreshing') : t('refresh')}
            </ChromeButton>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={saving === 'save'}
              loadingLabel={t('snapshot.saving')}
              disabled={saving !== null || refreshing}
              onClick={() => saveBaseline('save')}
            >
              {t('snapshot.save')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={saving === 'reset'}
              loadingLabel={t('snapshot.resetting')}
              disabled={saving !== null || refreshing}
              onClick={() => saveBaseline('reset')}
            >
              {t('snapshot.reset')}
            </Button>
          </div>
        </div>
      </header>

      <div className="text-xs-soft text-mute-soft">
        {baseline ? (
          <span>
            {t('snapshot.baselineAt', {
              time: new Date(baseline.taken_at).toLocaleString('ko-KR'),
            })}
          </span>
        ) : (
          <span className="text-mute">{t('snapshot.noBaseline')}</span>
        )}
      </div>

      {saveError && (
        <div className="border border-warning/40 bg-warning/5 px-3 py-2 text-md text-warning rounded-sm">
          {saveError}
        </div>
      )}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          label={t('totals.estimated')}
          value={baseline ? formatUsd(totals.estimatedUsd) : '—'}
          hint={t('totals.estimatedHint')}
          emphasized
        />
        <SummaryCard
          label={t('totals.balance')}
          value={formatUsd(totals.balanceUsd)}
          hint={t('totals.balanceHint')}
        />
      </section>

      {refreshError && (
        <div className="border border-warning/40 bg-warning/5 px-3 py-2 text-md text-warning rounded-sm">
          {refreshError}
        </div>
      )}

      <section className="space-y-2">
        {report.providers.map((p) => (
          <ProviderRow
            key={p.id}
            provider={p}
            baselineUsd={baselineMap?.[p.id]?.cumulative_usd}
          />
        ))}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  emphasized,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasized?: boolean;
}) {
  return (
    <div
      className={`border bg-paper px-4 py-3 rounded-sm ${
        emphasized ? 'border-amore' : 'border-line'
      }`}
    >
      <div
        className={`text-xs font-semibold uppercase tracking-[0.22em] ${
          emphasized ? 'text-amore' : 'text-mute-soft'
        }`}
      >
        {label}
      </div>
      <div
        className={`mt-1 text-3xl font-semibold tabular-nums tracking-[-0.01em] ${
          emphasized ? 'text-amore' : 'text-ink'
        }`}
      >
        {value}
      </div>
      {hint && (
        <div className="mt-1 text-xs-soft text-mute-soft">{hint}</div>
      )}
    </div>
  );
}

function ProviderRow({
  provider: p,
  baselineUsd,
}: {
  provider: ProviderUsage;
  baselineUsd?: number;
}) {
  const t = useTranslations('AdminApiUsage');
  const hasBaseline =
    typeof p.costUsd === 'number' && typeof baselineUsd === 'number';
  return (
    <article className="border border-line bg-paper px-4 py-3 rounded-sm">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl font-semibold tracking-[-0.005em] text-ink">
            {p.name}
          </span>
          <StatusPill status={p.status} />
        </div>
        {/* Dashboard link only shown for providers that don't expose
            a programmatic API (configured-only) — for live providers the
            page IS the data, no need to redirect out. */}
        {p.dashboardUrl && p.status !== 'ok' && (
          <a
            href={p.dashboardUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs tracking-normal text-mute-soft hover:text-mute"
          >
            {t('openDashboard')} ↗
          </a>
        )}
      </header>

      {p.error && p.status === 'error' && (
        <div className="mt-2 text-sm text-warning">{p.error}</div>
      )}
      {p.error && p.status !== 'error' && p.error !== undefined && (
        <div className="mt-2 text-sm text-mute-soft">{p.error}</div>
      )}

      <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1.5 text-md">
        {p.periodLabel && (
          <span className="text-xs-soft uppercase tracking-[0.18em] text-mute-soft">
            {p.periodLabel}
          </span>
        )}
        {hasBaseline ? (
          <>
            <Stat label={t('row.current')} value={formatUsd(p.costUsd!)} />
            <Stat label={t('row.baseline')} value={formatUsd(baselineUsd!)} />
            <Stat
              label={t('row.estimated')}
              value={formatUsd(estimatedInvoice(p.costUsd!, baselineUsd!))}
              emphasized
            />
          </>
        ) : (
          typeof p.costUsd === 'number' && (
            <Stat label={t('row.cost')} value={formatUsd(p.costUsd)} />
          )
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
            className={`border px-1.5 py-0.5 text-xs font-semibold uppercase tracking-[0.18em] [border-radius:2px] ${
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

function Stat({
  label,
  value,
  emphasized,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span
        className={`text-xs uppercase tracking-[0.18em] ${
          emphasized ? 'text-amore' : 'text-mute-soft'
        }`}
      >
        {label}
      </span>
      <span
        className={`font-semibold tabular-nums ${
          emphasized ? 'text-amore' : 'text-ink-2'
        }`}
      >
        {value}
      </span>
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
      className={`border px-1.5 py-0.5 text-xs font-semibold uppercase tracking-[0.22em] [border-radius:2px] ${cls}`}
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

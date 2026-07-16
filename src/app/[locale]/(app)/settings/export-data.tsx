'use client';

// /settings → "내 데이터 export" client island.
//
// Calls POST /api/account/export; on success triggers an immediate download
// of the returned signed URL via a transient <a download> click. The 24h
// signed URL is also surfaced as a "다시 받기" link for re-download within
// the window without re-running the (expensive) export.
//
// Visual language matches the Settings page's editorial card pattern —
// no shadcn / no native <button>, only design-system primitives.
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

type ExportSuccess = {
  url: string;
  filename: string;
  size_bytes: number;
  expires_at: string;
  tables: Array<{ name: string; row_count: number }>;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function ExportData() {
  const t = useTranslations('Settings.export');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExportSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/account/export', { method: 'POST' });
      if (res.status === 429) {
        setError(t('rateLimited'));
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          typeof body?.detail === 'string' ? body.detail : t('failed'),
        );
        return;
      }
      const data = (await res.json()) as ExportSuccess;
      setResult(data);
      triggerDownload(data.url, data.filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('unknownError'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-10 border border-line bg-paper-soft p-6 rounded-md">
      <h2 className="text-lg font-bold text-ink">{t('title')}</h2>
      <p className="mt-2 max-w-[640px] text-sm leading-[1.7] text-mute">
        {t('description')}
      </p>

      <div className="mt-4">
        <Button
          variant="primary"
          size="md"
          loading={loading}
          loadingLabel={t('preparing')}
          onClick={handleExport}
        >
          {t('title')}
        </Button>
      </div>

      {error ? (
        <p className="mt-4 text-sm text-warning">{error}</p>
      ) : null}

      {result ? (
        <div className="mt-5 border border-line bg-paper p-4 rounded-sm">
          <p className="text-sm text-ink">{t('done')}</p>
          <ul className="mt-3 space-y-1 text-xs text-mute">
            <li>{t('filename')} {result.filename}</li>
            <li>{t('size')} {formatBytes(result.size_bytes)}</li>
            <li>{t('expiry', { when: formatExpiry(result.expires_at) })}</li>
            <li>
              {t('tables', {
                rows: result.tables.reduce((sum, tb) => sum + tb.row_count, 0),
                count: result.tables.length,
              })}
            </li>
          </ul>
          <div className="mt-3">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => triggerDownload(result.url, result.filename)}
            >
              {t('redownload')}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

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
        setError('잠시 후 다시 시도해주세요. (시간당 export 횟수 초과)');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          typeof body?.detail === 'string'
            ? body.detail
            : 'export 실패. 잠시 후 다시 시도해주세요.',
        );
        return;
      }
      const data = (await res.json()) as ExportSuccess;
      setResult(data);
      triggerDownload(data.url, data.filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-10 border border-line bg-paper-soft p-6 rounded-md">
      <h2 className="text-lg font-bold text-ink">내 데이터 export</h2>
      <p className="mt-2 max-w-[640px] text-sm leading-[1.7] text-mute">
        계정에 연결된 모든 데이터를 ZIP 파일로 내려받습니다. 전사록·영상·인사이트
        등 큰 첨부 파일은 24시간 동안 유효한 다운로드 링크로 포함됩니다. 보안상
        OAuth refresh / access 토큰은 제외됩니다.
      </p>

      <div className="mt-4">
        <Button
          variant="primary"
          size="md"
          loading={loading}
          loadingLabel="준비 중…"
          onClick={handleExport}
        >
          내 데이터 export
        </Button>
      </div>

      {error ? (
        <p className="mt-4 text-sm text-warning">{error}</p>
      ) : null}

      {result ? (
        <div className="mt-5 border border-line bg-paper p-4 rounded-sm">
          <p className="text-sm text-ink">
            export 완료 — 다운로드가 자동으로 시작됩니다.
          </p>
          <ul className="mt-3 space-y-1 text-xs text-mute">
            <li>파일명: {result.filename}</li>
            <li>크기: {formatBytes(result.size_bytes)}</li>
            <li>링크 만료: {formatExpiry(result.expires_at)} (24시간)</li>
            <li>
              포함 테이블:{' '}
              {result.tables.reduce((sum, t) => sum + t.row_count, 0)}건 / 총{' '}
              {result.tables.length}개 테이블
            </li>
          </ul>
          <div className="mt-3">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => triggerDownload(result.url, result.filename)}
            >
              다시 받기
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

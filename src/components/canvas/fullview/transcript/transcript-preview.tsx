'use client';

/* ────────────────────────────────────────────────────────────────────
   TranscriptPreview — 전사 풀뷰 V2 상세 docx 미리보기 (state 05 export).
   fresh 신규 빌드. 레거시 JobRow>JobPreview 와 동형이나 프레젠테이션 커플링
   없이 기존 preview 라우트(GET /api/transcripts/jobs/[id]/preview?source=)만
   재사용 — 신규 백엔드 0.

   정제본/원본 토글은 clean 버전이 실제로 있을 때만(hasCleanVersion) 노출
   (레거시 동형). source 는 부모(상세)가 소유 → 같은 토글이 export 링크/
   Google Docs 공유에도 반영된다.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export type TranscriptSource = 'clean' | 'raw';

export function TranscriptPreview({
  id,
  source,
  setSource,
}: {
  id: string;
  source: TranscriptSource;
  setSource: (s: TranscriptSource) => void;
}) {
  const tView = useTranslations('Features.transcriptsView');
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasCleanVersion, setHasCleanVersion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch 결과 반영 (레거시 JobPreview 동형).
    setHtml(null);
    setError(null);
    fetch(`/api/transcripts/jobs/${id}/preview?source=${source}`)
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error ?? `preview ${r.status}`);
        }
        return r.json() as Promise<{ html?: string; hasCleanVersion?: boolean }>;
      })
      .then((j) => {
        if (cancelled) return;
        setHtml(j.html ?? '');
        setHasCleanVersion(!!j.hasCleanVersion);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'fetch_failed');
      });
    return () => {
      cancelled = true;
    };
  }, [id, source]);

  return (
    <div>
      {hasCleanVersion && (
        <div className="mb-3 flex items-center gap-1.5">
          <Button
            variant={source === 'clean' ? 'primary' : 'ghost'}
            size="xs"
            onClick={() => setSource('clean')}
          >
            {tView('cleanVersion')}
          </Button>
          <Button
            variant={source === 'raw' ? 'primary' : 'ghost'}
            size="xs"
            onClick={() => setSource('raw')}
          >
            {tView('rawVersion')}
          </Button>
        </div>
      )}
      {error ? (
        <div className="text-sm text-warning">{error}</div>
      ) : html === null ? (
        <div className="text-sm text-mute-soft">{tView('loadingPreview')}</div>
      ) : (
        <div
          className="docx-preview max-h-[60vh] overflow-y-auto text-md leading-[1.7] text-ink-2"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}

'use client';

/* ────────────────────────────────────────────────────────────────────
   UtResultView — 세션 종료 후 결과 표면 (발화 로그 + 다운로드).

   전사 완료(폴링) 시 발화 로그(전사 텍스트)를 보여주고, 화면녹화(webm)·
   오디오·전사 텍스트 다운로드 버튼(613 서명 URL)을 제공한다. 전사 실패
   (error) 여도 업로드된 녹화/오디오는 다운로드 가능 — 부분 산출물 보존.

   ⚠ 타임스탬프: 613 은 전사를 세션 단위 단일 텍스트로 저장(배치 Scribe) —
   발화별 타임스탬프는 없다. 그래서 로그는 전사 텍스트 + 세션 길이/시작시각
   메타로 구성한다(spec "발화 로그(전사, 타임스탬프)" 의 보수적 해석).

   카피는 messages 의 `AiUt.result`/`AiUt.download`/`AiUt.cta` (en+ko).
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { UtPhase, UtSessionResult } from './use-ut-session';

function formatDuration(ms: number | null): string {
  if (!ms || ms < 0) return '—';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type Props = {
  phase: UtPhase;
  result: UtSessionResult | null;
  error: string | null;
  onDownloadRecording: () => void;
  onDownloadAudio: () => void;
  onDownloadTranscript: () => void;
  onRetry: () => void;
  onReset: () => void;
};

export function UtResultView({
  phase,
  result,
  error,
  onDownloadRecording,
  onDownloadAudio,
  onDownloadTranscript,
  onRetry,
  onReset,
}: Props) {
  const t = useTranslations('AiUt');
  const transcribing = phase === 'transcribing' || phase === 'uploading';
  const transcript = result?.transcript?.trim();
  const hasRecording = Boolean(result?.has_recording);
  const hasAudio = Boolean(result?.has_audio);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      {/* 상태 배너 */}
      {transcribing && (
        <div className="rounded-xs border border-line-soft bg-paper-soft px-3 py-2 text-sm text-mute">
          {phase === 'uploading' ? t('result.uploading') : t('result.transcribing')}
        </div>
      )}
      {phase === 'error' && error && (
        <div className="flex flex-col gap-2 rounded-xs border-2 border-warning bg-paper-soft px-3 py-2 text-sm text-ink-2">
          <span>{error}</span>
          <div>
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {t('cta.retryUpload')}
            </Button>
          </div>
        </div>
      )}

      {/* 발화 로그 */}
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-mute">
            {t('result.logTitle')}
          </h3>
          {result && (
            <span className="text-xs text-mute-soft">
              {t('result.durationLabel', { duration: formatDuration(result.duration_ms) })}
            </span>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-xs border border-line-soft bg-paper p-3">
          {transcript ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">
              {transcript}
            </p>
          ) : (
            <p className="text-sm text-mute-soft">
              {transcribing
                ? t('result.logPlaceholderTranscribing')
                : t('result.logPlaceholderEmpty')}
            </p>
          )}
        </div>
      </div>

      {/* 다운로드 */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-mute">
          {t('result.downloadTitle')}
        </h3>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onDownloadRecording}
            disabled={!hasRecording}
            title={t('download.recordingTitle')}
          >
            {t('download.recording')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onDownloadAudio}
            disabled={!hasAudio}
            title={t('download.audioTitle')}
          >
            {t('download.audio')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onDownloadTranscript}
            disabled={!transcript}
            title={t('download.transcriptTitle')}
          >
            {t('download.transcript')}
          </Button>
        </div>
      </div>

      {/* 새 세션 */}
      <div className="flex justify-end border-t border-line-soft pt-3">
        <Button variant="ghost" size="sm" onClick={onReset}>
          {t('cta.newSession')}
        </Button>
      </div>
    </div>
  );
}

'use client';

/* ────────────────────────────────────────────────────────────────────
   UtResultView — 세션 종료 후 결과 표면 (발화 로그 + 다운로드).

   전사 완료(폴링) 시 발화 로그(전사 텍스트)를 보여주고, 화면녹화(webm)·
   오디오·전사 텍스트 다운로드 버튼(613 서명 URL)을 제공한다. 전사 실패
   (error) 여도 업로드된 녹화/오디오는 다운로드 가능 — 부분 산출물 보존.

   ⚠ 타임스탬프: 613 은 전사를 세션 단위 단일 텍스트로 저장(배치 Scribe) —
   발화별 타임스탬프는 없다. 그래서 로그는 전사 텍스트 + 세션 길이/시작시각
   메타로 구성한다(spec "발화 로그(전사, 타임스탬프)" 의 보수적 해석).
   ──────────────────────────────────────────────────────────────────── */

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
  const transcribing = phase === 'transcribing' || phase === 'uploading';
  const transcript = result?.transcript?.trim();
  const hasRecording = Boolean(result?.has_recording);
  const hasAudio = Boolean(result?.has_audio);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      {/* 상태 배너 */}
      {transcribing && (
        <div className="rounded-xs border border-line-soft bg-paper-soft px-3 py-2 text-sm text-mute">
          {phase === 'uploading' ? '녹화를 저장하는 중이에요…' : '발화를 전사하는 중이에요…'}
        </div>
      )}
      {phase === 'error' && error && (
        <div className="flex flex-col gap-2 rounded-xs border-2 border-warning bg-paper-soft px-3 py-2 text-sm text-ink-2">
          <span>{error}</span>
          <div>
            <Button variant="secondary" size="sm" onClick={onRetry}>
              업로드 다시 시도
            </Button>
          </div>
        </div>
      )}

      {/* 발화 로그 */}
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-mute">
            발화 로그
          </h3>
          {result && (
            <span className="text-xs text-mute-soft">
              길이 {formatDuration(result.duration_ms)}
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
                ? '전사가 완료되면 여기에 발화가 표시돼요.'
                : '전사된 발화가 없어요.'}
            </p>
          )}
        </div>
      </div>

      {/* 다운로드 */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-mute">
          다운로드
        </h3>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onDownloadRecording}
            disabled={!hasRecording}
            title="화면녹화 다운로드 (음성 포함 · mp4, 미지원 브라우저는 webm)"
          >
            🎬 화면녹화
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onDownloadAudio}
            disabled={!hasAudio}
            title="음성 오디오 다운로드 (m4a, 미지원 브라우저는 webm)"
          >
            🎙 오디오
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onDownloadTranscript}
            disabled={!transcript}
            title="전사 텍스트 다운로드"
          >
            📄 전사 텍스트
          </Button>
        </div>
      </div>

      {/* 새 세션 */}
      <div className="flex justify-end border-t border-line-soft pt-3">
        <Button variant="ghost" size="sm" onClick={onReset}>
          새 세션 시작
        </Button>
      </div>
    </div>
  );
}

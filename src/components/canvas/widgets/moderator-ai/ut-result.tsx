'use client';

/* ────────────────────────────────────────────────────────────────────
   UtResultView — 세션 종료 후 결과 표면 (인사이트 주노출 + 발화 로그 + 다운로드).

   리뷰 진입 시 **인사이트 리포트 + 하이라이트 클립(626)** 이 자동 생성되어
   최상단 주 표면으로 노출된다(리서처 클릭 불필요). 행동 계량(622)은 그 아래
   보조. **발화 로그(전사 텍스트)는 기본 접힘** — "발화 전문 보기" 토글로만
   펼친다(인용 맥락이 필요할 때만). 화면녹화(webm)·오디오·전사 텍스트 다운로드
   버튼(613 서명 URL)은 그대로 유지 — 전사를 화면에서 숨겨도 데이터는 보존.
   전사 실패(error)여도 업로드된 녹화/오디오는 다운로드 가능 — 부분 산출물 보존.

   ⚠ 타임스탬프: 613 은 전사를 세션 단위 단일 텍스트로 저장(배치 Scribe) —
   발화별 타임스탬프는 없다. 그래서 로그는 전사 텍스트 + 세션 길이/시작시각
   메타로 구성한다(spec "발화 로그(전사, 타임스탬프)" 의 보수적 해석).

   카피는 messages 의 `AiUt.result`/`AiUt.download`/`AiUt.cta` (en+ko).
   ──────────────────────────────────────────────────────────────────── */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { UtPhase, UtSessionResult } from './use-ut-session';
import { UtBehaviorView } from './ut-behavior-view';
import { UtInsightClips } from './ut-insight-clips';

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
  // 로컬 self-capture 에서만 업로드 재시도 가능(브라우저가 blob 을 들고 있음).
  // 원격 모드는 참가자가 업로드/전사하므로 리서처가 재시도할 수 없다 → 생략.
  onRetry?: () => void;
  onReset: () => void;
  // 행동 계량 뷰(622) — 핫스팟 seek 용 인라인 재생 URL 발급. 없으면 계량 뷰 생략.
  getPlaybackUrl?: () => Promise<string | null>;
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
  getPlaybackUrl,
}: Props) {
  const t = useTranslations('AiUt');
  const transcribing = phase === 'transcribing' || phase === 'uploading';
  const transcript = result?.transcript?.trim();
  const hasRecording = Boolean(result?.has_recording);
  const hasAudio = Boolean(result?.has_audio);
  // 발화 로그는 기본 접힘 — 리서처가 인용 맥락이 필요할 때만 토글로 펼친다.
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      {/* 상태 배너 */}
      {transcribing && (
        <div className="rounded-xs border border-line-soft bg-paper-soft px-3 py-2 text-sm text-mute">
          {phase === 'uploading' ? t('result.uploading') : t('result.transcribing')}
        </div>
      )}
      {phase === 'error' && error && (
        <div className="flex flex-col gap-2 rounded-xs border-2 border-warning bg-paper-soft px-3 py-2 text-sm text-ink-2">
          <span>{error}</span>
          {onRetry && (
            <div>
              <Button variant="secondary" size="sm" onClick={onRetry}>
                {t('cta.retryUpload')}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* 인사이트 클립 레이어(626) — 주 표면(최상단). 전사 완료 + 녹화 존재 시
          리뷰 진입과 동시에 자동 생성되어 리포트+하이라이트 클립을 노출한다. */}
      {phase === 'done' && result && hasRecording && (
        <UtInsightClips sessionId={result.id} />
      )}

      {/* 행동 계량 레이어(622) — 보조. 전사 완료 후 비전 후처리 산출. 626(질적
          클립/서술)과 분리된 정량 패널로 인사이트 아래 공존. */}
      {phase === 'done' && getPlaybackUrl && result && (
        <UtBehaviorView
          metrics={result.behavior_metrics}
          events={result.events}
          analysisStatus={result.analysis_status}
          analysisError={result.analysis_error}
          durationMs={result.duration_ms}
          hasRecording={hasRecording}
          getPlaybackUrl={getPlaybackUrl}
        />
      )}

      {/* 발화 로그 — 기본 접힘. "발화 전문 보기" 토글로만 펼친다. 전사 진행
          중에는 상태 안내를 위해 펼쳐 둔다. */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-mute">
              {t('result.logTitle')}
            </h3>
            {result && (
              <span className="text-xs text-mute-soft">
                {t('result.durationLabel', { duration: formatDuration(result.duration_ms) })}
              </span>
            )}
          </div>
          {!transcribing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTranscriptOpen((v) => !v)}
            >
              {transcriptOpen ? t('result.hideTranscript') : t('result.showTranscript')}
            </Button>
          )}
        </div>
        {(transcriptOpen || transcribing) && (
          <div className="max-h-64 overflow-y-auto rounded-xs border border-line-soft bg-paper p-3">
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
        )}
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

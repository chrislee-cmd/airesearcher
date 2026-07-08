'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/toast-provider';

// 전사록 위젯 인라인 녹음 진입 (#503). 업로드 dropzone 옆에서 마이크 녹음을
// 켜고, 정지 시 Blob → File 로 래핑해 부모의 파일 진입점(startUploads)에
// 넘긴다 — 이후 언어확인·업로드·전사(mode/발화자/언어) 흐름은 파일 업로드와
// 완전히 동일하다 (서버·파이프라인 무변경). MediaRecorder 패턴은 QA 마이크
// 버튼(qa-voice-agent-button.tsx)의 pickMime/chunks/track-stop 을 재사용한다.
type Phase = 'idle' | 'recording';

// QA 마이크와 동일 fallback 사슬 — webm/opus 우선, Safari 는 mp4 로 폴백.
function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

function extForMime(mime: string): string {
  return mime.includes('mp4') ? 'm4a' : 'webm';
}

// 파일명 타임스탬프 — 녹음_2026-07-09_1432.webm 형태. 로컬 시각 기준.
function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(
    d.getHours(),
  )}${p(d.getMinutes())}`;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function TranscriptRecordButton({
  onRecorded,
  disabled,
}: {
  onRecorded: (file: File) => void;
  disabled?: boolean;
}) {
  const tW = useTranslations('Widgets');
  const { push } = useToast();

  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>('audio/webm');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 언마운트 중 녹음이 살아 있으면 트랙·타이머를 확실히 정리 (리소스 누수 방지).
  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const startRecording = useCallback(async () => {
    // 미지원 브라우저 — 녹음만 막고 파일 업로드는 그대로 가능함을 안내.
    if (
      typeof MediaRecorder === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      push(tW('transcriptRecordUnsupported'), { tone: 'warn', ttlMs: 12000 });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const mime = pickMimeType();
      mimeRef.current = mime || 'audio/webm';
      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime, audioBitsPerSecond: 128000 } : undefined,
      );
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        // 트랙 stop — mic 표시등/리소스 즉시 해제.
        stream.getTracks().forEach((t) => t.stop());
        const mimeType = mimeRef.current || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        // 빈 녹음(즉시 정지 등)은 투입하지 않는다.
        if (blob.size === 0) {
          push(tW('transcriptRecordEmpty'), { tone: 'warn' });
          return;
        }
        const file = new File(
          [blob],
          `${tW('transcriptRecordFilePrefix')}_${stamp()}.${extForMime(mimeType)}`,
          { type: mimeType },
        );
        // 파일 업로드와 동일 진입점으로 투입 — 언어확인·업로드·전사가 재사용됨.
        onRecorded(file);
      };
      recorder.start();
      recorderRef.current = recorder;
      setElapsed(0);
      setPhase('recording');
      timerRef.current = setInterval(() => {
        setElapsed((s) => s + 1);
      }, 1000);
    } catch (e) {
      // 실패 모드별 친화적 안내 — 어느 경우든 파일 업로드로 계속 진행 가능.
      const name = e instanceof DOMException ? e.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        push(tW('transcriptRecordPermissionDenied'), {
          tone: 'warn',
          ttlMs: 15000,
        });
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        push(tW('transcriptRecordNoDevice'), { tone: 'warn', ttlMs: 15000 });
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        push(`${tW('transcriptRecordError')}: ${msg}`, {
          tone: 'warn',
          ttlMs: 15000,
        });
      }
      setPhase('idle');
    }
  }, [onRecorded, push, tW]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPhase('idle');
  }, []);

  const handleClick = useCallback(() => {
    if (phase === 'recording') stopRecording();
    else void startRecording();
  }, [phase, startRecording, stopRecording]);

  const recording = phase === 'recording';
  const button = (
    <Button
      type="button"
      variant={recording ? 'secondary' : 'ghost'}
      size="md"
      fullWidth
      onClick={handleClick}
      disabled={disabled}
      aria-pressed={recording}
      aria-label={recording ? tW('transcriptRecordStopAria') : tW('transcriptRecordStart')}
      className={recording ? 'text-amore' : undefined}
    >
      {recording
        ? `⏹ ${tW('transcriptRecordStop')} · ${formatElapsed(elapsed)}`
        : `🎙 ${tW('transcriptRecordStart')}`}
    </Button>
  );

  // 녹음 중에는 pulse ring 을 두른 wrapper 로 "지금 녹음 중" 을 강조한다
  // (QA 마이크 #487 과 동일 패턴 — reduced-motion 시 정적 amore 링으로 대체).
  return recording ? (
    <span className="qa-mic-recording-pulse block">{button}</span>
  ) : (
    button
  );
}

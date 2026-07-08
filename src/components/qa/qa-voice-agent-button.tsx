'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { IconButton } from '@/components/ui/icon-button';
import { useToast } from '@/components/toast-provider';
import { createClient } from '@/lib/supabase/client';

// Voice-feedback entry point, shown to every signed-in account (rendered
// inside the Topbar's authed cluster next to TopbarAccount). One-tap toggle
// recorder — NO popup, NO tag form, NO device picker (the friction the modal
// flow added in #164/#171). Flow:
//   1st tap → request mic + MediaRecorder.start (default input device)
//   2nd tap → stop + auto-submit (Storage upload + qa_feedbacks insert +
//             async transcribe) — the same backend the modal used.
// The button itself is the only UI: it swaps to a recording indicator while
// live and a completion toast confirms the submit. Tags are optional now
// (stored empty under meta.tags); the admin viewer's tag filter already
// falls back to showing untagged feedback when no filter is active.
type Phase = 'idle' | 'recording' | 'uploading';

// Peak input level (0..1, RMS off a WebAudio analyser) below which we treat
// the take as effectively silent — mic muted or wrong OS input. Per the
// one-tap spec this is now a PASSIVE warning only: we still upload the take
// (never lose it, never block the tester) and just flag meta.silent + surface
// a non-blocking toast so they can re-check their mic. No picker, no hard block.
const SILENCE_PEAK_THRESHOLD = 0.02;

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

export function QaVoiceAgentButton() {
  const [phase, setPhase] = useState<Phase>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const durationRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeRef = useRef<string>('audio/webm');
  // Lightweight silent-take metering: tracks the peak RMS across the take so we
  // can flag meta.silent + fire a passive warning on submit. No VU UI — the
  // one-tap flow surfaces nothing but the button + toasts.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const peakRef = useRef(0);

  const pathname = usePathname();
  const { push } = useToast();
  const supabase = createClient();

  const stopMetering = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  // Tear everything down if the button unmounts mid-recording (e.g. sign-out).
  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (audioCtxRef.current) void audioCtxRef.current.close().catch(() => {});
      recorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const handleUpload = useCallback(async () => {
    const mime = mimeRef.current || 'audio/webm';
    const blob = new Blob(chunksRef.current, { type: mime });
    const seconds = durationRef.current;
    const silent = peakRef.current < SILENCE_PEAK_THRESHOLD;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      push('로그인이 필요합니다', { tone: 'warn' });
      setPhase('idle');
      return;
    }

    // Each tap-cycle is its own submission → its own session_id.
    const sessionId = crypto.randomUUID();

    // Storage upload — key must start with the user's id so the per-user
    // storage RLS policy (foldername[1] = auth.uid()) admits the write.
    const key = `${user.id}/${sessionId}/${Date.now()}-${crypto
      .randomUUID()
      .slice(0, 8)}.${extForMime(mime)}`;
    const { error: uploadErr } = await supabase.storage
      .from('qa-feedback-audio')
      .upload(key, blob, { contentType: mime });
    if (uploadErr) {
      push(`업로드 실패: ${uploadErr.message}`, { tone: 'warn' });
      setPhase('idle');
      return;
    }

    // DB insert — transcript stays null until the async transcribe fills it.
    // tags is intentionally empty: the one-tap flow drops the tagging form, so
    // feedback is untagged (admin viewer's tag filter is backward-compatible).
    const { data: row, error: insertErr } = await supabase
      .from('qa_feedbacks')
      .insert({
        user_id: user.id,
        session_id: sessionId,
        audio_storage_key: key,
        page_url: pathname ?? null,
        duration_seconds: seconds,
        status: 'pending',
        meta: { user_agent: navigator.userAgent, silent, tags: [] },
      })
      .select('id')
      .single();
    if (insertErr) {
      push(`저장 실패: ${insertErr.message}`, { tone: 'warn' });
      setPhase('idle');
      return;
    }

    // Fire-and-forget transcription — the row is already saved, so a failed
    // transcribe just leaves status 'pending'/'error' for a later retry and
    // never blocks the user's submission.
    void fetch('/api/qa/transcribe', {
      method: 'POST',
      body: JSON.stringify({ feedback_id: row.id }),
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {});

    if (silent) {
      // Passive warning only (spec §B/§C): the take is saved, we just nudge the
      // tester to check their mic in case it was muted / wrong input.
      push('피드백은 제출됐지만 마이크 입력이 거의 감지되지 않았어요. 마이크를 확인해 주세요.', {
        tone: 'warn',
        ttlMs: 10000,
      });
    } else {
      push('피드백 제출 완료', { tone: 'amore' });
    }
    setPhase('idle');
    durationRef.current = 0;
  }, [pathname, push, supabase]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Peak metering only (no live UI) so submit can flag a silent take.
      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
        peakRef.current = 0;
        const buf = new Uint8Array(analyser.fftSize);
        const tick = () => {
          const a = analyserRef.current;
          if (!a) return;
          a.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          peakRef.current = Math.max(peakRef.current, Math.sqrt(sum / buf.length));
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      }

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
        stream.getTracks().forEach((t) => t.stop());
        stopMetering();
        void handleUpload();
      };
      recorder.start();
      recorderRef.current = recorder;
      setPhase('recording');
      durationRef.current = 0;
      timerRef.current = setInterval(() => {
        durationRef.current += 1;
      }, 1000);
    } catch (e) {
      stopMetering();
      // Non-blocking, actionable guidance per failure mode. NotAllowedError →
      // permission denied; NotFoundError → no device. The flow is never blocked
      // — the tester just retries after fixing the cause.
      const name = e instanceof DOMException ? e.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        push(
          '마이크 권한이 거부됐어요. Chrome 주소창 왼쪽 자물쇠 → 사이트 설정 → 마이크에서 "허용"으로 바꾼 뒤 다시 시도해 주세요.',
          { tone: 'warn', ttlMs: 15000 },
        );
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        push('마이크 장치를 찾을 수 없어요. 마이크 연결 상태를 확인해 주세요.', {
          tone: 'warn',
          ttlMs: 15000,
        });
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        push(`마이크 오류: ${msg}`, { tone: 'warn', ttlMs: 15000 });
      }
      setPhase('idle');
    }
  }, [handleUpload, push, stopMetering]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPhase('uploading');
  }, []);

  const handleClick = useCallback(() => {
    if (phase === 'idle') void startRecording();
    else if (phase === 'recording') stopRecording();
    // phase === 'uploading' → ignore taps until the submit resolves.
  }, [phase, startRecording, stopRecording]);

  // One button, three reads: idle mic, live recording, and a brief uploading
  // state. No modal, no form — the button IS the whole UI. `subtle` + `md`
  // match the adjacent TopbarAccount gear.
  //
  // The recording read is the point of #487: static wasn't enough to tell
  // "it's on". So live recording gets a THREE-way dynamic shift, not a static
  // badge:
  //   1. amore ring PULSE around the chip (wrapper span, CSS keyframe) — the
  //      "we're listening" heartbeat. Under prefers-reduced-motion the CSS
  //      swaps the pulse for a static amore ring so it's still unmistakably on.
  //   2. glyph swap 🎤 → ⏹ (stop) — the affordance flips to "tap to end".
  //   3. amore color on the glyph — the accent shifts from neutral ink.
  // aria-pressed + a "눌러서 종료" label carry the same state to SR users.
  //
  // A live input-level meter (spec §B, optional) is intentionally omitted to
  // keep the one-tap chrome as minimal as #486 intended — the silent-take
  // metering already guards the muted-mic case via a passive submit warning.
  const recording = phase === 'recording';
  const label =
    phase === 'recording'
      ? 'QA 피드백 녹음 중 — 눌러서 종료 및 제출'
      : phase === 'uploading'
        ? 'QA 피드백 제출 중'
        : 'QA 피드백 녹음 시작';

  const button = (
    <IconButton
      variant="subtle"
      size="md"
      aria-label={label}
      aria-pressed={recording}
      onClick={handleClick}
      disabled={phase === 'uploading'}
      className={recording ? 'text-amore' : undefined}
    >
      {recording ? '⏹' : phase === 'uploading' ? '⏳' : '🎤'}
    </IconButton>
  );

  // Wrap only while recording so the pulsing ring lives on a dedicated span and
  // never fights the IconButton's own chrome (same technique as
  // widget-gate-guide-pulse). inline-flex hugs the circular chip.
  return recording ? (
    <span className="qa-mic-recording-pulse inline-flex">{button}</span>
  ) : (
    button
  );
}

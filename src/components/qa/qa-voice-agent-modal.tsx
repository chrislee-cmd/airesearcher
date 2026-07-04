'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/toast-provider';
import { createClient } from '@/lib/supabase/client';
import { QA_TAGS } from '@/lib/qa-tags';

// QA voice-feedback recorder (PR4 of the QA voice-agent epic). Replaces the
// PR3 placeholder body. Flow: form → idle → [record] → recording → [stop &
// submit] → uploading → Storage upload + qa_feedbacks insert + async
// transcribe → success toast → close. The modal stays mounted (open/onClose
// owned by QaVoiceAgentButton); a fresh session_id is minted per submission so
// every re-open groups its recordings under a new session (spec §C).
//
// The 'form' step (added by the tagging PR) runs BEFORE recording: the tester
// tags which feature/area the feedback is about (min 1 tag) so the admin
// viewer can filter by tag. Detailed opinions still come from the voice take —
// the form is identifiers only, no rating scale.
type Phase = 'form' | 'idle' | 'recording' | 'uploading';

// Peak input level (0..1, RMS from the WebAudio analyser) below which we treat
// the take as effectively silent — mic muted or wrong input device. We still
// upload (never lose the user's take) but warn so they check their mic instead
// of assuming it worked. A near-silent webm is what produced the empty
// transcript + no-sound-on-playback report.
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

export function QaVoiceAgentModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('form');
  const [tags, setTags] = useState<string[]>([]);
  const [duration, setDuration] = useState(0);
  const [level, setLevel] = useState(0); // live input level 0..1 (VU meter)
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const durationRef = useRef(0);
  // Session identity: minted lazily on first record, reset after each
  // submission — same session across repeated records while open, new session
  // after a submit or close/reopen.
  const sessionIdRef = useRef<string | null>(null);
  const mimeRef = useRef<string>('audio/webm');
  // WebAudio metering — lets the user see, live, whether the mic is picking up
  // sound, and lets us flag a silent take on submit.
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
    setLevel(0);
  }, []);

  // Each fresh open starts at the tagging form with a clean slate — the modal
  // stays mounted between opens, so without this reset the previous take's
  // phase/tags would leak into the next session. We reset during render on the
  // closed→open transition (React's "adjust state when a prop changes"
  // pattern) rather than in an effect, which avoids a cascading extra render.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setPhase('form');
      setTags([]);
    }
  }

  // Tear everything down if the modal unmounts mid-recording.
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

    // Silent take = hard block. A near-silent webm produced the empty-transcript
    // + no-sound-on-playback report, so instead of uploading-and-warning we skip
    // the Storage upload + DB insert entirely and send the tester back to record
    // again. QA reliability wins over never-losing-a-take here.
    if (silent) {
      push('마이크 입력이 감지되지 않았어요. 다시 녹음해 주세요.', {
        tone: 'warn',
        ttlMs: 10000,
      });
      setPhase('idle');
      setDuration(0);
      durationRef.current = 0;
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      push('로그인이 필요합니다', { tone: 'warn' });
      setPhase('idle');
      return;
    }

    const sessionId = sessionIdRef.current ?? crypto.randomUUID();
    sessionIdRef.current = sessionId;

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
    const { data: row, error: insertErr } = await supabase
      .from('qa_feedbacks')
      .insert({
        user_id: user.id,
        session_id: sessionId,
        audio_storage_key: key,
        page_url: pathname ?? null,
        duration_seconds: seconds,
        status: 'pending',
        meta: { user_agent: navigator.userAgent, silent, tags },
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

    // A silent take never reaches here — it hard-blocks above — so submission is
    // always a genuine, audible recording at this point.
    push('피드백 제출 완료', { tone: 'amore' });
    setPhase('idle');
    setDuration(0);
    durationRef.current = 0;
    // New submission cycle → new session next time the user records.
    sessionIdRef.current = null;
    onClose();
  }, [onClose, pathname, push, supabase, tags]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Live input metering: RMS off a time-domain analyser, sampled per frame.
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
          const rms = Math.sqrt(sum / buf.length);
          peakRef.current = Math.max(peakRef.current, rms);
          setLevel(rms);
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
      setDuration(0);
      durationRef.current = 0;
      timerRef.current = setInterval(() => {
        durationRef.current += 1;
        setDuration(durationRef.current);
      }, 1000);
    } catch {
      stopMetering();
      push('마이크 권한이 필요합니다', { tone: 'warn' });
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

  const mmss = `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`;
  // Scale the raw RMS up for a livelier meter; clamp to 100%.
  const meterPct = Math.min(100, Math.round(level * 240));

  const toggleTag = (key: string, checked: boolean) => {
    setTags((prev) =>
      checked ? [...prev, key] : prev.filter((x) => x !== key),
    );
  };
  const canProceed = tags.length > 0;

  return (
    <Modal open={open} onClose={onClose} title="QA 피드백" size="md">
      {phase === 'form' && (
        <div className="space-y-5 py-4">
          <p className="text-sm text-mute">
            어떤 항목에 대한 피드백인가요? (최소 1개)
          </p>

          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {QA_TAGS.map((t) => (
              <label
                key={t.key}
                className="flex items-center gap-2 cursor-pointer text-sm text-ink"
              >
                <Checkbox
                  checked={tags.includes(t.key)}
                  onChange={(e) => toggleTag(t.key, e.target.checked)}
                  aria-label={t.label}
                />
                {t.label}
              </label>
            ))}
          </div>

          <Button
            variant="primary"
            size="md"
            onClick={() => canProceed && setPhase('idle')}
            disabled={!canProceed}
            className="w-full"
          >
            다음 → 녹음
          </Button>
          <p className="text-xs-soft text-mute-soft text-center">
            상세 의견은 다음 단계에서 음성으로 남겨 주세요.
          </p>
        </div>
      )}

      {phase !== 'form' && (
      <div className="flex flex-col items-center gap-4 py-4">
        {phase === 'idle' && (
          <>
            <div className="text-6xl">🎤</div>
            <p className="text-center text-sm text-mute">
              피드백을 음성으로 남겨 주세요.
              <br />
              자동으로 텍스트로 변환되어 저장됩니다.
            </p>
            <Button variant="primary" size="md" onClick={startRecording}>
              ● 녹음 시작
            </Button>
          </>
        )}
        {phase === 'recording' && (
          <>
            <div className="animate-pulse text-6xl">🔴</div>
            <p className="font-mono text-lg text-ink">{mmss}</p>
            {/* Live input meter — confirms the mic is actually picking up sound. */}
            <div className="h-2 w-40 overflow-hidden rounded-full bg-paper-soft border border-line-soft">
              <div
                className="h-full bg-amore transition-[width] duration-75"
                style={{ width: `${meterPct}%` }}
              />
            </div>
            <p className="text-sm text-mute">
              {meterPct < 4 ? '소리가 감지되지 않아요 — 마이크 확인' : '녹음 중…'}
            </p>
            {/* Sustained-silence warning: after 3s of input below the silence
                threshold, surface a prominent alert so the tester fixes the mic
                before stopping — a silent take is hard-blocked on submit. */}
            {level < SILENCE_PEAK_THRESHOLD && duration >= 3 && (
              <p className="text-sm text-warning text-center">
                ⚠ 마이크 입력이 감지되지 않아요. 마이크 상태를 확인하세요.
              </p>
            )}
            <Button variant="primary" size="md" onClick={stopRecording}>
              ⏹ 정지 &amp; 제출
            </Button>
          </>
        )}
        {phase === 'uploading' && (
          <>
            <div className="text-6xl">☁️</div>
            <p className="text-sm text-mute">업로드 중…</p>
          </>
        )}
      </div>
      )}
    </Modal>
  );
}

'use client';

import { useCallback, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/toast-provider';
import { createClient } from '@/lib/supabase/client';

// QA voice-feedback recorder (PR4 of the QA voice-agent epic). Replaces the
// PR3 placeholder body. Flow: idle → [record] → recording → [stop & submit]
// → uploading → Storage upload + qa_feedbacks insert + async transcribe →
// success toast → close. The modal stays mounted (open/onClose owned by
// QaVoiceAgentButton); a fresh session_id is minted per mount so every
// re-open groups its recordings under a new session (spec §C).
type Phase = 'idle' | 'recording' | 'uploading';

export function QaVoiceAgentModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [duration, setDuration] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Session identity: one id for the life of this mount. Re-opening the modal
  // remounts the button's <QaVoiceAgentModal /> tree via unmount? No — the
  // modal is always mounted, so we mint the id lazily on first record and
  // reset it when the user finishes a submission, matching the spec: same
  // session across repeated records while open, new session after close/reopen.
  const sessionIdRef = useRef<string | null>(null);
  const pathname = usePathname();
  const { push } = useToast();
  const supabase = createClient();

  const durationRef = useRef(0);

  const handleUpload = useCallback(async () => {
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    const seconds = durationRef.current;

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
      .slice(0, 8)}.webm`;
    const { error: uploadErr } = await supabase.storage
      .from('qa-feedback-audio')
      .upload(key, blob, { contentType: 'audio/webm' });
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
        meta: { user_agent: navigator.userAgent },
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

    push('피드백 제출 완료', { tone: 'amore' });
    setPhase('idle');
    setDuration(0);
    durationRef.current = 0;
    // New submission cycle → new session next time the user records.
    sessionIdRef.current = null;
    onClose();
  }, [onClose, pathname, push, supabase]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
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
      push('마이크 권한이 필요합니다', { tone: 'warn' });
    }
  }, [handleUpload, push]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPhase('uploading');
  }, []);

  const mmss = `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`;

  return (
    <Modal open={open} onClose={onClose} title="QA 피드백" size="sm">
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
            <p className="text-sm text-mute">녹음 중…</p>
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
    </Modal>
  );
}

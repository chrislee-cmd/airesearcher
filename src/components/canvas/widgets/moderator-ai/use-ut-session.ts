'use client';

/* ────────────────────────────────────────────────────────────────────
   useUtSession — AI UT (방식 D) 세션 엔진.

   유저가 자기 브라우저 새 탭에서 실제 사이트를 보며 자유발화하는 동안:
     1. getDisplayMedia → 화면 스트림 → MediaRecorder(webm) 녹화
     2. getUserMedia(mic) → MediaRecorder(webm/opus) 보이스 녹음
        (qa-voice-agent-button 의 mime 폴백/teardown 패턴을 미러 —
         데이터는 qa_feedbacks 가 아니라 613 의 ut_sessions).
   세션 종료 시 두 blob 을 613 서명 업로드 URL 로 스토리지에 직접 올리고
   (DB 엔 key 만), finalize 가 전사를 동기 트리거한다. 그 뒤 세션 row 를
   폴링해 전사(발화 로그)를 읽어온다.

   상태 walk (서버와 정합): idle → live → uploading → transcribing →
   done | error. 서버 status 는 recording→uploading→transcribing→done|error.

   ⚠ 프라이버시: 화면 녹화는 로그인/결제 화면을 담을 수 있어 613 은 두 버킷을
   private 로 두고 서명 URL 로만 노출한다. 이 훅은 권한 요청 전 동의 게이트를
   강제하지 않는다 — 동의 모달은 호출부(ut-session-body)가 소유하고, 훅의
   start() 는 이미 동의된 뒤에만 호출된다.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { fetchWithAuth } from '@/lib/api/fetch-with-auth';

export type UtPhase =
  | 'idle'
  | 'live'
  | 'uploading'
  | 'transcribing'
  | 'done'
  | 'error';

// 폴링으로 읽어오는 세션 표면 (GET /api/ut/sessions/[id] 의 session).
export type UtSessionResult = {
  id: string;
  status: string;
  target_url: string | null;
  transcript: string | null;
  duration_ms: number | null;
  has_audio: boolean;
  has_recording: boolean;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

type Blobs = { audio: Blob | null; recording: Blob | null };

// MediaRecorder 는 트랜스코딩을 못 하므로 다운로드 포맷 = 캡처 포맷. 그래서
// 재생 호환성 높은 mp4(H.264)/m4a(AAC)를 먼저 시도하고, 지원 안 되는 엔진
// (Firefox 등)만 webm 으로 폴백한다. ext 는 서버 upload-url 로 넘겨 스토리지
// key 확장자·다운로드 파일명을 실제 컨테이너와 일치시킨다.
type Picked = { mime: string; ext: 'mp4' | 'm4a' | 'webm' };

// 보이스 트랙 — m4a(mp4/AAC) 우선, webm/opus 폴백.
function pickAudio(): Picked {
  if (typeof MediaRecorder === 'undefined') return { mime: '', ext: 'webm' };
  for (const t of ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(t)) return { mime: t, ext: 'm4a' };
  }
  for (const t of ['audio/webm;codecs=opus', 'audio/webm']) {
    if (MediaRecorder.isTypeSupported(t)) return { mime: t, ext: 'webm' };
  }
  return { mime: '', ext: 'webm' };
}

// 화면 트랙 — mp4(H.264+AAC) 우선, webm(vp9/vp8+opus) 폴백. 화면 레코더는
// 화면 비디오 + 마이크 음성을 합친 스트림을 녹으므로 오디오 코덱까지 포함한
// mime 을 요청한다 → 영상 파일에 음성이 함께 담긴다.
function pickVideo(): Picked {
  if (typeof MediaRecorder === 'undefined') return { mime: '', ext: 'webm' };
  for (const t of [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
  ]) {
    if (MediaRecorder.isTypeSupported(t)) return { mime: t, ext: 'mp4' };
  }
  for (const t of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(t)) return { mime: t, ext: 'webm' };
  }
  return { mime: '', ext: 'webm' };
}

// 사용자가 스킴 없이 "example.com" 만 입력해도 새 탭 오픈 + 서버 검증(z.url())
// 을 통과하도록 https:// 를 보충. 이미 스킴이 있으면 그대로.
export function normalizeTargetUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    // 유효성만 검사 — 반환은 정규화된 문자열.
    return new URL(withScheme).toString();
  } catch {
    return null;
  }
}

const POLL_TRIES = 8;
const POLL_INTERVAL_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type UseUtSession = {
  phase: UtPhase;
  sessionId: string | null;
  elapsedMs: number;
  error: string | null;
  result: UtSessionResult | null;
  isSupported: boolean;
  /** 라이브 화면 프리뷰 <video> 에 스트림을 붙이는 ref 콜백. */
  attachPreview: (el: HTMLVideoElement | null) => void;
  start: (rawTargetUrl: string, opts?: { includeSiteAudio?: boolean }) => Promise<void>;
  stop: () => void;
  retryUpload: () => void;
  reset: () => void;
  download: (kind: 'recording' | 'audio') => Promise<void>;
  downloadTranscript: () => void;
};

export function useUtSession(): UseUtSession {
  const [phase, setPhase] = useState<UtPhase>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UtSessionResult | null>(null);
  const [isSupported, setIsSupported] = useState(false);

  // 콜백(MediaRecorder.onstop / 폴링) 이 최신 값을 refs 로 읽어 stale 클로저를
  // 피한다 — 이 훅의 흐름 함수들은 전부 stable(빈 deps) 이고 state 는 refs 로 읽음.
  const phaseRef = useRef<UtPhase>('idle');
  const sessionIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);

  const screenStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const screenRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const screenChunksRef = useRef<Blob[]>([]);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioMimeRef = useRef('audio/webm');
  const videoMimeRef = useRef('video/webm');
  const audioExtRef = useRef<'mp4' | 'm4a' | 'webm'>('webm');
  const videoExtRef = useRef<'mp4' | 'm4a' | 'webm'>('webm');
  const blobsRef = useRef<Blobs | null>(null);
  // 사이트 소리 믹싱용 — 켜졌을 때만 생성. 마이크 + 탭 오디오를 하나의 트랙으로
  // 합쳐 영상에 싣는다. teardown 에서 close/stop.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mixedAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const pendingStopRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // 브라우저 지원 — SSR mismatch 방지 위해 마운트 후 클라에서만 판정.
  useEffect(() => {
    const ok =
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getDisplayMedia === 'function' &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      typeof MediaRecorder !== 'undefined';
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration capability probe (navigator is undefined during SSR; a useState initializer would mismatch on hydration)
    setIsSupported(ok);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 모든 스트림/레코더 하드 teardown — 언마운트 / reset / 실패 경로 공용.
  const teardownStreams = useCallback(() => {
    screenRecorderRef.current = null;
    audioRecorderRef.current = null;
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    // 믹서(사이트 소리 결합)로 만든 트랙/컨텍스트 — screen/mic 스트림 밖이라
    // 별도로 정리.
    mixedAudioTrackRef.current?.stop();
    mixedAudioTrackRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    screenStreamRef.current = null;
    micStreamRef.current = null;
    if (videoElRef.current) videoElRef.current.srcObject = null;
  }, []);

  // 언마운트 시 라이브 세션이 남지 않게 정리.
  useEffect(
    () => () => {
      clearTimer();
      teardownStreams();
    },
    [clearTimer, teardownStreams],
  );

  const attachPreview = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el;
    if (el && screenStreamRef.current) {
      el.srcObject = screenStreamRef.current;
    }
  }, []);

  // 서명 업로드 URL 발급 → 클라에서 스토리지로 직접 업로드 (DB 엔 key 만).
  const uploadOne = useCallback(
    async (
      id: string,
      kind: 'audio' | 'recording',
      blob: Blob,
      supabase: ReturnType<typeof createClient>,
    ) => {
      const ext = kind === 'audio' ? audioExtRef.current : videoExtRef.current;
      const res = await fetchWithAuth(`/api/ut/sessions/${id}/upload-url`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, ext }),
      });
      if (!res.ok) throw new Error(`upload_url_${kind}_${res.status}`);
      const { storage_key, token, bucket } = (await res.json()) as {
        storage_key: string;
        token: string;
        bucket: string;
      };
      // 스토리지 content-type 은 codecs 파라미터를 뺀 base MIME 으로 저장해
      // (video/mp4, audio/mp4) 다운로드/재생 시 깔끔하게 인식되게 한다.
      const contentType = (blob.type || '').split(';')[0] || undefined;
      const { error: upErr } = await supabase.storage
        .from(bucket)
        .uploadToSignedUrl(storage_key, token, blob, { contentType });
      if (upErr) throw new Error(`upload_${kind}: ${upErr.message}`);
    },
    [],
  );

  const fetchSession = useCallback(
    async (id: string): Promise<UtSessionResult | null> => {
      try {
        const res = await fetchWithAuth(`/api/ut/sessions/${id}`, {
          cache: 'no-store',
        });
        if (!res.ok) return null;
        const j = (await res.json()) as { session?: UtSessionResult };
        return j.session ?? null;
      } catch {
        return null;
      }
    },
    [],
  );

  // finalize 는 전사를 동기 실행하므로 첫 폴링에 대개 done/error 로 해소된다.
  const pollUntilResolved = useCallback(
    async (id: string) => {
      for (let i = 0; i < POLL_TRIES; i++) {
        const s = await fetchSession(id);
        if (s) {
          setResult(s);
          if (s.status === 'done') {
            setPhase('done');
            return;
          }
          if (s.status === 'error') {
            // 전사 실패라도 업로드된 녹화/오디오는 다운로드 가능.
            setError('전사에 실패했어요. 화면녹화·오디오는 다운로드할 수 있어요.');
            setPhase('error');
            return;
          }
        }
        await sleep(POLL_INTERVAL_MS);
      }
      // 폴링 타임아웃 — 업로드는 성공했으니 결과 표면은 열어둔다(전사만 지연).
      setPhase('done');
    },
    [fetchSession],
  );

  // 업로드 → finalize(전사 트리거) → 폴링. onstop 두 개가 모두 끝난 뒤,
  // 또는 retryUpload 에서 호출. blobsRef / sessionIdRef 로 최신 값을 읽는다.
  const handleUploadAndFinalize = useCallback(async () => {
    const id = sessionIdRef.current;
    const blobs = blobsRef.current;
    if (!id || !blobs) return;

    setError(null);
    setPhase('uploading');
    const supabase = createClient();

    try {
      // 오디오가 있어야 전사가 된다 — 먼저 올린다. 화면녹화는 다운로드용.
      if (blobs.audio && blobs.audio.size > 0) {
        await uploadOne(id, 'audio', blobs.audio, supabase);
      }
      if (blobs.recording && blobs.recording.size > 0) {
        await uploadOne(id, 'recording', blobs.recording, supabase);
      }
    } catch {
      setError('업로드에 실패했어요. 잠시 후 다시 시도해 주세요.');
      setPhase('error');
      return;
    }

    setPhase('transcribing');
    const durationMs = startedAtRef.current
      ? Date.now() - startedAtRef.current
      : undefined;
    try {
      await fetchWithAuth(`/api/ut/sessions/${id}/finalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(durationMs != null ? { duration_ms: durationMs } : {}),
      });
    } catch {
      // finalize 실패여도 아래 폴링이 서버 status 를 반영한다.
    }
    await pollUntilResolved(id);
  }, [uploadOne, pollUntilResolved]);

  // 두 레코더의 onstop 이 각각 이 함수를 호출 — 마지막 하나가 끝나면 업로드 개시.
  const onRecorderStopped = useCallback(() => {
    pendingStopRef.current -= 1;
    if (pendingStopRef.current > 0) return;
    blobsRef.current = {
      audio: audioChunksRef.current.length
        ? new Blob(audioChunksRef.current, { type: audioMimeRef.current })
        : null,
      recording: screenChunksRef.current.length
        ? new Blob(screenChunksRef.current, { type: videoMimeRef.current })
        : null,
    };
    teardownStreams();
    void handleUploadAndFinalize();
  }, [handleUploadAndFinalize, teardownStreams]);

  const stop = useCallback(() => {
    if (phaseRef.current !== 'live') return;
    clearTimer();
    setPhase('uploading');
    const sr = screenRecorderRef.current;
    const ar = audioRecorderRef.current;
    pendingStopRef.current = 0;
    if (sr && sr.state !== 'inactive') {
      pendingStopRef.current += 1;
      sr.stop();
    }
    if (ar && ar.state !== 'inactive') {
      pendingStopRef.current += 1;
      ar.stop();
    }
    // 레코더가 하나도 안 돌고 있으면(엣지) 즉시 업로드 시도.
    if (pendingStopRef.current === 0) {
      blobsRef.current = {
        audio: audioChunksRef.current.length
          ? new Blob(audioChunksRef.current, { type: audioMimeRef.current })
          : null,
        recording: screenChunksRef.current.length
          ? new Blob(screenChunksRef.current, { type: videoMimeRef.current })
          : null,
      };
      teardownStreams();
      void handleUploadAndFinalize();
    }
  }, [clearTimer, handleUploadAndFinalize, teardownStreams]);

  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  // 권한 요청 실패 → 사용자 친화 안내. NotAllowedError(거부/취소) 는 조용히
  // idle 복귀(사용자가 공유 다이얼로그를 닫은 정상 흐름), 그 외는 error 표면.
  const handleMediaError = useCallback(
    (e: unknown, which: 'screen' | 'mic') => {
      const name = e instanceof DOMException ? e.name : '';
      if (name === 'NotAllowedError' || name === 'AbortError') {
        // 사용자가 공유/권한을 취소 — 조용히 idle.
        setPhase('idle');
        setError(null);
        return;
      }
      const msg =
        which === 'screen'
          ? '화면 공유를 시작하지 못했어요. 브라우저가 화면 공유를 지원하는지 확인해 주세요.'
          : '마이크 권한이 필요해요. 주소창 왼쪽 자물쇠 → 사이트 설정에서 마이크를 허용해 주세요.';
      setError(msg);
      setPhase('idle');
    },
    [],
  );

  const start = useCallback(
    async (rawTargetUrl: string, opts?: { includeSiteAudio?: boolean }) => {
      if (phaseRef.current !== 'idle') return;
      setError(null);
      setResult(null);

      const includeSiteAudio = opts?.includeSiteAudio ?? false;
      const targetUrl = normalizeTargetUrl(rawTargetUrl);

      // 1) 화면 공유 — 유저가 공유할 탭/창을 고른다. 취소하면 조용히 종료.
      //    사이트 소리 옵션이 켜지면 audio:true 로 요청 → Chrome 이 탭 공유 시
      //    "탭 오디오 공유" 체크박스를 띄운다(창/전체화면은 OS 에 따라 미제공).
      let screen: MediaStream;
      try {
        screen = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 30 },
          audio: includeSiteAudio,
        });
      } catch (e) {
        handleMediaError(e, 'screen');
        return;
      }

      // 2) 마이크 — QA 보이스 패턴과 동일한 제약.
      let mic: MediaStream;
      try {
        mic = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (e) {
        screen.getTracks().forEach((t) => t.stop());
        handleMediaError(e, 'mic');
        return;
      }

      // 3) 세션 row 생성(서비스 롤) — 권한을 다 받은 뒤라 orphan row 를 안 만든다.
      let id: string;
      try {
        const res = await fetchWithAuth('/api/ut/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(targetUrl ? { target_url: targetUrl } : {}),
        });
        if (!res.ok) throw new Error(`create_${res.status}`);
        id = ((await res.json()) as { id: string }).id;
      } catch {
        screen.getTracks().forEach((t) => t.stop());
        mic.getTracks().forEach((t) => t.stop());
        setError('세션을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.');
        setPhase('idle');
        return;
      }

      // 4) 대상 사이트를 유저 자기 브라우저 새 탭으로 — 로그인/결제 네이티브.
      if (targetUrl) window.open(targetUrl, '_blank', 'noopener,noreferrer');

      // 5) 레코더 준비 (화면 + 마이크). mime 폴백 = qa 패턴.
      screenStreamRef.current = screen;
      micStreamRef.current = mic;
      if (videoElRef.current) videoElRef.current.srcObject = screen;

      const video = pickVideo();
      videoMimeRef.current = video.mime || 'video/webm';
      videoExtRef.current = video.ext;
      // 영상에 실을 오디오 트랙을 만든다.
      //   - 기본: 마이크 음성만(별도 audioRecorder 와 같은 track 공유 — 안전).
      //   - 사이트 소리 옵션 ON + 탭 오디오 존재: WebAudio 로 마이크 + 사이트
      //     소리를 한 트랙으로 믹싱해 싣는다. (옵션 ON 이어도 유저가 "탭 오디오
      //     공유" 를 안 켜 오디오 트랙이 없으면 마이크만 — graceful.)
      const siteAudioTracks = screen.getAudioTracks();
      let videoAudioTrack: MediaStreamTrack | undefined;
      if (includeSiteAudio && siteAudioTracks.length > 0) {
        try {
          const Ctx =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext;
          const ctx = new Ctx();
          const dest = ctx.createMediaStreamDestination();
          ctx.createMediaStreamSource(new MediaStream(mic.getAudioTracks())).connect(dest);
          ctx
            .createMediaStreamSource(new MediaStream(siteAudioTracks))
            .connect(dest);
          audioCtxRef.current = ctx;
          videoAudioTrack = dest.stream.getAudioTracks()[0];
          mixedAudioTrackRef.current = videoAudioTrack ?? null;
        } catch {
          // 믹싱 실패 시 마이크만 싣는다(무회귀).
          videoAudioTrack = mic.getAudioTracks()[0];
        }
      } else {
        videoAudioTrack = mic.getAudioTracks()[0];
      }

      // 화면 비디오 + (마이크 또는 마이크+사이트 믹스) 를 한 스트림으로 녹화.
      const combinedStream = new MediaStream(
        [...screen.getVideoTracks(), videoAudioTrack].filter(
          (t): t is MediaStreamTrack => Boolean(t),
        ),
      );
      const screenRecorder = new MediaRecorder(
        combinedStream,
        video.mime ? { mimeType: video.mime } : undefined,
      );
      screenChunksRef.current = [];
      screenRecorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) screenChunksRef.current.push(ev.data);
      };
      screenRecorder.onstop = () => onRecorderStopped();

      const audioPick = pickAudio();
      audioMimeRef.current = audioPick.mime || 'audio/webm';
      audioExtRef.current = audioPick.ext;
      const audioRecorder = new MediaRecorder(
        mic,
        audioPick.mime
          ? { mimeType: audioPick.mime, audioBitsPerSecond: 128000 }
          : undefined,
      );
      audioChunksRef.current = [];
      audioRecorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      audioRecorder.onstop = () => onRecorderStopped();

      // 유저가 브라우저 크롬의 "공유 중지" 를 누르면 화면 트랙이 ended → 세션 종료.
      screen.getVideoTracks().forEach((t) => {
        t.addEventListener('ended', () => stopRef.current());
      });

      screenRecorder.start();
      audioRecorder.start();
      screenRecorderRef.current = screenRecorder;
      audioRecorderRef.current = audioRecorder;

      sessionIdRef.current = id;
      startedAtRef.current = Date.now();
      setSessionId(id);
      setElapsedMs(0);
      setPhase('live');
      clearTimer();
      timerRef.current = setInterval(() => {
        if (startedAtRef.current) setElapsedMs(Date.now() - startedAtRef.current);
      }, 1000);
    },
    [clearTimer, handleMediaError, onRecorderStopped],
  );

  const retryUpload = useCallback(() => {
    if (phaseRef.current !== 'error') return;
    if (!blobsRef.current || !sessionIdRef.current) return;
    void handleUploadAndFinalize();
  }, [handleUploadAndFinalize]);

  const reset = useCallback(() => {
    clearTimer();
    teardownStreams();
    blobsRef.current = null;
    sessionIdRef.current = null;
    startedAtRef.current = null;
    pendingStopRef.current = 0;
    setSessionId(null);
    setElapsedMs(0);
    setError(null);
    setResult(null);
    setPhase('idle');
  }, [clearTimer, teardownStreams]);

  // 서명 다운로드 URL(613) → 새 탭 오픈. 서버가 attachment disposition 을
  // 강제하므로 브라우저가 즉시 파일로 저장한다.
  const download = useCallback(async (kind: 'recording' | 'audio') => {
    const id = sessionIdRef.current;
    if (!id) return;
    try {
      const res = await fetchWithAuth(
        `/api/ut/sessions/${id}/download?kind=${kind}`,
      );
      if (!res.ok) {
        setError('다운로드 링크를 만들지 못했어요. 잠시 후 다시 시도해 주세요.');
        return;
      }
      const { url } = (await res.json()) as { url: string };
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setError('다운로드 중 오류가 발생했어요.');
    }
  }, []);

  // 전사 텍스트는 클라가 이미 들고 있으니 로컬 blob 으로 즉시 저장.
  const downloadTranscript = useCallback(() => {
    const transcript = result?.transcript;
    const id = sessionIdRef.current;
    if (!transcript || !id) return;
    const blob = new Blob([transcript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ut-transcript-${id.slice(0, 8)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [result]);

  return {
    phase,
    sessionId,
    elapsedMs,
    error,
    result,
    isSupported,
    attachPreview,
    start,
    stop,
    retryUpload,
    reset,
    download,
    downloadTranscript,
  };
}

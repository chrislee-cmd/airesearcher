'use client';

/* ────────────────────────────────────────────────────────────────────
   useUtParticipantSession — 원격 AI UT 참가자(624) 캡처 엔진.

   참가자는 로그인하지 않은 익명 사용자다. participant_token 이 인가이며,
   세션 row 는 리서처(613/623)가 이미 만들어 뒀다 — 이 훅은 세션을 새로
   만들지 않고 토큰-스코프 공개 엔드포인트만 호출한다:
     · POST /api/ut/public/[token]/publisher-token  → LiveKit publish 토큰
                                                       + status waiting→live
     · POST /api/ut/public/[token]/upload-url        → 서명 업로드 URL
     · POST /api/ut/public/[token]/finalize          → 전사 트리거

   흐름 (start):
     1. getUserMedia(mic) 먼저(게이트) → 승인돼야 getDisplayMedia(화면) 픽커.
        마이크 거부 시 화면 픽커도 안 뜨고 abort — 무녹음 데이터 손실 원천 차단(632).
     2. publisher-token → LiveKit room 에 화면+음성 트랙 **실시간 발행**
        (리서처 625 가 viewer 토큰으로 관전). 이게 로컬 방식 D 와의 핵심 차이.
     3. 대상 사이트를 자기 브라우저 새 탭으로 오픈 (로그인/결제 네이티브).
     4. MediaRecorder(화면+음성) 병행 녹화 — 종료 시 613 서명 URL 로 업로드,
        finalize 가 전사. (Egress 는 공개 API 로 노출 안 됨 → 클라 업로드 경로.)

   종료(stop): LiveKit 발행 중단·disconnect → 레코더 정지 → blob 업로드 →
   finalize. 미지원/거부는 graceful — NotAllowed/Abort 는 조용히 consent 복귀.

   ⚠ 프라이버시: 화면 녹화는 로그인/결제 화면을 담을 수 있다. 동의 게이트는
   호출부(participant-capture)가 소유하고, start() 는 동의 후에만 호출된다.
   업로드 객체는 리서처(owner) prefix 의 private 버킷에 저장된다(613).

   mime 폴백 / teardown / 폴링 로직은 검증된 use-ut-session(로컬 방식 D)을
   미러한다.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Room,
  LocalVideoTrack,
  LocalAudioTrack,
  Track,
  type LocalTrack,
} from 'livekit-client';
import { createClient } from '@/lib/supabase/client';

export type UtParticipantPhase =
  | 'consent' // 동의/시작 전 — 호출부가 게이트를 그림
  | 'starting' // 권한·토큰·연결 중
  | 'live' // 발행 중
  | 'ending' // 업로드/전사 마무리
  | 'ended' // 완료(감사)
  | 'error';

// MediaRecorder 는 트랜스코딩을 못 하므로 다운로드/저장 포맷 = 캡처 포맷.
// 재생 호환성 높은 mp4/m4a 를 먼저 시도, 미지원 엔진만 webm 폴백.
type Picked = { mime: string; ext: 'mp4' | 'm4a' | 'webm' };

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

type Blobs = { audio: Blob | null; recording: Blob | null };

const POLL_TRIES = 6;
const POLL_INTERVAL_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type UseUtParticipantSession = {
  phase: UtParticipantPhase;
  elapsedMs: number;
  error: string | null;
  isSupported: boolean;
  /** 라이브 화면 프리뷰 <video> 에 스트림을 붙이는 ref 콜백. */
  attachPreview: (el: HTMLVideoElement | null) => void;
  /** 대상 사이트를 (다시) 새 탭으로 오픈 — 자기 브라우저 네이티브 사용. */
  openTarget: () => void;
  start: () => Promise<void>;
  stop: () => void;
  /** error 후 consent 로 복귀해 재시도. */
  reset: () => void;
};

export function useUtParticipantSession(opts: {
  token: string;
  targetUrl: string | null;
}): UseUtParticipantSession {
  const { token, targetUrl } = opts;

  const [phase, setPhase] = useState<UtParticipantPhase>('consent');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);

  // 유저-facing 문자열은 messages(UtParticipant). 흐름 함수가 stable 하도록
  // t 도 ref 로 읽는다.
  const t = useTranslations('UtParticipant');
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const phaseRef = useRef<UtParticipantPhase>('consent');
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
  const pendingStopRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  // LiveKit 실시간 발행 — 로컬 방식 D 에 없는 참가자 전용 경로.
  const roomRef = useRef<Room | null>(null);
  const publishedTracksRef = useRef<LocalTrack[]>([]);

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

  // LiveKit 발행 정리 — 언퍼블리시 후 disconnect. 트랙 stop 은 teardownStreams
  // 가 담당하므로 여기서는 stopOnUnpublish=false.
  const teardownLiveKit = useCallback(() => {
    const room = roomRef.current;
    if (room) {
      for (const trk of publishedTracksRef.current) {
        try {
          void room.localParticipant.unpublishTrack(trk, false);
        } catch {
          // best-effort
        }
      }
      // stopTracks=false — 원본 MediaStreamTrack 은 teardownStreams 가 소유한다.
      // 여기서 멈추면 stop() 직후 아직 flush 안 된 MediaRecorder 의 소스가 끊겨
      // 녹화 끝부분이 잘린다(발행 중단은 unpublish 로 이미 끝남).
      void room.disconnect(false);
      roomRef.current = null;
    }
    publishedTracksRef.current = [];
  }, []);

  // 모든 스트림/레코더 하드 teardown — 언마운트 / reset / 실패 경로 공용.
  const teardownStreams = useCallback(() => {
    screenRecorderRef.current = null;
    audioRecorderRef.current = null;
    screenStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    micStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    screenStreamRef.current = null;
    micStreamRef.current = null;
    if (videoElRef.current) videoElRef.current.srcObject = null;
  }, []);

  // 언마운트 시 라이브 세션이 남지 않게 정리.
  useEffect(
    () => () => {
      clearTimer();
      teardownLiveKit();
      teardownStreams();
    },
    [clearTimer, teardownLiveKit, teardownStreams],
  );

  const attachPreview = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el;
    if (el && screenStreamRef.current) {
      el.srcObject = screenStreamRef.current;
    }
  }, []);

  const openTarget = useCallback(() => {
    if (targetUrl) window.open(targetUrl, '_blank', 'noopener,noreferrer');
  }, [targetUrl]);

  // 서명 업로드 URL 발급(613 공개 엔드포인트, 토큰이 인가) → 익명 supabase 브라우저
  // 클라로 스토리지에 직접 업로드(DB 엔 key 만). uploadToSignedUrl 은 Blob 을
  // multipart 로 감싸 서명 URL 에 올리므로 인증 세션이 없어도 토큰으로 통과 —
  // 로컬 방식 D(use-ut-session)의 uploadOne 을 그대로 미러(공개 경로만 차이).
  const uploadOne = useCallback(
    async (
      kind: 'audio' | 'recording',
      blob: Blob,
      supabase: ReturnType<typeof createClient>,
    ) => {
      const ext = kind === 'audio' ? audioExtRef.current : videoExtRef.current;
      const res = await fetch(
        `/api/ut/public/${encodeURIComponent(token)}/upload-url`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind, ext }),
        },
      );
      if (!res.ok) throw new Error(`upload_url_${kind}_${res.status}`);
      const { storage_key, token: uploadToken, bucket } = (await res.json()) as {
        storage_key: string;
        upload_url: string;
        token: string;
        bucket: string;
      };
      // codecs 파라미터를 뺀 base MIME 으로 저장(video/mp4, audio/mp4).
      const contentType = (blob.type || '').split(';')[0] || undefined;
      const { error: upErr } = await supabase.storage
        .from(bucket)
        .uploadToSignedUrl(storage_key, uploadToken, blob, { contentType });
      if (upErr) throw new Error(`upload_${kind}: ${upErr.message}`);
    },
    [token],
  );

  // finalize 는 전사를 동기 실행하므로 첫 폴링에 대개 done/error 로 해소된다.
  // 참가자에겐 결과물을 보여주지 않으므로 폴링은 best-effort — 실패해도 'ended'.
  const pollBriefly = useCallback(async () => {
    for (let i = 0; i < POLL_TRIES; i++) {
      try {
        const res = await fetch(
          `/api/ut/public/${encodeURIComponent(token)}`,
          { cache: 'no-store' },
        );
        if (res.ok) {
          const { session } = (await res.json()) as {
            session?: { status?: string };
          };
          const s = session?.status;
          if (s === 'done' || s === 'error') return;
        }
      } catch {
        // 무시 — 다음 시도.
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }, [token]);

  // 업로드 → finalize(전사 트리거) → 짧은 폴링 → ended. blobsRef 로 최신 값.
  const handleUploadAndFinalize = useCallback(async () => {
    const blobs = blobsRef.current;
    setError(null);
    setPhase('ending');

    if (blobs) {
      const supabase = createClient();
      try {
        // 오디오가 있어야 전사가 된다 — 먼저 올린다. 화면녹화는 리뷰용.
        if (blobs.audio && blobs.audio.size > 0) {
          await uploadOne('audio', blobs.audio, supabase);
        }
        if (blobs.recording && blobs.recording.size > 0) {
          await uploadOne('recording', blobs.recording, supabase);
        }
      } catch {
        // 업로드 실패라도 세션은 종료 — 참가자에게 재시도를 강요하지 않는다.
        // (라이브 발행은 이미 리서처가 관전했다.)
      }
    }

    const durationMs = startedAtRef.current
      ? Date.now() - startedAtRef.current
      : undefined;
    try {
      await fetch(`/api/ut/public/${encodeURIComponent(token)}/finalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(durationMs != null ? { duration_ms: durationMs } : {}),
      });
    } catch {
      // finalize 실패여도 아래 폴링/종료로 마무리.
    }
    await pollBriefly();
    setPhase('ended');
  }, [uploadOne, pollBriefly, token]);

  // 두 레코더의 onstop 이 각각 호출 — 마지막 하나가 끝나면 업로드 개시.
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
    setPhase('ending');
    // 실시간 발행부터 중단 — 종료 클릭 즉시 리서처 화면이 멈춘다.
    teardownLiveKit();

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
  }, [clearTimer, handleUploadAndFinalize, teardownLiveKit, teardownStreams]);

  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  // 권한/미디어 실패 → 사용자 친화 안내. NotAllowed/Abort(거부/취소)는 조용히
  // consent 복귀(사용자가 공유 다이얼로그를 닫은 정상 흐름), 그 외는 error.
  const handleMediaError = useCallback((e: unknown, which: 'screen' | 'mic') => {
    const name = e instanceof DOMException ? e.name : '';
    if (name === 'NotAllowedError' || name === 'AbortError') {
      setPhase('consent');
      setError(null);
      return;
    }
    setError(tRef.current(which === 'screen' ? 'error.screen' : 'error.mic'));
    setPhase('error');
  }, []);

  const start = useCallback(async () => {
    if (phaseRef.current !== 'consent' && phaseRef.current !== 'error') return;
    setError(null);
    setPhase('starting');

    // 1) 마이크 먼저 — 이게 진짜 게이트다. 참가자가 마이크를 거부/무시한 채
    //    화면만 고르면 세션이 live 로 못 가 무녹음 데이터 손실이 나던 버그(632)를
    //    막기 위해, 마이크 승인을 화면공유 픽커보다 앞세운다. 거부하면 화면 픽커
    //    자체를 안 띄우고 즉시 abort.
    //    STT 튜닝: think-aloud 단일화자라 mono(채널1)면 충분·전사 안정적.
    //    autoGainControl 은 off — think-aloud 는 발화 사이 무음 구간이 길어 AGC 가
    //    무음에서 게인을 끌어올렸다가 발화 시작에 급강하하는 펌핑을 만들고, 이게
    //    STT 에 "또렷하지 않은" 레벨 출렁임으로 들어간다(사용자 보고와 일치).
    //    echoCancellation/noiseSuppression 은 단일화자 환경 잡음 억제에 무난해 유지.
    //    (트레이드오프: 마이크가 아주 멀어 입력이 과도하게 작은 참가자는 AGC on 이
    //    나을 수 있으나, 데스크 마이크/헤드셋 기본 거리에서는 off 가 STT 에 유리.)
    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: 1 },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
      });
    } catch (e) {
      handleMediaError(e, 'mic');
      return;
    }

    // 2) 화면 공유 — 마이크가 승인된 뒤에만 픽커를 띄운다. 취소하면 이미 잡은
    //    마이크 트랙을 정리(누수 방지)하고 조용히 종료.
    let screen: MediaStream;
    try {
      screen = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
      });
    } catch (e) {
      mic.getTracks().forEach((tr) => tr.stop());
      handleMediaError(e, 'screen');
      return;
    }

    // 3) publisher-token — LiveKit publish JWT + status waiting→live(join stamp).
    let livekit: { url: string; token: string; room: string };
    try {
      const res = await fetch(
        `/api/ut/public/${encodeURIComponent(token)}/publisher-token`,
        { method: 'POST' },
      );
      if (res.status === 410) {
        screen.getTracks().forEach((tr) => tr.stop());
        mic.getTracks().forEach((tr) => tr.stop());
        setError(tRef.current('error.ended'));
        setPhase('error');
        return;
      }
      if (!res.ok) throw new Error(`publisher_token_${res.status}`);
      livekit = ((await res.json()) as { livekit: typeof livekit }).livekit;
    } catch {
      screen.getTracks().forEach((tr) => tr.stop());
      mic.getTracks().forEach((tr) => tr.stop());
      setError(tRef.current('error.join'));
      setPhase('error');
      return;
    }

    // 4) LiveKit room 연결 + 화면/음성 트랙 실시간 발행(리서처 625 가 관전).
    try {
      const room = new Room({ adaptiveStream: true, dynacast: true });
      await room.connect(livekit.url, livekit.token);
      roomRef.current = room;

      const screenTrack = screen.getVideoTracks()[0];
      const micTrack = mic.getAudioTracks()[0];
      const published: LocalTrack[] = [];
      if (screenTrack) {
        // userProvidedTrack=true — 트랙 lifecycle 은 이 훅이 소유(레코더도 공유).
        const v = new LocalVideoTrack(screenTrack, undefined, true);
        await room.localParticipant.publishTrack(v, {
          name: 'screen',
          source: Track.Source.ScreenShare,
          stream: 'participant',
        });
        published.push(v);
      }
      if (micTrack) {
        const a = new LocalAudioTrack(micTrack, undefined, true);
        await room.localParticipant.publishTrack(a, {
          name: 'mic',
          source: Track.Source.Microphone,
          stream: 'participant',
        });
        published.push(a);
      }
      publishedTracksRef.current = published;
    } catch {
      teardownLiveKit();
      screen.getTracks().forEach((tr) => tr.stop());
      mic.getTracks().forEach((tr) => tr.stop());
      setError(tRef.current('error.join'));
      setPhase('error');
      return;
    }

    // 5) 대상 사이트를 유저 자기 브라우저 새 탭으로 — 로그인/결제 네이티브.
    if (targetUrl) window.open(targetUrl, '_blank', 'noopener,noreferrer');

    // 6) MediaRecorder 병행 녹화(613 업로드/전사용). mime 폴백 = 방식 D 패턴.
    screenStreamRef.current = screen;
    micStreamRef.current = mic;
    if (videoElRef.current) videoElRef.current.srcObject = screen;

    const video = pickVideo();
    videoMimeRef.current = video.mime || 'video/webm';
    videoExtRef.current = video.ext;
    const micAudioTrack = mic.getAudioTracks()[0];
    const combinedStream = new MediaStream(
      [...screen.getVideoTracks(), micAudioTrack].filter(
        (tr): tr is MediaStreamTrack => Boolean(tr),
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

    // 유저가 브라우저 크롬의 "공유 중지"를 누르면 화면 트랙 ended → 세션 종료.
    screen.getVideoTracks().forEach((tr) => {
      tr.addEventListener('ended', () => stopRef.current());
    });

    screenRecorder.start();
    audioRecorder.start();
    screenRecorderRef.current = screenRecorder;
    audioRecorderRef.current = audioRecorder;

    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setPhase('live');
    clearTimer();
    timerRef.current = setInterval(() => {
      if (startedAtRef.current) setElapsedMs(Date.now() - startedAtRef.current);
    }, 1000);
  }, [clearTimer, handleMediaError, onRecorderStopped, targetUrl, teardownLiveKit, token]);

  const reset = useCallback(() => {
    clearTimer();
    teardownLiveKit();
    teardownStreams();
    blobsRef.current = null;
    startedAtRef.current = null;
    pendingStopRef.current = 0;
    setElapsedMs(0);
    setError(null);
    setPhase('consent');
  }, [clearTimer, teardownLiveKit, teardownStreams]);

  return {
    phase,
    elapsedMs,
    error,
    isSupported,
    attachPreview,
    openTarget,
    start,
    stop,
    reset,
  };
}

'use client';

/* ────────────────────────────────────────────────────────────────────
   useUtRemoteSession — AI UT 리서처 오케스트레이션/모니터 엔진 (원격 모드).

   기존 useUtSession(로컬 self-capture, 613·614) 과 별개의 훅. 리서처가:
     1. 과제(task_goal) + 대상 URL(선택) + session_kind 로 원격 세션 생성
        (POST /api/ut/sessions {mode:'remote'}) → participant_url 발급.
     2. 참가자에게 링크 공유(복사) → 참가자(624)가 자기 브라우저에서 화면을
        LiveKit room 으로 publish.
     3. 리서처는 viewer-token(subscribe-only)으로 같은 room 에 join 해
        참가자 화면을 라이브 관전. (translate-viewer 의 Room subscribe 패턴 이식.)
     4. 참가자가 세션을 끝내면(참가자 페이지가 finalize → status uploading→
        transcribing→done) 리서처는 사후 리뷰(녹화·전사 다운로드)로 넘어간다.

   상태 walk: idle → creating → waiting(링크 발급, 참가자 대기) →
             live(참가자 화면 수신 중) → review(참가자 종료 후 결과) | error.

   ⚠ 권한: viewer-token 은 subscribe-only — 리서처는 참가자 세션에 발행 불가.
   ⚠ 라이브 스트림은 카드(항상 마운트) 에 사는 훅이 Room 을 소유하므로 전체보기
      portal open/close 를 가로질러 살아남는다. <video> 부착은 현재 보이는
      단일 표면에만(attachMonitor) — 로컬 프리뷰와 동형.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type RemoteVideoTrack,
  type RemoteAudioTrack,
} from 'livekit-client';
import { fetchWithAuth } from '@/lib/api/fetch-with-auth';
import { normalizeTargetUrl } from './use-ut-session';
import type { UtSessionResult } from './use-ut-session';

export type UtRemotePhase =
  | 'idle'
  | 'creating'
  | 'waiting'
  | 'live'
  | 'review'
  | 'error';

export type UtSessionKind = 'moderated' | 'unmoderated';

export type CreateRemoteOpts = {
  taskGoal: string;
  rawTargetUrl: string;
  sessionKind: UtSessionKind;
};

// 참가자 종료 후 리뷰가 폴링해 읽어오는 세션 표면. status 가 이 집합에 들면
// 참가자가 세션을 끝낸 것 → 리뷰로 전환.
const REVIEW_STATUSES = new Set(['uploading', 'transcribing', 'done', 'error']);
const TERMINAL_STATUSES = new Set(['done', 'error']);
const POLL_INTERVAL_MS = 4000;

export type UseUtRemoteSession = {
  phase: UtRemotePhase;
  sessionId: string | null;
  participantUrl: string | null;
  sessionKind: UtSessionKind;
  error: string | null;
  /** 참가자 트랙(비디오) 수신 여부 — waiting 중 프리뷰 placeholder 분기. */
  hasParticipantVideo: boolean;
  /** 리뷰 표면이 읽어온 세션 결과(전사·다운로드 존재 여부). */
  result: UtSessionResult | null;
  /** 리뷰 원본 status (done/error/uploading/transcribing/live/waiting). */
  reviewStatus: string | null;
  /** 라이브 관전 <video> 에 참가자 화면을 붙이는 ref 콜백. */
  attachMonitor: (el: HTMLVideoElement | null) => void;
  create: (opts: CreateRemoteOpts) => Promise<void>;
  /** 관전 종료 — Room 을 끊고 리뷰로 이동(참가자 종료를 폴링으로 대기). */
  stopMonitoring: () => void;
  refreshReview: () => void;
  reset: () => void;
  download: (kind: 'recording' | 'audio') => Promise<void>;
  downloadTranscript: () => void;
};

export function useUtRemoteSession(): UseUtRemoteSession {
  const [phase, setPhase] = useState<UtRemotePhase>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [participantUrl, setParticipantUrl] = useState<string | null>(null);
  const [sessionKind, setSessionKind] = useState<UtSessionKind>('moderated');
  const [error, setError] = useState<string | null>(null);
  const [hasParticipantVideo, setHasParticipantVideo] = useState(false);
  const [result, setResult] = useState<UtSessionResult | null>(null);
  const [reviewStatus, setReviewStatus] = useState<string | null>(null);

  const t = useTranslations('AiUt');
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const phaseRef = useRef<UtRemotePhase>('idle');
  const sessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const roomRef = useRef<Room | null>(null);
  const videoTrackRef = useRef<RemoteVideoTrack | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const monitorElRef = useRef<HTMLVideoElement | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Room 하드 teardown — detach 트랙 + audio element 제거 + disconnect.
  const disconnectRoom = useCallback(() => {
    const room = roomRef.current;
    videoTrackRef.current?.detach().forEach((el) => {
      // <video> 는 body 소유(위젯 렌더) — srcObject 만 비우고 remove 안 함.
      if (el instanceof HTMLVideoElement) el.srcObject = null;
    });
    videoTrackRef.current = null;
    if (audioElRef.current) {
      try {
        audioElRef.current.remove();
      } catch {
        // ignore
      }
      audioElRef.current = null;
    }
    if (room) {
      void room.disconnect();
      roomRef.current = null;
    }
  }, []);

  // 언마운트 시 정리 — 라이브 Room / 폴링 타이머가 남지 않게.
  useEffect(
    () => () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      disconnectRoom();
    },
    [disconnectRoom],
  );

  // 현재 보이는 표면(card/fullview)의 <video> 에 참가자 트랙을 붙인다. 단일
  // 인스턴스 — 로컬 프리뷰의 attachPreview 와 동형.
  const attachMonitor = useCallback((el: HTMLVideoElement | null) => {
    monitorElRef.current = el;
    const track = videoTrackRef.current;
    if (!track || !el) return;
    // 단일 sink 보장 — 표면 전환(card↔fullview) 시 이전 표면 element 에서
    // 떼고 현재에 붙인다. null 콜백(언마운트)에서는 detach 하지 않아 mount/
    // unmount 콜백 순서와 무관하게 항상 보이는 표면에 트랙이 남는다.
    track.detach();
    track.attach(el);
  }, []);

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

  // viewer-token(subscribe-only) 발급 → Room join. 참가자 비디오 트랙이 오면
  // live 로 전환하고 현재 표면 <video> 에 부착. translate-viewer 패턴 이식 —
  // 이 effect 는 sessionId 가 바뀔 때만 재실행(런타임 이벤트로 재구성 금지).
  const connectViewer = useCallback(
    async (id: string) => {
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      const onTrackSubscribed = (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Video) {
          videoTrackRef.current = track as RemoteVideoTrack;
          if (monitorElRef.current) track.attach(monitorElRef.current);
          setHasParticipantVideo(true);
          // 참가자가 화면을 발행 = 라이브 시작.
          if (phaseRef.current === 'waiting') setPhase('live');
        } else if (track.kind === Track.Kind.Audio) {
          // 참가자 발화 실시간 모니터(선택) — 숨긴 <audio> 로 재생.
          const el = (track as RemoteAudioTrack).attach() as HTMLAudioElement;
          el.style.position = 'fixed';
          el.style.left = '-9999px';
          el.style.width = '1px';
          el.style.height = '1px';
          document.body.appendChild(el);
          audioElRef.current = el;
          el.play().catch(() => {});
        }
      };

      const onTrackUnsubscribed = (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Video) {
          setHasParticipantVideo(false);
        }
      };

      room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);

      try {
        const res = await fetchWithAuth(
          `/api/ut/sessions/${id}/viewer-token`,
          { method: 'POST' },
        );
        const json = (await res.json()) as
          | { livekit: { url: string; token: string } }
          | { error: string };
        if ('error' in json) throw new Error(json.error);
        await room.connect(json.livekit.url, json.livekit.token);
      } catch {
        // 라이브 관전 연결 실패 — 세션 자체는 살아 있으니 waiting 유지하고
        // 참가자 종료 시 리뷰로 폴링 전환된다(관전만 불가).
        setError(tRef.current('remote.error.monitor'));
      }
    },
    [],
  );

  // 세션 status 폴링 — 참가자가 세션을 끝내면(uploading→…→done) 리뷰로 전환.
  // waiting/live/review 동안만 돈다. done/error 에 도달하면 멈춘다.
  useEffect(() => {
    const id = sessionId;
    if (!id) return;
    if (phase === 'idle' || phase === 'creating' || phase === 'error') return;

    let alive = true;
    const tick = async () => {
      const s = await fetchSession(id);
      if (!alive) return;
      if (s) {
        setResult(s);
        setReviewStatus(s.status);
        if (REVIEW_STATUSES.has(s.status) && phaseRef.current !== 'review') {
          // 참가자가 세션을 끝냈다 — 관전 Room 을 끊고 리뷰로.
          disconnectRoom();
          setPhase('review');
        }
        if (TERMINAL_STATUSES.has(s.status)) return; // 폴링 종료
      }
      if (alive) pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
    };
    pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      alive = false;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [sessionId, phase, fetchSession, disconnectRoom]);

  const create = useCallback(
    async (opts: CreateRemoteOpts) => {
      if (phaseRef.current !== 'idle') return;
      const taskGoal = opts.taskGoal.trim();
      if (!taskGoal) return;
      setError(null);
      setResult(null);
      setReviewStatus(null);
      setHasParticipantVideo(false);
      setSessionKind(opts.sessionKind);
      setPhase('creating');

      const targetUrl = normalizeTargetUrl(opts.rawTargetUrl);
      let created: {
        id: string;
        participant_url: string;
      };
      try {
        const res = await fetchWithAuth('/api/ut/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mode: 'remote',
            task_goal: taskGoal,
            session_kind: opts.sessionKind,
            ...(targetUrl ? { target_url: targetUrl } : {}),
          }),
        });
        if (res.status === 503) {
          // LiveKit env 미구성 — 원격 비활성 안내.
          setError(tRef.current('remote.error.unavailable'));
          setPhase('error');
          return;
        }
        if (!res.ok) throw new Error(`create_${res.status}`);
        created = (await res.json()) as {
          id: string;
          participant_url: string;
        };
      } catch {
        setError(tRef.current('remote.error.create'));
        setPhase('error');
        return;
      }

      sessionIdRef.current = created.id;
      setSessionId(created.id);
      setParticipantUrl(created.participant_url);
      setPhase('waiting');
      // 라이브 관전은 moderated 전용이다. unmoderated 는 참여자가 혼자
      // 진행하고 리서처는 사후 리뷰만 하므로, LiveKit room 에 join 하지 않는다
      // (라이브 pane 없음, phase 가 'live' 로 걷지 않음). 진행 상태(대기→진행중
      // →리뷰)는 status 폴링이 reviewStatus 로 구동한다.
      if (opts.sessionKind === 'moderated') void connectViewer(created.id);
    },
    [connectViewer],
  );

  const stopMonitoring = useCallback(() => {
    if (phaseRef.current !== 'live' && phaseRef.current !== 'waiting') return;
    disconnectRoom();
    setPhase('review');
  }, [disconnectRoom]);

  const refreshReview = useCallback(() => {
    const id = sessionIdRef.current;
    if (!id) return;
    void fetchSession(id).then((s) => {
      if (s) {
        setResult(s);
        setReviewStatus(s.status);
      }
    });
  }, [fetchSession]);

  const reset = useCallback(() => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    disconnectRoom();
    sessionIdRef.current = null;
    setSessionId(null);
    setParticipantUrl(null);
    setError(null);
    setResult(null);
    setReviewStatus(null);
    setHasParticipantVideo(false);
    setPhase('idle');
  }, [disconnectRoom]);

  // 소유자 서명 다운로드 URL(613) → 새 탭. 원격 녹화도 소유자(리서처) prefix 에
  // 저장되므로 로컬과 동일 경로.
  const download = useCallback(async (kind: 'recording' | 'audio') => {
    const id = sessionIdRef.current;
    if (!id) return;
    try {
      const res = await fetchWithAuth(
        `/api/ut/sessions/${id}/download?kind=${kind}`,
      );
      if (!res.ok) {
        setError(tRef.current('error.downloadLink'));
        return;
      }
      const { url } = (await res.json()) as { url: string };
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setError(tRef.current('error.download'));
    }
  }, []);

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
    participantUrl,
    sessionKind,
    error,
    hasParticipantVideo,
    result,
    reviewStatus,
    attachMonitor,
    create,
    stopMonitoring,
    refreshReview,
    reset,
    download,
    downloadTranscript,
  };
}

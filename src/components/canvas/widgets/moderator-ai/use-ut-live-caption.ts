'use client';

/* ────────────────────────────────────────────────────────────────────
   useUtLiveCaption — 모더레이티드 라이브 관전(634) 중 참여자 발화 실시간 자막.

   리서처는 use-ut-remote-session 에서 이미 참여자 mic 트랙(RemoteAudioTrack)을
   viewer-token 으로 구독해 숨긴 <audio> 로 재생 중이다. 이 훅은 그 트랙을
   **clone(tee)** 해서 OpenAI Realtime 스트리밍 STT 세션에 물리고, delta/completed
   이벤트를 롤링 캡션 라인으로 뽑는다. 재생용 <audio> 는 원본 트랙이 그대로
   소유하므로 재생과 STT 가 서로 간섭하지 않는다.

   설계는 use-realtime-transcription(probing/translate)의 WebRTC 흐름을 따르되:
     - 자체 캡처(getUserMedia/getDisplayMedia) 없음 — 이미 구독한 트랙 주입.
     - 크레딧/녹음/DB row 없음 — 라이브 캡션은 표시용/휘발성 보조(스펙 §3).
       권위 전사는 여전히 사후 Scribe(633).
     - client_secret 은 /api/ut/sessions/[id]/caption-token 이 발급(언어 힌트 =
       session.input_language, 크레딧 미차감).

   graceful: 어떤 실패(토큰 발급·SDP·ICE·미지원)든 status='error' 로만 표면화하고
   throw 하지 않는다 — 캡션만 숨고 화면 관전/사운드는 영향 0.

   teardown: stop() 이 PC/DC close + clone 트랙 stop + renewal 타이머 해제. 관전
   종료(disconnectRoom)·언마운트가 stop() 을 호출해 유휴 STT 과금/누수를 막는다.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWithAuth } from '@/lib/api/fetch-with-auth';

export type UtLiveCaptionStatus = 'idle' | 'connecting' | 'live' | 'error';

export type UtCaptionLine = {
  // OpenAI item_id (또는 fallback) — delta 갱신 시 같은 라인 upsert.
  id: string;
  text: string;
  // server_vad 의 `*.completed` 로 확정된 라인(final) vs 진행 중 interim.
  final: boolean;
  // ms epoch — 최초 등장 시각(정렬/표시용).
  at: number;
};

export type UseUtLiveCaption = {
  status: UtLiveCaptionStatus;
  /** 롤링 캡션 라인(오래된 것부터, capped). */
  lines: UtCaptionLine[];
  /** 구독 오디오 트랙을 STT 에 tee — clone 후 세션 시작. 재호출은 무시(가드). */
  start: (track: MediaStreamTrack, sessionId: string) => void;
  /** STT 세션 teardown — 관전 종료/언마운트에서 호출. */
  stop: () => void;
};

const REALTIME_SDP_URL = 'https://api.openai.com/v1/realtime/calls';
const STUN_URLS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
];
// 라이브 관전 캡션은 최근 발화만 보이면 충분 — 롤링 cap. 초과 시 오래된 라인 drop.
const LINE_CAP = 120;
// OpenAI transcription 세션 ~30분 hard cap 전(25분)에 새 PC 로 swap — 긴 모더
// 세션에서 캡션이 끊기지 않게. use-realtime-transcription 의 renewal 과 동수치.
const SESSION_MAX_MS = 25 * 60 * 1000;
const RENEW_CHECK_INTERVAL_MS = 10_000;
// 25분 PC swap 시 옛 PC 를 잠깐 유지해 마지막 세그먼트의 `*.completed` 를 받는다.
// VAD silence 창이 작아(~500ms) swap 경계 세그먼트가 금방 commit 되므로 2초면 충분.
const RENEW_OLD_PC_GRACE_MS = 2000;
// capture(사용자 조작) 구간이 없으므로 토큰 발급 직후 순수 네트워크 연결만 감시.
const CONNECT_TIMEOUT_MS = 10_000;

type OaiEvent = {
  type?: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
};

export function useUtLiveCaption(): UseUtLiveCaption {
  const [status, setStatus] = useState<UtLiveCaptionStatus>('idle');
  const [lines, setLines] = useState<UtCaptionLine[]>([]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  // STT 로 tee 한 clone 트랙 — 원본(재생용)과 독립. stop 시 이것만 멈춘다.
  const cloneTrackRef = useRef<MediaStreamTrack | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number>(0);
  const renewTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const renewInFlightRef = useRef(false);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 중복 start 가드 — setStatus 는 batched 라 closure 로 idle 을 볼 수 있어 ref 로 막음.
  const startInFlightRef = useRef(false);
  // delta cumulative/incremental 흡수용 — 라인별 마지막 텍스트.
  const lastTextRef = useRef<Map<string, string>>(new Map());
  const firstSeenRef = useRef<Map<string, number>>(new Map());

  const upsertLine = useCallback(
    (id: string, text: string, final: boolean) => {
      let at = firstSeenRef.current.get(id);
      if (at === undefined) {
        at = Date.now();
        firstSeenRef.current.set(id, at);
      }
      const seenAt = at;
      setLines((prev) => {
        const idx = prev.findIndex((l) => l.id === id);
        if (idx === -1) {
          const next = [...prev, { id, text, final, at: seenAt }];
          if (next.length > LINE_CAP) {
            const dropped = next.splice(0, next.length - LINE_CAP);
            for (const d of dropped) {
              lastTextRef.current.delete(d.id);
              firstSeenRef.current.delete(d.id);
            }
          }
          return next;
        }
        const copy = prev.slice();
        copy[idx] = { ...copy[idx], text, final };
        return copy;
      });
    },
    [],
  );

  const handleEvent = useCallback(
    (raw: string) => {
      let msg: OaiEvent;
      try {
        msg = JSON.parse(raw) as OaiEvent;
      } catch {
        return;
      }
      const type = msg.type ?? '';
      const itemId =
        typeof msg.item_id === 'string' && msg.item_id
          ? msg.item_id
          : `seg-${Date.now()}`;

      if (type === 'conversation.item.input_audio_transcription.delta') {
        const delta = typeof msg.delta === 'string' ? msg.delta : '';
        if (!delta) return;
        // delta 가 incremental 인지 cumulative 인지 모델/시점마다 달라 둘 다 흡수.
        const prev = lastTextRef.current.get(itemId) ?? '';
        let next: string;
        if (delta.startsWith(prev) && delta.length > prev.length) {
          next = delta;
        } else if (prev.startsWith(delta) && prev.length > delta.length) {
          next = prev; // 모델 backstep — 이전 유지.
        } else {
          next = prev + delta;
        }
        lastTextRef.current.set(itemId, next);
        upsertLine(itemId, next, false);
        return;
      }

      if (type === 'conversation.item.input_audio_transcription.completed') {
        const finalText =
          typeof msg.transcript === 'string'
            ? msg.transcript
            : lastTextRef.current.get(itemId) ?? '';
        if (!finalText.trim()) return;
        lastTextRef.current.set(itemId, finalText);
        upsertLine(itemId, finalText, true);
        return;
      }
    },
    [upsertLine],
  );

  // 순수 teardown — 모든 리소스 해제. status 는 호출자가 결정(stop=idle, 실패=error).
  const teardown = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    if (renewTimerRef.current) {
      clearInterval(renewTimerRef.current);
      renewTimerRef.current = null;
    }
    renewInFlightRef.current = false;
    startedAtRef.current = 0;
    const dc = dcRef.current;
    if (dc) {
      try {
        dc.close();
      } catch {
        /* already closed */
      }
      dcRef.current = null;
    }
    const pc = pcRef.current;
    if (pc) {
      try {
        pc.close();
      } catch {
        /* already closed */
      }
      pcRef.current = null;
    }
    // clone 트랙만 stop — 원본(재생용 <audio>)은 use-ut-remote-session 소유.
    const clone = cloneTrackRef.current;
    if (clone) {
      try {
        clone.stop();
      } catch {
        /* already stopped */
      }
      cloneTrackRef.current = null;
    }
    sessionIdRef.current = null;
    lastTextRef.current.clear();
    firstSeenRef.current.clear();
  }, []);

  // client_secret 발급 → 새 PC + DC + SDP 교환. renewal/최초 연결 공용.
  const connectPc = useCallback(
    async (
      clone: MediaStreamTrack,
      sessionId: string,
    ): Promise<RTCPeerConnection | null> => {
      let tokenValue: string;
      try {
        const res = await fetchWithAuth(
          `/api/ut/sessions/${sessionId}/caption-token`,
          { method: 'POST' },
        );
        const json = (await res.json().catch(() => ({}))) as {
          client_secret?: { value?: string };
          error?: string;
        };
        if (!res.ok || !json.client_secret?.value) {
          throw new Error(json.error ?? `caption_token_${res.status}`);
        }
        tokenValue = json.client_secret.value;
      } catch (e) {
        console.warn('[ut-caption] token fetch failed', e);
        return null;
      }

      const pc = new RTCPeerConnection({ iceServers: [{ urls: STUN_URLS }] });
      pc.addTrack(clone, new MediaStream([clone]));
      const dc = pc.createDataChannel('oai-events');
      dc.onmessage = (ev) => handleEvent(String(ev.data));
      dc.onerror = (ev) => console.warn('[ut-caption] dc error', ev);

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const sdpRes = await fetch(REALTIME_SDP_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenValue}`,
            'Content-Type': 'application/sdp',
          },
          body: offer.sdp ?? '',
        });
        if (!sdpRes.ok) {
          const body = await sdpRes.text().catch(() => '');
          console.warn('[ut-caption] sdp error', sdpRes.status, body.slice(0, 200));
          throw new Error(`openai_sdp_${sdpRes.status}`);
        }
        const answerSdp = await sdpRes.text();
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      } catch (e) {
        console.warn('[ut-caption] connect failed', e);
        try {
          pc.close();
        } catch {
          /* already closed */
        }
        return null;
      }
      // dc 는 pc 에 매달려 있으므로 여기선 pc 만 반환 — 호출자가 dcRef 관리.
      dcRef.current = dc;
      return pc;
    },
    [handleEvent],
  );

  // renewal — 25분 도달 시 새 PC 로 swap. clone 트랙은 재사용(재프롬프트 없음),
  // 옛 PC 는 grace 후 close(마지막 delta 수신). 실패해도 옛 PC 유지 → 다음 tick 재시도.
  const renew = useCallback(async () => {
    if (renewInFlightRef.current) return;
    const clone = cloneTrackRef.current;
    const sid = sessionIdRef.current;
    if (!clone || !sid || clone.readyState !== 'live') return;
    renewInFlightRef.current = true;
    try {
      const newPc = await connectPc(clone, sid);
      if (!newPc) return; // 실패 — 옛 PC 유지, 다음 tick 재시도.
      const oldPc = pcRef.current;
      pcRef.current = newPc;
      startedAtRef.current = Date.now();
      setTimeout(() => {
        try {
          oldPc?.close();
        } catch {
          /* already closed */
        }
      }, RENEW_OLD_PC_GRACE_MS);
    } finally {
      renewInFlightRef.current = false;
    }
  }, [connectPc]);

  const start = useCallback(
    (track: MediaStreamTrack, sessionId: string) => {
      if (startInFlightRef.current) return;
      if (pcRef.current) return; // 이미 세션 진행 중.
      startInFlightRef.current = true;
      setLines([]);
      lastTextRef.current.clear();
      firstSeenRef.current.clear();
      setStatus('connecting');

      // 원본 트랙을 clone(tee) — 재생용 <audio> 와 독립. clone 이 stop 돼도 원본은
      // 계속 재생된다.
      let clone: MediaStreamTrack;
      try {
        clone = track.clone();
      } catch (e) {
        console.warn('[ut-caption] track clone failed', e);
        setStatus('error');
        startInFlightRef.current = false;
        return;
      }
      cloneTrackRef.current = clone;
      sessionIdRef.current = sessionId;

      // connect watchdog — 토큰/SDP/ICE 가 이 안에 붙지 못하면 실패 처리(graceful).
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      let timedOut = false;
      watchdogRef.current = setTimeout(() => {
        watchdogRef.current = null;
        timedOut = true;
        console.warn('[ut-caption] connect timeout');
        teardown();
        setStatus('error');
      }, CONNECT_TIMEOUT_MS);

      void connectPc(clone, sessionId).then((pc) => {
        startInFlightRef.current = false;
        if (timedOut) {
          // watchdog 이 이미 접었다(teardown+error) — 뒤늦게 열린 pc/dc 정리.
          try {
            pc?.close();
          } catch {
            /* already closed */
          }
          dcRef.current = null;
          return;
        }
        if (watchdogRef.current) {
          clearTimeout(watchdogRef.current);
          watchdogRef.current = null;
        }
        if (!pc) {
          teardown();
          setStatus('error');
          return;
        }
        pcRef.current = pc;
        startedAtRef.current = Date.now();
        setStatus('live');
        // renewal 무장 — 25분 넘으면 swap. teardown 이 해제.
        if (!renewTimerRef.current) {
          renewTimerRef.current = setInterval(() => {
            if (startedAtRef.current === 0) return;
            if (Date.now() - startedAtRef.current >= SESSION_MAX_MS) {
              void renew();
            }
          }, RENEW_CHECK_INTERVAL_MS);
        }
      });
    },
    [connectPc, renew, teardown],
  );

  const stop = useCallback(() => {
    teardown();
    setLines([]);
    setStatus('idle');
  }, [teardown]);

  // 언마운트 시 누수 방지.
  useEffect(() => () => teardown(), [teardown]);

  return { status, lines, start, stop };
}

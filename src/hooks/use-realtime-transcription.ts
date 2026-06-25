'use client';

/* ────────────────────────────────────────────────────────────────────
   useRealtimeTranscription — OpenAI Realtime transcription with
   mic OR tab-audio capture.

   probing 위젯의 standalone 모드. translate-console 의존 없이 자체
   OpenAI Realtime transcription session 을 들고 transcript segments 를
   produce 한다.

   - capture: getUserMedia (mic) 또는 getDisplayMedia (tab) — start() 인자로
     선택. default 'mic' (PR-4 회귀 방지).
   - signalling: POST /api/probing/sessions (서버에서 client_secret 발급)
   - SDP exchange: https://api.openai.com/v1/realtime/calls
   - datachannel: `oai-events` 에서 `conversation.item.input_audio_*` 이벤트 수신

   탭 오디오 지원 (PR-5 / pr-probing-5-tab-audio):
   - raw passthrough — getDisplayMedia 의 트랙을 그대로 pc.addTrack. WebAudio
     resample 그래프 (translate-console PR #396 패턴) 는 transcription endpoint
     에서 dc 를 즉시 close 시키는 회귀 유발. PR #401 진단에서 확정.
   - SDP Opus mono hint — Chrome 의 createOffer SDP 에 `stereo=0;sprop-stereo=0`
     명시. Opus 기본값이 mono 라 no-op 에 가깝지만 보수적 안전망 (translation
     endpoint 와 달리 transcription pipeline 이 stereo 에 더 strict).
   - 10s connect watchdog — 'starting' 진입 시 setTimeout 으로 안전망,
     'live' 도달 시 clear. 만료되면 pc/dc 상태 dump + `probing_timeout` 에러.
   - ICE 보강 — STUN 2개 + signaling/ice 상태 변화 콘솔 로그.
   - tab VAD 안전망 — 휴지 없는 continuous 콘텐츠 (YouTube/스트리밍) 가
     OpenAI VAD 가 end-of-speech 를 못 잡고 transcript 가 stall 되는 걸 방지.
     3초마다 400ms 트랙 mute 로 강제 utterance 끊김 신호 (translate-console
     PR #396 패턴).

   탭 오디오 캡처 의미 (사용자 mental model):
   - tab audio = 그 탭에서 **재생되는** 소리만 캡처 (browser audio output).
   - 본인이 mic 으로 말한 건 echo cancellation 으로 본인 탭에서 재생되지 않음 →
     캡처되지 않음. 본인 발화 캡처는 mic 모드로.
   - Zoom 데스크탑 앱 윈도우 공유는 macOS Chrome 에서 audio 캡처 불가 (OS 제약).
     Zoom 웹클라이언트 (zoom.us/wc) 사용해야 다른 참가자 발언 캡처 가능.

   범위 밖: 화자 분리, 탭 vs 마이크 자동 detection. 동시 세션 (translate +
   probing) 은 각자 별도 capture 호출 — 사용자가 picker 두 번 선택.

   translate-console.tsx:807-1265 의 capture/WebRTC 흐름이 디자인 참조.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';

export type TranscriptionStatus =
  | 'idle'
  | 'starting'
  | 'live'
  | 'stopping'
  | 'error';

export type TranscriptionSource = 'mic' | 'tab';

// 위젯 consumer 가 그대로 쓰는 segment shape — realtime-transcript-provider 의
// TranscriptSegment 와 호환 (id/text/started_at/ended_at/locale). speaker
// 필드는 transcription session 에서 추론 불가라 생략.
export type TranscriptionSegment = {
  id: string;
  text: string;
  started_at: number;
  ended_at?: number;
  locale?: string;
};

export type StartOpts = { source?: TranscriptionSource };

export type UseRealtimeTranscriptionResult = {
  status: TranscriptionStatus;
  segments: TranscriptionSegment[];
  error: string | null;
  start: (opts?: StartOpts) => Promise<void>;
  stop: () => Promise<void>;
};

// Unified Realtime GA SDP endpoint. 이전 `/v1/realtime?intent=transcription`
// 은 Beta API shape 으로 deprecated (HTTP 400 beta_api_shape_disabled).
// 세션 type 은 client_secrets POST 의 `session.type` 으로 표현되므로 SDP
// 호출은 query param 없는 단일 path.
const REALTIME_SDP_URL = 'https://api.openai.com/v1/realtime/calls';

// translate-console PR #396 과 동일 — host 의 회사망에서 한 STUN 이 막혀도
// 다른 쪽으로 ICE 가 모이게 redundancy.
const STUN_URLS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
];

// 누적 segment cap. 60분 * ~15 utt/min ≈ 900. 1000 까지 허용 — 초과 시
// 가장 오래된 segment 부터 drop.
const SEGMENT_CAP = 1000;

// connect watchdog — 'starting' 진입 후 이 시간 안에 'live' 못 가면
// `probing_timeout`. translate-console PR #396 과 동일 수치.
const CONNECT_TIMEOUT_MS = 10_000;

// tab 모드 VAD 안전망 (3초마다 400ms 트랙 mute) — translate-console PR #396 패턴.
// 휴지 없는 continuous content (YouTube 등) 에서 OpenAI server_vad 가
// end-of-speech 를 못 잡아 utterance 가 commit 안 되는 문제 회피.
const TAB_SILENCE_INTERVAL_MS = 3000;
const TAB_SILENCE_DURATION_MS = 400;

type OaiEvent = {
  type?: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  [k: string]: unknown;
};

// transcription session 이 deltas/completed 이벤트에 같은 item_id 를
// 부여한다. fallback 으로 type-prefix + Date.now() 사용 — 같은 item_id 가
// 없으면 새 utterance 로 취급.
function eventToItemId(ev: OaiEvent, fallback: string): string {
  if (typeof ev.item_id === 'string' && ev.item_id) return ev.item_id;
  return fallback;
}

// SDP munge — Opus fmtp 라인에 `stereo=0; sprop-stereo=0` 강제. Opus 기본값이
// mono 라 Chrome 의 createOffer 가 보통 stereo= 파라미터를 명시 안 함 (= 기본
// mono). 이 munge 는 그 기본값을 명시적으로 못박는 보수적 안전망. tab 모드만
// 적용 (mic 는 native mono 트랙이라 회귀 위험 0). transcription endpoint 가
// stereo Opus 처리에 strict 한 케이스 (다른 OpenAI realtime model 보다) 대비.
function forceOpusMonoSdp(sdp: string): string {
  const lines = sdp.split('\r\n');
  let opusPt: string | null = null;
  for (const line of lines) {
    const m = /^a=rtpmap:(\d+)\s+opus\/48000/i.exec(line);
    if (m) {
      opusPt = m[1];
      break;
    }
  }
  if (!opusPt) return sdp;

  let fmtpSeen = false;
  const fmtpPrefix = `a=fmtp:${opusPt}`;
  const result = lines.map((line) => {
    if (line.startsWith(fmtpPrefix)) {
      fmtpSeen = true;
      const params = line
        .substring(fmtpPrefix.length)
        .trim()
        .split(';')
        .map((p) => p.trim())
        .filter(
          (p) =>
            p.length > 0 &&
            !p.startsWith('stereo=') &&
            !p.startsWith('sprop-stereo='),
        );
      params.push('stereo=0', 'sprop-stereo=0');
      return `${fmtpPrefix} ${params.join(';')}`;
    }
    return line;
  });

  if (fmtpSeen) return result.join('\r\n');

  // 보호: fmtp 라인이 없으면 rtpmap 직후에 새로 추가.
  const out: string[] = [];
  const rtpmapRe = new RegExp(`^a=rtpmap:${opusPt}\\s+opus`);
  for (const line of result) {
    out.push(line);
    if (rtpmapRe.test(line)) {
      out.push(`${fmtpPrefix} stereo=0;sprop-stereo=0`);
    }
  }
  return out.join('\r\n');
}

export function useRealtimeTranscription(opts?: {
  locale?: string;
}): UseRealtimeTranscriptionResult {
  const locale = opts?.locale ?? 'ko';
  const [status, setStatus] = useState<TranscriptionStatus>('idle');
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [error, setError] = useState<string | null>(null);

  // WebRTC / capture refs — close 안전을 위해 ref 로 보관.
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  // 원본 capture stream (mic 또는 raw tab). cleanup 시 트랙 stop 으로 Chrome
  // "탭 공유 중" 배너가 사라진다.
  const captureStreamRef = useRef<MediaStream | null>(null);
  // tab 모드 silence injection 타이머.
  const tabSilenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  // 10s connect watchdog.
  const connectWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // start() 중복 방지. setStatus('starting') 는 batched 라 같은 microtask
  // 안 두 번째 클릭은 closure 로 idle 을 본다 — ref 가 진짜 가드.
  const startInFlightRef = useRef(false);
  // 같은 item_id 가 delta 들 사이에서 일관되는 걸 가정한다. 새 utterance
  // 가 시작될 때 started_at 을 보관 (segment.started_at).
  const itemStartedAtRef = useRef<Map<string, number>>(new Map());
  // 누적 텍스트를 ref 에도 두는 이유: `*.delta` 가 incremental 인지
  // cumulative 인지 모델/시점에 따라 다른 사례가 있어 둘 다 흡수하기 위해
  // 마지막 본 텍스트를 기억해두고 새 delta 가 이전을 startsWith 하면
  // cumulative, 아니면 append 로 처리.
  const lastTextRef = useRef<Map<string, string>>(new Map());

  // cleanup — start 의 어느 단계에서 실패해도 안전하게 모든 리소스 해제.
  const cleanup = useCallback(() => {
    if (connectWatchdogRef.current) {
      clearTimeout(connectWatchdogRef.current);
      connectWatchdogRef.current = null;
    }
    if (tabSilenceTimerRef.current) {
      clearInterval(tabSilenceTimerRef.current);
      tabSilenceTimerRef.current = null;
    }
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
        pc.getSenders().forEach((s) => {
          try {
            s.track?.stop();
          } catch {
            /* track already stopped */
          }
        });
        pc.close();
      } catch {
        /* already closed */
      }
      pcRef.current = null;
    }
    const cap = captureStreamRef.current;
    if (cap) {
      cap.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* already stopped */
        }
      });
      captureStreamRef.current = null;
    }
    itemStartedAtRef.current.clear();
    lastTextRef.current.clear();
  }, []);

  const upsertSegment = useCallback(
    (id: string, text: string, completed: boolean, wall: number) => {
      let startedAt = itemStartedAtRef.current.get(id);
      if (startedAt === undefined) {
        startedAt = wall;
        itemStartedAtRef.current.set(id, startedAt);
      }
      const seg: TranscriptionSegment = {
        id,
        text,
        started_at: startedAt,
        ended_at: completed ? wall : undefined,
        locale,
      };
      setSegments((prev) => {
        const idx = prev.findIndex((s) => s.id === id);
        if (idx === -1) {
          const next = [...prev, seg];
          if (next.length > SEGMENT_CAP) {
            const dropped = next.splice(0, next.length - SEGMENT_CAP);
            for (const d of dropped) {
              itemStartedAtRef.current.delete(d.id);
              lastTextRef.current.delete(d.id);
            }
          }
          return next;
        }
        const copy = prev.slice();
        copy[idx] = { ...copy[idx], text, ended_at: seg.ended_at, locale };
        return copy;
      });
    },
    [locale],
  );

  const handleOaiEvent = useCallback(
    (raw: string) => {
      let msg: OaiEvent;
      try {
        msg = JSON.parse(raw) as OaiEvent;
      } catch {
        return;
      }
      const type = msg.type ?? '';
      // transcription session 이 emit 하는 핵심 이벤트:
      //  - `conversation.item.input_audio_transcription.delta` (incremental)
      //  - `conversation.item.input_audio_transcription.completed` (final)
      // 다른 (`response.*`, `session.*`) 이벤트는 transcription-only 세션
      // 에서 발생해도 위젯 표시에 의미가 없어 무시.
      const wall = Date.now();

      if (type === 'conversation.item.input_audio_transcription.delta') {
        const id = eventToItemId(msg, `seg-${wall}`);
        const delta = typeof msg.delta === 'string' ? msg.delta : '';
        if (!delta) return;
        // cumulative vs incremental 흡수. 같은 id 의 마지막 텍스트를 기억해
        // delta 가 prefix 이면 그대로 교체 (cumulative), 아니면 append.
        const prev = lastTextRef.current.get(id) ?? '';
        let next: string;
        if (delta.startsWith(prev) && delta.length > prev.length) {
          next = delta;
        } else if (prev.startsWith(delta) && prev.length > delta.length) {
          // 새 delta 가 prev 의 prefix — 모델이 backstep 한 케이스. prev 유지.
          next = prev;
        } else {
          next = prev + delta;
        }
        lastTextRef.current.set(id, next);
        upsertSegment(id, next, false, wall);
        return;
      }

      if (type === 'conversation.item.input_audio_transcription.completed') {
        const id = eventToItemId(msg, `seg-${wall}`);
        const finalText =
          typeof msg.transcript === 'string'
            ? msg.transcript
            : lastTextRef.current.get(id) ?? '';
        if (!finalText.trim()) return;
        lastTextRef.current.set(id, finalText);
        upsertSegment(id, finalText, true, wall);
        return;
      }
      // 진단성 — 알려지지 않은 이벤트는 첫 발견 시 한 번만 로깅 (전체
      // session 동안 콘솔이 터지지 않게). transcription session beta 가
      // event shape 을 갈아엎으면 여기서 단서가 잡힌다.
    },
    [upsertSegment],
  );

  const stop = useCallback(async () => {
    if (status === 'idle') return;
    setStatus('stopping');
    cleanup();
    setStatus('idle');
  }, [cleanup, status]);

  const start = useCallback(
    async (startOpts?: StartOpts) => {
      const source: TranscriptionSource = startOpts?.source ?? 'mic';

      if (startInFlightRef.current) return;
      if (status === 'live' || status === 'starting') return;
      startInFlightRef.current = true;
      setError(null);
      setSegments([]);
      itemStartedAtRef.current.clear();
      lastTextRef.current.clear();
      setStatus('starting');

      // Arm 10s connect watchdog. 어느 단계에서든 hang 이 나면 사용자가
      // "연결 중" 에 영원히 갇히지 않게 안전망. 성공 시 'live' 진입 직전에
      // clear, 실패 시 cleanup() 에서 자동 clear.
      if (connectWatchdogRef.current) clearTimeout(connectWatchdogRef.current);
      connectWatchdogRef.current = setTimeout(() => {
        connectWatchdogRef.current = null;
        const pc = pcRef.current;
        const dc = dcRef.current;
        console.warn('[probing] connect timeout', {
          source,
          pcConnection: pc?.connectionState ?? null,
          pcIce: pc?.iceConnectionState ?? null,
          pcSignaling: pc?.signalingState ?? null,
          pcGathering: pc?.iceGatheringState ?? null,
          dcReadyState: dc?.readyState ?? null,
        });
        setError('probing_timeout');
        setStatus('error');
        cleanup();
        startInFlightRef.current = false;
      }, CONNECT_TIMEOUT_MS);

      // 1) 서버 세션 — client_secret 발급
      let clientSecret: string;
      try {
        const res = await fetch('/api/probing/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const json = (await res.json().catch(() => ({}))) as {
          client_secret?: { value?: string };
          error?: string;
        };
        if (!res.ok || !json.client_secret?.value) {
          throw new Error(json.error ?? `session_failed_${res.status}`);
        }
        clientSecret = json.client_secret.value;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'session_failed');
        setStatus('error');
        cleanup();
        startInFlightRef.current = false;
        return;
      }

      // 2) capture — source 분기. tab 모드는 getDisplayMedia 의 트랙을 그대로
      // pc.addTrack (raw passthrough). WebAudio resample 그래프를 끼우면
      // transcription endpoint 가 dc 를 즉시 close (PR #401 진단으로 확정).
      let captureStream: MediaStream;
      try {
        if (source === 'tab') {
          // getDisplayMedia 는 모든 지원 브라우저에서 video 제약을 요구한다.
          // 가장 가벼운 surface (브라우저 탭) 를 요청하고 비디오 트랙은 즉시
          // stop — 우리는 화면이 아닌 오디오만 필요. `ideal` 제약 (not `exact`)
          // 으로 Chrome 의 OverconstrainedError 회피 + mono / 48 kHz hint 전달.
          const display = await navigator.mediaDevices.getDisplayMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              channelCount: { ideal: 1 },
              sampleRate: { ideal: 48000 },
            },
            video: { displaySurface: 'browser' },
          });
          display.getVideoTracks().forEach((tr) => tr.stop());
          const audioTracks = display.getAudioTracks();
          if (audioTracks.length === 0) {
            // picker 에서 surface 는 골랐지만 "탭 오디오 공유" 미체크.
            // Safari / 대부분 모바일도 같은 분기 (플랫폼 미지원). macOS Chrome
            // 의 window/screen surface 도 보통 여기 (네이티브 앱 audio 미캡처).
            display.getTracks().forEach((tr) => tr.stop());
            setError('tab_audio_unavailable');
            setStatus('error');
            cleanup();
            startInFlightRef.current = false;
            return;
          }
          captureStream = new MediaStream(audioTracks);
        } else {
          captureStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
        }
      } catch (e) {
        // NotAllowedError → 사용자가 picker / 권한 prompt 를 명시적으로
        // 취소. 그 외 DOMException 은 OS / 브라우저 레벨 capture 실패.
        const name = e instanceof DOMException ? e.name : '';
        console.warn('[probing] capture failed', { source, name, error: e });
        if (source === 'tab') {
          setError(name === 'NotAllowedError' ? 'tab_audio_denied' : 'tab_audio_failed');
        } else {
          setError(
            name === 'NotAllowedError' ? 'microphone_denied' : 'microphone_failed',
          );
        }
        setStatus('error');
        cleanup();
        startInFlightRef.current = false;
        return;
      }
      captureStreamRef.current = captureStream;

      // tab 모드 silence injection — 3초마다 400ms track.enabled=false 로
      // OpenAI server_vad 가 end-of-speech 를 잡아 utterance 를 commit 하게
      // 강제. YouTube / 스트리밍처럼 휴지 없는 continuous content 에서 transcript
      // 가 commit 안 되는 stall 회피 (translate-console PR #396 패턴).
      if (source === 'tab') {
        const track = captureStream.getAudioTracks()[0];
        if (track) {
          tabSilenceTimerRef.current = setInterval(() => {
            if (track.readyState !== 'live') return;
            track.enabled = false;
            setTimeout(() => {
              if (track.readyState === 'live') track.enabled = true;
            }, TAB_SILENCE_DURATION_MS);
          }, TAB_SILENCE_INTERVAL_MS);
        }
      }

      // 3) RTCPeerConnection + datachannel + SDP 교환
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: STUN_URLS }],
      });
      pc.oniceconnectionstatechange = () => {
        console.info('[probing] pc.iceConnectionState', pc.iceConnectionState);
      };
      pcRef.current = pc;
      captureStream
        .getAudioTracks()
        .forEach((tr) => pc.addTrack(tr, captureStream));

      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;
      dc.onerror = (ev) => {
        console.warn('[probing] dc error', ev);
      };
      dc.onmessage = (ev) => handleOaiEvent(String(ev.data));

      try {
        const offer = await pc.createOffer();
        // tab 모드만 Opus mono 강제. mic 는 native mono 라 munge 불필요 (회귀 방지).
        const offerSdp =
          source === 'tab' ? forceOpusMonoSdp(offer.sdp ?? '') : offer.sdp ?? '';
        await pc.setLocalDescription({ type: 'offer', sdp: offerSdp });
        const sdpRes = await fetch(REALTIME_SDP_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${clientSecret}`,
            'Content-Type': 'application/sdp',
          },
          body: offerSdp,
        });
        if (!sdpRes.ok) {
          const body = await sdpRes.text().catch(() => '');
          console.warn('[probing] sdp error', sdpRes.status, body.slice(0, 300));
          throw new Error(`openai_sdp_${sdpRes.status}`);
        }
        const answerSdp = await sdpRes.text();
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'webrtc_failed');
        setStatus('error');
        cleanup();
        startInFlightRef.current = false;
        return;
      }

      // 'live' 도달 — watchdog 해제.
      if (connectWatchdogRef.current) {
        clearTimeout(connectWatchdogRef.current);
        connectWatchdogRef.current = null;
      }
      setStatus('live');
      startInFlightRef.current = false;
    },
    [cleanup, handleOaiEvent, status],
  );

  // unmount 시 누수 방지. 세션이 살아 있으면 정리.
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return { status, segments, error, start, stop };
}

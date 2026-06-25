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
   - 24 kHz mono resample — Chrome 의 getDisplayMedia 가 sampleRate 힌트를
     무시하므로 AudioContext 로 강제 변환 (translate-console PR #396 패턴).
   - 10s connect watchdog — 'starting' 진입 시 setTimeout 으로 안전망,
     'live' 도달 시 clear. 만료되면 pc/dc 상태 dump + `probing_timeout` 에러.
   - ICE 보강 — STUN 2개 + signaling/ice 상태 변화 콘솔 로그.
   - tab VAD 안전망 — 탭 오디오는 자연스러운 휴지가 없어 OpenAI VAD 가
     end-of-speech 를 못 잡고 transcript 가 stall. 3초마다 400ms 트랙 mute
     해서 강제로 utterance 끊김 신호 (translate-console PR #396 패턴).

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

// tab 모드 VAD 안전망 — 3초마다 400ms 트랙 mute (translate-console PR #396 패턴).
const TAB_SILENCE_INTERVAL_MS = 3000;
const TAB_SILENCE_DURATION_MS = 400;

// WebAudio "lift" 그래프의 sample rate — Chrome 시스템 기본값 (48 kHz) 과
// 일치시켜 WebRTC Opus 가 추가 resample 없이 인코딩하게 한다. 24 kHz 로
// 명시하면 mic 모드는 정상이지만 transcription endpoint 에서 tab 모드만
// session.created 직후 dc close 되는 회귀가 관측됨 (mic 은 native 48 kHz
// 로 들어와 mismatch 없음). translate-console 도 24 kHz 를 쓰지만 endpoint
// (`/v1/realtime/translations/calls`) 가 mismatch 에 더 관대.
// `undefined` 를 넘기면 Chrome 이 시스템 기본 (보통 48 kHz) 을 채택.
const TAB_AUDIO_SAMPLE_RATE: number | undefined = undefined;

type OaiEvent = {
  type?: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  [k: string]: unknown;
};

type WebkitWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

// transcription session 이 deltas/completed 이벤트에 같은 item_id 를
// 부여한다. fallback 으로 type-prefix + Date.now() 사용 — 같은 item_id 가
// 없으면 새 utterance 로 취급.
function eventToItemId(ev: OaiEvent, fallback: string): string {
  if (typeof ev.item_id === 'string' && ev.item_id) return ev.item_id;
  return fallback;
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
  // "탭 공유 중" 배너가 사라진다 — 반드시 resample 결과가 아닌 원본을 보관.
  const captureStreamRef = useRef<MediaStream | null>(null);
  // tab 모드에서 24 kHz resample 용 AudioContext. cleanup 시 close 필요.
  const tabResampleCtxRef = useRef<AudioContext | null>(null);
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
    const ctx = tabResampleCtxRef.current;
    if (ctx) {
      try {
        void ctx.close();
      } catch {
        /* already closed */
      }
      tabResampleCtxRef.current = null;
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

      // 2) capture — source 분기.
      //    captureStream = 원본 (cleanup 시 stop 대상, Chrome 탭 공유 배너 해제용).
      //    publishStream = WebRTC 로 보낼 것 (tab 모드는 24 kHz resample 결과).
      let captureStream: MediaStream;
      let publishStream: MediaStream;
      try {
        if (source === 'tab') {
          // getDisplayMedia 는 모든 지원 브라우저에서 video 제약을 요구한다.
          // 가장 가벼운 surface (브라우저 탭) 를 요청하고 비디오 트랙은 즉시
          // stop — 우리는 화면이 아닌 오디오만 필요.
          //
          // `ideal` 제약 (not `exact`): Chrome 의 getDisplayMedia 오디오
          // 파이프라인이 대부분의 제약을 무시하므로 OverconstrainedError 를
          // 피하면서도 가능하면 mono 로 downmix 되도록 hint 만 전달.
          console.info('[probing] requesting getDisplayMedia');
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
          console.info('[probing] getDisplayMedia ok', {
            audioTracks: audioTracks.length,
            settings: audioTracks.map((tr) => tr.getSettings()),
          });
          if (audioTracks.length === 0) {
            // 사용자가 picker 에서 surface 는 골랐지만 "탭 오디오 공유" 를
            // 체크 안 한 경우. Safari / 대부분의 모바일 브라우저처럼 플랫폼
            // 자체가 미지원이어도 같은 분기. transcript 할 게 없으므로 전용
            // 에러로 surface.
            display.getTracks().forEach((tr) => tr.stop());
            setError('tab_audio_unavailable');
            setStatus('error');
            cleanup();
            startInFlightRef.current = false;
            return;
          }
          captureStream = new MediaStream(audioTracks);

          // 24 kHz mono 로 WebAudio resample. 이유 (translate-console PR #396):
          // 1. Chrome 의 getDisplayMedia 가 sampleRate/channelCount 힌트를
          //    무시 — capture-time downmix 가 실제로 일어나지 않는다.
          // 2. OpenAI Realtime transcription 은 24 kHz mono PCM 을 기대.
          //    raw 48 kHz stereo 를 보내면 서버 resample 이 가끔 silent
          //    negotiation 실패 (#393 follow-up 의 stall 가설 중 하나).
          // 3. WebAudio 로 raw display 트랙을 fresh MediaStreamTrack 으로
          //    "lift" 하는 것 자체가 display-capture pipeline 의 stale-clock
          //    quirk 을 우회하는 알려진 workaround.
          //
          // AudioContext 생성이 실패하면 (아주 오래된 Chrome 등) raw stream
          // 으로 fallback — resample 없이라도 세션은 시작. 결과적으로 hang
          // 이 나면 watchdog 가 잡는다.
          try {
            const w = window as WebkitWindow;
            const AudioCtx = w.AudioContext ?? w.webkitAudioContext;
            if (!AudioCtx) throw new Error('no AudioContext');
            // sampleRate 미지정 → Chrome 시스템 기본값 (보통 48 kHz, WebRTC
            // Opus 와 정렬). 명시적 24 kHz 는 mic 모드와 달리 tab 모드에서만
            // transcription endpoint 가 dc 를 즉시 닫는 회귀의 주요 의심점.
            const ctxOpts: AudioContextOptions = {};
            if (TAB_AUDIO_SAMPLE_RATE !== undefined) {
              ctxOpts.sampleRate = TAB_AUDIO_SAMPLE_RATE;
            }
            const ctx = new AudioCtx(ctxOpts);
            tabResampleCtxRef.current = ctx;
            console.info('[probing] tab resample ctx created', {
              state: ctx.state,
              sampleRate: ctx.sampleRate,
            });
            if (ctx.state === 'suspended') {
              // 명시적 await — connect 전 ctx 가 running 이어야 source node 가
              // 실제로 sample 을 pull. suspended 상태로 connect 하면 dst 트랙이
              // 0-valued frame 만 흘리고 OpenAI 가 silence 만 받는다.
              try {
                await ctx.resume();
                console.info('[probing] tab resample ctx resumed', {
                  state: ctx.state,
                });
              } catch (err) {
                console.warn('[probing] tab resample ctx.resume failed', err);
              }
            }
            const src = ctx.createMediaStreamSource(captureStream);
            const dst = ctx.createMediaStreamDestination();
            // 명시적 stereo → mono 다운믹스. MediaStreamDestination 의
            // channelCount setter 는 Chrome 에서 무시되므로 (publishTrack
            // settings 가 channelCount: 2 로 그대로 남음), splitter + 0.5 gain
            // + merger 로 노드 그래프를 직접 짠다. OpenAI Realtime
            // transcription 은 mono PCM 을 기대 — translate-console 의
            // translation endpoint 는 stereo 에 더 관대해서 PR #396 패턴이
            // mono 강제 없이도 동작했지만 transcription 에서는 별도 처리.
            const splitter = ctx.createChannelSplitter(2);
            const merger = ctx.createChannelMerger(1);
            const gainL = ctx.createGain();
            const gainR = ctx.createGain();
            gainL.gain.value = 0.5;
            gainR.gain.value = 0.5;
            src.connect(splitter);
            splitter.connect(gainL, 0);
            splitter.connect(gainR, 1);
            gainL.connect(merger, 0, 0);
            gainR.connect(merger, 0, 0);
            merger.connect(dst);
            publishStream = dst.stream;
            const pubTrack = publishStream.getAudioTracks()[0];
            // captureStream (raw tab) 트랙 상태도 함께 — 입력 자체가 muted
            // 면 resample graph 가 silence 만 출력한다.
            const capTrack = captureStream.getAudioTracks()[0];
            console.info('[probing] tab resample graph wired', {
              ctxState: ctx.state,
              ctxSampleRate: ctx.sampleRate,
              publishTracks: publishStream.getAudioTracks().length,
              publishTrackEnabled: pubTrack?.enabled,
              publishTrackMuted: pubTrack?.muted,
              publishTrackReadyState: pubTrack?.readyState,
              publishTrackSettings: pubTrack?.getSettings(),
              captureTrackEnabled: capTrack?.enabled,
              captureTrackMuted: capTrack?.muted,
              captureTrackReadyState: capTrack?.readyState,
              captureTrackSettings: capTrack?.getSettings(),
            });
          } catch (err) {
            console.warn('[probing] tab resample failed, passing raw stream', err);
            publishStream = captureStream;
          }
        } else {
          captureStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
          publishStream = captureStream;
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

      // tab 모드: 3초마다 400ms 트랙 mute 로 OpenAI VAD 가 end-of-speech 를
      // 잡게 강제. 안 하면 YouTube/Meet 처럼 휴지 없는 탭은 utterance 가
      // 영원히 안 닫혀서 transcript 가 stall (translate-console PR #396 패턴).
      if (source === 'tab') {
        const track = captureStream.getAudioTracks()[0];
        if (track) {
          tabSilenceTimerRef.current = setInterval(() => {
            if (track.readyState !== 'live') return;
            track.enabled = false;
            setTimeout(() => {
              // Guard: track 이 dip 과 restore 사이에 끝났을 수 있다
              // (cleanup, hot-reload, picker 의 share-stop).
              if (track.readyState === 'live') track.enabled = true;
            }, TAB_SILENCE_DURATION_MS);
          }, TAB_SILENCE_INTERVAL_MS);
        }
      }

      // 3) RTCPeerConnection + datachannel + SDP 교환
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: STUN_URLS }],
      });
      pc.onsignalingstatechange = () => {
        console.info('[probing] pc.signalingState', pc.signalingState);
      };
      pc.onconnectionstatechange = () => {
        console.info('[probing] pc.connectionState', pc.connectionState);
      };
      pc.oniceconnectionstatechange = () => {
        console.info('[probing] pc.iceConnectionState', pc.iceConnectionState);
      };
      pc.onicegatheringstatechange = () => {
        console.info('[probing] pc.iceGatheringState', pc.iceGatheringState);
      };
      pc.onicecandidate = (e) => {
        // Candidate spam 이 무거우므로 type+protocol 만 로깅. null candidate
        // 는 gathering 완료 신호.
        console.info('[probing] ice-candidate', {
          type: e.candidate?.type ?? 'end-of-candidates',
          protocol: e.candidate?.protocol ?? null,
        });
      };
      pcRef.current = pc;
      const pubTracks = publishStream.getAudioTracks();
      console.info('[probing] addTrack to pc', {
        count: pubTracks.length,
        tracks: pubTracks.map((tr) => ({
          id: tr.id,
          enabled: tr.enabled,
          readyState: tr.readyState,
          muted: tr.muted,
        })),
      });
      pubTracks.forEach((tr) => pc.addTrack(tr, publishStream));

      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;
      dc.onopen = () => console.info('[probing] dc open');
      dc.onclose = () => {
        console.info('[probing] dc close', {
          pcConnection: pc.connectionState,
          pcIce: pc.iceConnectionState,
          pcSignaling: pc.signalingState,
        });
      };
      // 진단성: 첫 OAI 이벤트가 도착하는지, 어떤 type 들이 들어오는지 보기 위해
      // 알려지지 않은 type 은 첫 5개까지 콘솔에 dump. session.created /
      // session.updated / input_audio_buffer.* 등이 보여야 audio in 이
      // 실제로 OpenAI 까지 도달했다는 신호. 길이 cap 늘려서 session.created 의
      // 전체 audio.input 설정도 볼 수 있게.
      let unknownLogged = 0;
      dc.onmessage = (ev) => {
        const raw = String(ev.data);
        if (unknownLogged < 5) {
          try {
            const parsed = JSON.parse(raw) as { type?: string };
            const type = parsed?.type ?? 'unknown';
            if (
              type !== 'conversation.item.input_audio_transcription.delta' &&
              type !== 'conversation.item.input_audio_transcription.completed'
            ) {
              unknownLogged += 1;
              console.info('[probing] oai event', { type, raw: raw.slice(0, 1500) });
            }
          } catch {
            /* not JSON */
          }
        }
        handleOaiEvent(raw);
      };
      dc.onerror = (ev) => {
        console.warn('[probing] dc error', ev);
      };

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const sdpRes = await fetch(REALTIME_SDP_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${clientSecret}`,
            'Content-Type': 'application/sdp',
          },
          body: offer.sdp ?? '',
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

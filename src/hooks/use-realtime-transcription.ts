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
import { useCreditDeduction } from '@/components/credit-deduction-provider';
import { FEATURE_COSTS } from '@/lib/features';

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
  // 세션이 OpenAI 30분 cap 도달로 재연결 중 (transcript 는 계속 흐른다).
  // 위젯이 "🔄 세션 갱신 중…" 같은 subtle 힌트를 띄우는 용도.
  renewing: boolean;
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

// 크레딧 차감 heartbeat — probing 세션 시작 시 lump 25 credit (첫 1시간 포함),
// 이후 1시간마다 추가 25 credit. 서버는 tick_index ≤ 3 (= 4시간 시점, 누적 100
// credit = 4시간 cap) 까지만 받음. 사용자가 stop 안 누른 경우의 안전망.
const HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000;
const HEARTBEAT_MAX_TICK = 3;

// 세션 auto-renewal — OpenAI transcription 세션은 ~30분 hard cap 이 있어
// 그대로 두면 30분 도달 시 transcript 가 끊긴다 (실 인터뷰/필드 조사는
// 60~90분). 25분(마진 5분) 도달 시 새 client_secret 으로 새 PC 를 붙이고
// 옛 PC 는 grace 후 close — 사용자 체감 gap <2초. 크레딧은 renewal 시
// 재과금 없음 (같은 session_id → server 의 spend_credits idempotent).
const SESSION_MAX_MS = 25 * 60 * 1000;
// startedAt 대비 경과를 폴링하는 주기. translate 패턴과 동일한 10초 tick.
const RENEW_CHECK_INTERVAL_MS = 10_000;
// 새 PC 로 swap 후 옛 PC 를 즉시 닫지 않고 마지막 transcript delta 를
// 흘려보낼 유예. 이 안에 in-flight utterance 의 completed 이벤트가 들어온다.
const RENEW_OLD_PC_GRACE_MS = 2000;

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
  const [renewing, setRenewing] = useState(false);

  // 차감 broadcast — start-lump + 각 heartbeat 성공 시 위젯 헤더 -N
  // fly-up + topbar pulse 트리거. ref 로 잡아둬서 비동기 콜백 안에서
  // stable 한 reference 유지.
  const { notify: notifyDeduction } = useCreditDeduction();
  const notifyDeductionRef = useRef(notifyDeduction);
  useEffect(() => {
    notifyDeductionRef.current = notifyDeduction;
  });

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
  // Server-issued probing session id — also the start-lump generation_id.
  // Reused by the heartbeat ticker to derive subsequent tick generation_ids.
  const sessionIdRef = useRef<string | null>(null);
  // 10-min heartbeat ticker for incremental credit charges.
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Last successfully charged tick_index (0 = start lump). The ticker fires
  // tick_index+1 each interval. Stops sending once we hit HEARTBEAT_MAX_TICK
  // or the server returns 402 (insufficient credits).
  const heartbeatTickRef = useRef<number>(0);
  // start() 중복 방지. setStatus('starting') 는 batched 라 같은 microtask
  // 안 두 번째 클릭은 closure 로 idle 을 본다 — ref 가 진짜 가드.
  const startInFlightRef = useRef(false);
  // auto-renewal 상태. startedAt = 현재 OpenAI 세션이 붙은 시각 (renewal 마다
  // 갱신). sourceRef = 재연결 시 tab/mic 분기 재현용. renewTimer = 25분 폴링.
  // renewInFlight = 재연결 중복 방지 (실패 시 10초 뒤 자동 재시도).
  const startedAtRef = useRef<number>(0);
  const sourceRef = useRef<TranscriptionSource>('mic');
  const renewTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const renewInFlightRef = useRef(false);
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
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    if (renewTimerRef.current) {
      clearInterval(renewTimerRef.current);
      renewTimerRef.current = null;
    }
    startedAtRef.current = 0;
    renewInFlightRef.current = false;
    setRenewing(false);
    sessionIdRef.current = null;
    heartbeatTickRef.current = 0;
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

  // 세션 renewal — OpenAI transcription 세션이 30분 cap 에 닿기 전(25분)에
  // 새 client_secret 으로 새 PC 를 붙이고 옛 PC 를 grace 후 close 한다.
  // 핵심 불변식:
  //  - transcript(segments) 는 건드리지 않는다 → renewal 걸쳐 연속 유지.
  //  - capture 트랙은 재사용 → mic/tab picker 재프롬프트 없음. 옛 PC 를
  //    close 해도 sender 트랙은 새 PC 와 공유하므로 stop 하면 안 된다 (close 만).
  //  - 서버에 같은 session_id 를 넘겨 spend_credits 가 idempotent → 재과금 0.
  //  - 실패해도 옛 PC 를 강제로 죽이지 않는다. startedAt 을 그대로 둬서
  //    다음 10초 tick 이 재시도 (세션이 완전히 끊기기 전 여러 번 기회).
  const renewSession = useCallback(async () => {
    if (renewInFlightRef.current) return;
    const capture = captureStreamRef.current;
    const sid = sessionIdRef.current;
    // capture / session 이 없으면 이미 정리된 세션 — renewal 무의미.
    if (!capture || !sid) return;

    renewInFlightRef.current = true;
    setRenewing(true);
    console.info('[probing] session_renew_start', {
      elapsed_ms: Date.now() - startedAtRef.current,
      session_id: sid,
    });

    try {
      // 1) 새 client_secret — 같은 session_id 를 generation_id 로 전달해
      //    서버 spend_credits 가 기존 charge 를 보고 재과금 없이 통과.
      const res = await fetch('/api/probing/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        client_secret?: { value?: string };
        error?: string;
      };
      if (!res.ok || !json.client_secret?.value) {
        throw new Error(json.error ?? `renew_session_failed_${res.status}`);
      }
      const clientSecret = json.client_secret.value;

      // 2) 새 PC + datachannel + SDP 교환. start() 의 step 3 와 동형 — tab
      //    모드는 Opus mono 강제 (mic 는 native mono 라 munge 불필요).
      const source = sourceRef.current;
      const newPc = new RTCPeerConnection({ iceServers: [{ urls: STUN_URLS }] });
      newPc.oniceconnectionstatechange = () => {
        console.info('[probing] renew pc.iceConnectionState', newPc.iceConnectionState);
      };
      capture.getAudioTracks().forEach((tr) => newPc.addTrack(tr, capture));

      const newDc = newPc.createDataChannel('oai-events');
      newDc.onerror = (ev) => {
        console.warn('[probing] renew dc error', ev);
      };
      newDc.onmessage = (ev) => handleOaiEvent(String(ev.data));

      const offer = await newPc.createOffer();
      const offerSdp =
        source === 'tab' ? forceOpusMonoSdp(offer.sdp ?? '') : offer.sdp ?? '';
      await newPc.setLocalDescription({ type: 'offer', sdp: offerSdp });
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
        console.warn('[probing] renew sdp error', sdpRes.status, body.slice(0, 300));
        try {
          newPc.close();
        } catch {
          /* already closed */
        }
        throw new Error(`renew_openai_sdp_${sdpRes.status}`);
      }
      const answerSdp = await sdpRes.text();
      await newPc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      // 3) swap — 새 PC/DC 를 active 로. 옛 것은 grace 후 close (마지막 delta
      //    수신). 트랙은 공유하므로 stop 하지 않고 PC/DC 만 닫는다.
      const oldPc = pcRef.current;
      const oldDc = dcRef.current;
      pcRef.current = newPc;
      dcRef.current = newDc;
      startedAtRef.current = Date.now();
      setTimeout(() => {
        try {
          oldDc?.close();
        } catch {
          /* already closed */
        }
        try {
          oldPc?.close();
        } catch {
          /* already closed */
        }
      }, RENEW_OLD_PC_GRACE_MS);

      console.info('[probing] session_renew_done', { session_id: sid });
    } catch (e) {
      // 옛 PC 유지 — 다음 tick 재시도. 세션을 끊지 않는다 (best-effort).
      console.warn('[probing] session_renew_failed', e);
    } finally {
      renewInFlightRef.current = false;
      setRenewing(false);
    }
  }, [handleOaiEvent]);

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

      // 1) 서버 세션 — client_secret 발급 + start-lump credit 차감.
      // 서버가 반환하는 session_id 는 (a) start-lump 차감의 generation_id
      // 이자 (b) 10분 heartbeat 의 session 핸들. cleanup() 에서 ref 가
      // 초기화되므로 여기서만 set.
      let clientSecret: string;
      try {
        const res = await fetch('/api/probing/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const json = (await res.json().catch(() => ({}))) as {
          session_id?: string;
          client_secret?: { value?: string };
          error?: string;
        };
        if (!res.ok || !json.client_secret?.value) {
          // 402 = insufficient_credits — 사용자 잔액 부족. 위젯이 별 paywall
          // 토스트를 띄울 수 있게 명시적 error code 전달.
          throw new Error(json.error ?? `session_failed_${res.status}`);
        }
        clientSecret = json.client_secret.value;
        sessionIdRef.current = json.session_id ?? null;
        heartbeatTickRef.current = 0;
        // start-lump 차감 성공 — 위젯 헤더 -N fly-up + topbar pulse.
        notifyDeductionRef.current('probing', FEATURE_COSTS.probing);
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

      // auto-renewal 무장 — 현재 OpenAI 세션 시작 시각 기록 + source 저장
      // (재연결 시 tab/mic 분기 재현). 10초마다 경과를 보고 25분 넘으면
      // renewSession() 발사. cleanup() 이 interval + startedAt 을 해제.
      startedAtRef.current = Date.now();
      sourceRef.current = source;
      if (!renewTimerRef.current) {
        renewTimerRef.current = setInterval(() => {
          if (startedAtRef.current === 0) return;
          if (Date.now() - startedAtRef.current >= SESSION_MAX_MS) {
            void renewSession();
          }
        }, RENEW_CHECK_INTERVAL_MS);
      }

      // 1시간 heartbeat 시작 — start lump 가 이미 첫 1시간을 커버하므로
      // 첫 tick (index 1) 은 1시간 후 발사. cleanup() 이 interval 을 해제.
      // 서버가 402 (잔액 부족) 또는 cap 초과를 반환하면 자동 정지.
      const sid = sessionIdRef.current;
      if (sid && !heartbeatTimerRef.current) {
        heartbeatTimerRef.current = setInterval(() => {
          const nextTick = heartbeatTickRef.current + 1;
          if (nextTick > HEARTBEAT_MAX_TICK) {
            if (heartbeatTimerRef.current) {
              clearInterval(heartbeatTimerRef.current);
              heartbeatTimerRef.current = null;
            }
            return;
          }
          // Fire-and-forget; failure paths log but don't tear down the live
          // session — UX choice is to keep transcription running while the
          // user reads the paywall toast. Backend cap on tick_index ≥ 4
          // guarantees we can't bleed past the 4-hour ceiling.
          void fetch('/api/probing/sessions/heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sid, tick_index: nextTick }),
          })
            .then(async (res) => {
              if (res.ok) {
                heartbeatTickRef.current = nextTick;
                // tick 성공 — 추가 25 credit 차감 시각화.
                notifyDeductionRef.current('probing', FEATURE_COSTS.probing);
              } else if (res.status === 402) {
                console.warn('[probing] heartbeat insufficient_credits — stopping ticks');
                if (heartbeatTimerRef.current) {
                  clearInterval(heartbeatTimerRef.current);
                  heartbeatTimerRef.current = null;
                }
              }
            })
            .catch((err) => {
              console.warn('[probing] heartbeat network error', err);
            });
        }, HEARTBEAT_INTERVAL_MS);
      }
    },
    [cleanup, handleOaiEvent, renewSession, status],
  );

  // unmount 시 누수 방지. 세션이 살아 있으면 정리.
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return { status, segments, error, renewing, start, stop };
}

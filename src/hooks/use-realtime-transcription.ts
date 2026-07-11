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
   - 10s connect watchdog — **capture(getDisplayMedia/getUserMedia) 완료 후**
     'connecting' 단계 진입 시 setTimeout 으로 arm, 'live' 도달 시 clear.
     사용자 조작(탭 선택/권한 승인) 시간은 제외 — watchdog 은 SDP/ICE/DC
     네트워크 연결만 감시. 만료되면 phase 태그 + pc/dc 상태 dump +
     `probing_connect_timeout` 에러. 세션 fetch 는 별도 8s AbortController
     (`session_timeout`) 로 격리 — watchdog 이 서버 hang 을 대신 삼키지 않는다.
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
import { createClient } from '@/lib/supabase/client';

export type TranscriptionStatus =
  | 'idle'
  | 'starting'
  | 'live'
  | 'stopping'
  | 'error';

export type TranscriptionSource = 'mic' | 'tab';

// start() 진행 단계 태그 — 실패/타임아웃 로그에 실려 "pc null 만 보고 추측"
// 상황을 제거한다 (spec C). 'session_fetch' = 서버 client_secret 발급,
// 'capture' = getDisplayMedia/getUserMedia (사용자 조작 다이얼로그, watchdog
// 정지 구간), 'connecting' = SDP/ICE/DC (watchdog armed 구간).
type StartPhase = 'idle' | 'session_fetch' | 'capture' | 'connecting';

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

// 세션 원본 녹음(#554) 표면 상태. STT 와 독립된 부가 경로 — MediaRecorder 가
// capture 스트림에 병렬로 붙어 녹음하고, 종료 시 blob 을 업로드한다.
//  - idle: 녹음 없음(세션 시작 전).
//  - uploading: 종료 후 blob 업로드/서명 중.
//  - ready: downloadUrl(signed) 발급 완료 — 다운로드 버튼 노출.
//  - empty: 캡처된 오디오 0(오디오 트랙 없음 / blob 0 / recorder 미지원). #582
//    이전엔 '조용히 생략'했으나, 왜 다운로드가 없는지 사용자에게 표면화한다.
//  - error: 업로드/서명 실패(비블로킹 — 세션 종료는 정상). toast + 표면화용.
// empty/error 의 `error` 필드는 사유 코드(no_audio_track / no_audio_captured /
// recorder_unsupported / recorder_start_failed / 업로드 예외 메시지)를 담아
// probing-card 가 사람이 읽을 안내로 매핑한다.
export type SessionRecordingState = {
  status: 'idle' | 'uploading' | 'ready' | 'empty' | 'error';
  downloadUrl: string | null;
  durationSeconds: number | null;
  error: string | null;
};

const IDLE_RECORDING: SessionRecordingState = {
  status: 'idle',
  downloadUrl: null,
  durationSeconds: null,
  error: null,
};

export type UseRealtimeTranscriptionResult = {
  status: TranscriptionStatus;
  segments: TranscriptionSegment[];
  error: string | null;
  // 세션이 OpenAI 30분 cap 도달로 재연결 중 (transcript 는 계속 흐른다).
  // 위젯이 "🔄 세션 갱신 중…" 같은 subtle 힌트를 띄우는 용도.
  renewing: boolean;
  // 서버가 발급한 probing_sessions.id (start 성공 시 set, stop/cleanup 시 null).
  // renew(30분 cap 재연결)는 같은 session_id 를 재사용하므로 이 값이 불변 →
  // 소비자가 "새 세션 vs 같은 세션 재진입" 을 구별할 수 있다. 채워진 페르소나를
  // 재연결/renew 로 지우지 않기 위한 게이트 (probing-card 리셋 effect).
  sessionId: string | null;
  // 세션 원본 녹음(#554) 상태 — 종료 후 다운로드 표면용. STT 무간섭 부가 경로.
  recording: SessionRecordingState;
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

// connect watchdog — **capture 완료 후** 이 시간 안에 SDP/ICE/DC 가 'live' 에
// 도달 못 하면 `probing_connect_timeout`. translate-console PR #396 과 동일 수치.
// 핵심: start() 진입이 아니라 getDisplayMedia/getUserMedia (사용자 조작
// 다이얼로그) 가 끝난 뒤에 armed 된다 — 탭 선택/권한 승인에 걸린 사용자 시간은
// 네트워크 watchdog 에서 제외 (이 파일의 P0 회귀 root cause 였다).
const CONNECT_TIMEOUT_MS = 10_000;

// 세션 fetch (`POST /api/probing/sessions`) 자체 타임아웃 — 서버 hang 시
// 조용히 watchdog 시간을 소진하는 대신 8초에 명시적 `session_timeout` 에러.
// watchdog 과 분리된 단계별 안전망 (spec B).
const SESSION_FETCH_TIMEOUT_MS = 8_000;

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

// ─── 세션 원본 녹음(#554) — MediaRecorder 병렬 탭 ───
// timeslice 단위 in-memory chunk 축적. QA voice(qa-voice-agent-button) 패턴
// 재사용. STT WebRTC 경로와는 완전히 무간섭 — 같은 capture 스트림을 공유할 뿐.
const RECORD_TIMESLICE_MS = 2000;
// 종료 직후 다운로드용 signed URL 유효 시간(초).
const RECORDING_SIGNED_URL_TTL_S = 60 * 60;

// 녹음 컨테이너 선택 — mp4/AAC(.m4a) 우선, 미지원 시 webm/opus 폴백.
// 다운로드 파일이 브라우저 밖(QuickTime·Apple Music·Windows 미디어 플레이어)
// 에서도 오디오로 열리게 하려면 .m4a 가 안전하다. webm/opus 는 재생 자체는
// 되지만 많은 데스크톱 플레이어가 오디오로 인식 못 한다 → 지원 브라우저
// (Safari·최신 Chrome)에선 mp4 를 먼저 고른다 (#582 후속, 사용자 요청).
function pickRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of [
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm',
  ]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

function extForRecorderMime(mime: string): string {
  return mime.includes('mp4') ? 'm4a' : 'webm';
}

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
  // sessionIdRef 의 reactive 미러 — 소비자에게 노출. ref 는 비동기 콜백용,
  // state 는 리셋 게이트 같은 렌더/effect 의존용.
  const [sessionId, setSessionId] = useState<string | null>(null);

  // ─── 세션 원본 녹음(#554) ───
  // Supabase 브라우저 싱글턴 — storage 업로드 + signed URL 발급용.
  const supabase = createClient();
  const [recording, setRecording] =
    useState<SessionRecordingState>(IDLE_RECORDING);
  // capture 스트림에 병렬로 붙는 MediaRecorder + in-memory chunk buffer.
  const recorderRef = useRef<MediaRecorder | null>(null);
  // recorder 전용 클론 스트림 — tab silence-injection(원본 트랙 enabled 토글)이
  // 녹음 chunk 에 새지 않게 별도 트랙에서 녹음한다(#582). 원본 capture 는
  // captureStreamRef 가 소유, 이 클론은 recorder 종료/정리 시 별도로 stop.
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordMimeRef = useRef<string>('audio/webm');
  // 녹음 시작 시각 — 종료 시 duration 계산. renewal 을 걸쳐도 갱신 안 함
  // (같은 capture 스트림이라 recorder 가 연속 → 전체 세션 길이).
  const recordStartedAtRef = useRef<number>(0);
  // 녹음이 속한 세션 id 스냅샷 — cleanup 이 sessionIdRef 를 null 로 지우기 전에
  // 잡아둬서 업로드 경로가 올바른 storage prefix/row 를 쓰게 한다.
  const recordingSessionIdRef = useRef<string | null>(null);

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
  // 10s connect watchdog. capture 완료 후에만 armed (사용자 조작 시간 제외).
  const connectWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 현재 start() 진행 단계 — 실패/타임아웃 진단 로그에 실린다 (spec C).
  const phaseRef = useRef<StartPhase>('idle');
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
  // 세션 종료 계측(OBS-2) 사유. teardown(cleanup) 이 이 값으로
  // probing_session_runs 를 'ended'/'error' 로 마감한다. 기본 'ended'(정상 stop
  // /언마운트), 에러 경로가 cleanup 직전에 'error' 로 세팅. 탭 닫힘/크래시로
  // cleanup 이 아예 안 돌면 row 는 'active' 로 남아 퍼널의 "이탈" 버킷이 된다.
  const endReasonRef = useRef<'ended' | 'error'>('ended');
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
    // 세션 종료 계측(OBS-2) — session_id 가 있으면(= 서버 run row 가 있으면)
    // 마감 beacon. sessionIdRef 를 null 로 지우기 전에 먼저 발사한다.
    // keepalive 로 언마운트/네비게이션에도 요청이 살아남는다. best-effort:
    // 실패해도 무시(퍼널 계측이 세션 정리를 막지 않음). 두 번째 cleanup 은
    // sessionIdRef 가 이미 null 이라 중복 발사 없음.
    const endingSid = sessionIdRef.current;
    if (endingSid) {
      const reason = endReasonRef.current;
      void fetch('/api/probing/sessions/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: endingSid, status: reason }),
        keepalive: true,
      }).catch(() => {
        /* best-effort 계측 — 무시 */
      });
    }
    endReasonRef.current = 'ended';
    if (connectWatchdogRef.current) {
      clearTimeout(connectWatchdogRef.current);
      connectWatchdogRef.current = null;
    }
    phaseRef.current = 'idle';
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
    setSessionId(null);
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
    // 녹음 recorder 정리 (best-effort, 업로드 없음). 정상 stop 은
    // finalizeRecording 이 이미 recorderRef 를 null 로 비웠으므로 여기 안 걸린다
    // — 여기 걸리는 건 unmount/error/renewal-실패 경로다. 부분 녹음은 버린다
    // (비블로킹 부가물 — 완주한 세션만 업로드).
    const rec = recorderRef.current;
    if (rec) {
      try {
        if (rec.state !== 'inactive') rec.stop();
      } catch {
        /* already stopped */
      }
      recorderRef.current = null;
    }
    recordChunksRef.current = [];
    // recorder 클론 스트림 정리 — 원본 capture 와 별개로 stop 해야 mic/tab
    // 소스가 계속 hot 으로 남지 않는다.
    const recStream = recordStreamRef.current;
    if (recStream) {
      recStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* already stopped */
        }
      });
      recordStreamRef.current = null;
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

  // ─── 세션 원본 녹음(#554) ───

  // capture 스트림에 MediaRecorder 를 병렬로 붙인다. STT 의 RTCPeerConnection
  // 경로와 무간섭 — 같은 트랙을 읽기만 할 뿐. renewal 은 같은 capture 스트림을
  // 재사용(renewSession 이 captureStreamRef 를 안 바꾸고, 옛 PC close 도 트랙을
  // stop 하지 않음)하므로 recorder 는 renewal 을 걸쳐 연속 녹음한다 → 재바인딩
  // 불필요. 따라서 이 함수는 신규 start() 에서 한 번만 호출한다.
  const startRecorder = useCallback((stream: MediaStream) => {
    if (typeof MediaRecorder === 'undefined') {
      console.warn('[probing][rec] MediaRecorder unsupported — recording disabled');
      setRecording({
        status: 'empty',
        downloadUrl: null,
        durationSeconds: null,
        error: 'recorder_unsupported',
      });
      return;
    }
    if (recorderRef.current) return; // 중복 방지 (renewal 은 여기 안 옴)

    // recorder 를 붙이기 전, capture 스트림에 실제로 재생 가능한 오디오 트랙이
    // 있는지 확인한다(#582). 없으면 '조용히 생략'하지 말고 'empty' 로 표면화 —
    // 왜 다운로드가 안 생기는지 사용자가 인지하게 한다(예: 탭 오디오 미공유).
    const srcTracks = stream.getAudioTracks();
    const liveTracks = srcTracks.filter((t) => t.readyState === 'live');
    console.info('[probing][rec] startRecorder', {
      audio_tracks: srcTracks.length,
      live_tracks: liveTracks.length,
      session_id: sessionIdRef.current,
    });
    if (liveTracks.length === 0) {
      setRecording({
        status: 'empty',
        downloadUrl: null,
        durationSeconds: null,
        error: 'no_audio_track',
      });
      return;
    }

    try {
      const mime = pickRecorderMime();
      recordMimeRef.current = mime || 'audio/webm';
      // 트랙을 clone 해서 별도 스트림으로 녹음한다. tab 모드 silence-injection 은
      // 원본 트랙의 `enabled` 를 3초마다 토글(server_vad commit 강제)하는데, 같은
      // 트랙을 recorder 가 읽으면 그 강제 무음이 녹음에 섞이거나 chunk 산출에
      // 영향을 줄 수 있다. 클론은 독립 트랙이라 STT(원본) 와 녹음(클론) 이 서로
      // 간섭하지 않는다(#582).
      const recordStream = new MediaStream(liveTracks.map((t) => t.clone()));
      recordStreamRef.current = recordStream;
      const recorder = new MediaRecorder(
        recordStream,
        mime ? { mimeType: mime, audioBitsPerSecond: 128000 } : undefined,
      );
      recordChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordChunksRef.current.push(e.data);
      };
      recorder.onerror = (ev) => {
        console.warn('[probing][rec] recorder error event', ev);
      };
      recorder.start(RECORD_TIMESLICE_MS);
      recorderRef.current = recorder;
      recordStartedAtRef.current = Date.now();
      recordingSessionIdRef.current = sessionIdRef.current;
      console.info('[probing][rec] recorder started', {
        mime: recordMimeRef.current,
        timeslice_ms: RECORD_TIMESLICE_MS,
      });
    } catch (e) {
      // 녹음은 부가물 — 실패해도 세션(STT)은 정상 진행. recorder 만 비활성.
      // 조용히 넘기지 않고 'empty' 로 사유를 남긴다(#582).
      console.warn('[probing][rec] recorder start failed (recording disabled)', e);
      recorderRef.current = null;
      recordStreamRef.current?.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* already stopped */
        }
      });
      recordStreamRef.current = null;
      setRecording({
        status: 'empty',
        downloadUrl: null,
        durationSeconds: null,
        error: 'recorder_start_failed',
      });
    }
  }, []);

  // 업로드 — blob 을 probing-session-audio 버킷에 올리고, 메타 row 를 서버
  // 라우트로 남긴 뒤, 즉시 다운로드용 signed URL 을 발급한다. 전 과정
  // 비블로킹: 실패하면 recording.status='error' 로만 표면화(세션 종료는 이미
  // 끝났다). fire-and-forget 으로 호출돼 stop() 을 막지 않는다.
  const uploadRecording = useCallback(
    async (
      blob: Blob,
      mime: string,
      durationSeconds: number,
      sid: string | null,
    ) => {
      setRecording({
        status: 'uploading',
        downloadUrl: null,
        durationSeconds,
        error: null,
      });
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error('unauthorized');
        // storage key 는 반드시 user.id prefix — 버킷 self-upload RLS 매칭.
        const effectiveSid = sid ?? crypto.randomUUID();
        const key = `${user.id}/${effectiveSid}/${Date.now()}-${crypto
          .randomUUID()
          .slice(0, 8)}.${extForRecorderMime(mime)}`;
        console.info('[probing][rec] upload start', {
          key,
          bytes: blob.size,
          mime,
        });
        const { error: uploadErr } = await supabase.storage
          .from('probing-session-audio')
          .upload(key, blob, { contentType: mime });
        if (uploadErr) throw uploadErr;
        console.info('[probing][rec] upload ok', { key });

        // 메타 row insert — org_id 는 서버(getActiveOrg)만 신뢰 가능하므로
        // 라우트에서 해석. row 가 없어도 다운로드는 storage signed URL 로
        // 동작하니 여기 실패는 non-fatal(경고만). sid 가 있을 때만 기록.
        if (sid) {
          void fetch('/api/probing/recordings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_id: sid,
              storage_key: key,
              mime,
              size_bytes: blob.size,
              duration_seconds: durationSeconds,
            }),
          }).catch((e) => {
            console.warn('[probing] recording row insert failed (non-fatal)', e);
          });
        }

        // 즉시 다운로드용 signed URL. download 옵션으로
        // content-disposition=attachment 강제 → 클릭 시 파일 저장.
        const { data: signed, error: signErr } = await supabase.storage
          .from('probing-session-audio')
          .createSignedUrl(key, RECORDING_SIGNED_URL_TTL_S, {
            download: `probing-recording-${effectiveSid.slice(
              0,
              8,
            )}.${extForRecorderMime(mime)}`,
          });
        if (signErr || !signed?.signedUrl) {
          throw signErr ?? new Error('sign_failed');
        }

        setRecording({
          status: 'ready',
          downloadUrl: signed.signedUrl,
          durationSeconds,
          error: null,
        });
      } catch (e) {
        console.error('[probing] recording upload failed', e);
        setRecording({
          status: 'error',
          downloadUrl: null,
          durationSeconds,
          error: e instanceof Error ? e.message : 'recording_upload_failed',
        });
      }
    },
    [supabase],
  );

  // 종료 시 녹음 마감 — recorder 를 멈추고 마지막 청크까지 조립한 뒤 업로드를
  // 킥한다. cleanup 이 capture 트랙을 stop 하기 전에 호출해야 마지막 flush 를
  // 잃지 않는다(그래서 stop() 이 이 함수를 await). 업로드 자체는 fire-and-forget.
  const finalizeRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    // recorder 가 애초에 안 붙은 경우(no_audio_track / recorder_unsupported 등)
    // startRecorder 가 이미 'empty' 로 표면화했으므로 여기서 덮어쓰지 않는다.
    if (!recorder) return;
    const mime = recordMimeRef.current || 'audio/webm';
    const blob = await new Promise<Blob | null>((resolve) => {
      const assemble = () =>
        recordChunksRef.current.length
          ? new Blob(recordChunksRef.current, { type: mime })
          : null;
      // recorder.stop() → 마지막 dataavailable → onstop 순. onstop 에서 조립.
      if (recorder.state === 'inactive') {
        resolve(assemble());
        return;
      }
      recorder.onstop = () => resolve(assemble());
      try {
        recorder.stop();
      } catch {
        resolve(assemble());
      }
    });
    const chunkCount = recordChunksRef.current.length;
    recordChunksRef.current = [];
    // 녹음 클론 스트림 정리 — 원본 capture 는 cleanup 이 별도로 stop 한다.
    recordStreamRef.current?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* already stopped */
      }
    });
    recordStreamRef.current = null;
    const blobSize = blob?.size ?? 0;
    console.info('[probing][rec] finalize', {
      chunks: chunkCount,
      blob_bytes: blobSize,
      mime,
    });
    if (!blob || blobSize === 0) {
      // 캡처된 오디오 0 — '조용히 생략'하지 않고 'empty' 로 표면화(#582).
      // recorder 는 붙었지만 chunk 가 하나도 안 나온 경우(무음 트랙/짧은 세션/
      // silence-injection 간섭 등). 세션 종료는 그대로 정상.
      const durationSeconds = recordStartedAtRef.current
        ? Math.max(
            0,
            Math.round((Date.now() - recordStartedAtRef.current) / 1000),
          )
        : 0;
      setRecording({
        status: 'empty',
        downloadUrl: null,
        durationSeconds,
        error: 'no_audio_captured',
      });
      return;
    }
    const durationSeconds = recordStartedAtRef.current
      ? Math.max(1, Math.round((Date.now() - recordStartedAtRef.current) / 1000))
      : 0;
    const sid = recordingSessionIdRef.current;
    // fire-and-forget — stop() 을 막지 않는다 (비블로킹 부가물).
    void uploadRecording(blob, mime, durationSeconds, sid);
  }, [uploadRecording]);

  const stop = useCallback(async () => {
    if (status === 'idle') return;
    setStatus('stopping');
    // 녹음 마감(blob 조립 + 업로드 킥) 을 cleanup 이 트랙을 멈추기 전에.
    await finalizeRecording();
    cleanup();
    setStatus('idle');
  }, [cleanup, finalizeRecording, status]);

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
      // 새 세션 — 이전 녹음 표면 리셋 (다운로드 버튼/에러 초기화).
      setRecording(IDLE_RECORDING);
      setStatus('starting');

      // start() 전체 경과의 기준점 — 실패/타임아웃 로그의 elapsed_ms 는
      // 여기서부터 잰다 (어느 단계까지 갔다가 멈췄는지 phase 태그와 함께 파악).
      const startedWallAt = Date.now();

      // watchdog 은 여기서 armed 하지 않는다 — capture(getDisplayMedia/
      // getUserMedia) 가 끝난 뒤 'connecting' 단계 진입 시점에 arm 한다.
      // 사용자의 탭 선택/권한 승인 시간이 네트워크 watchdog 에 잡히던 P0
      // 회귀를 막기 위함 (spec A).

      // 1) 서버 세션 — client_secret 발급 + start-lump credit 차감.
      // 서버가 반환하는 session_id 는 (a) start-lump 차감의 generation_id
      // 이자 (b) 10분 heartbeat 의 session 핸들. cleanup() 에서 ref 가
      // 초기화되므로 여기서만 set.
      //
      // 자체 AbortController 8s — 서버가 hang 하면 watchdog 이 아니라 여기서
      // 명시적 `session_timeout` 으로 끊는다 (spec B). watchdog 은 아직
      // armed 되지 않았으므로 이 단계의 hang 은 phase='session_fetch' 로 격리.
      phaseRef.current = 'session_fetch';
      let clientSecret: string;
      try {
        const fetchController = new AbortController();
        const fetchTimer = setTimeout(
          () => fetchController.abort(),
          SESSION_FETCH_TIMEOUT_MS,
        );
        let res: Response;
        try {
          res = await fetch('/api/probing/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // source 는 probing_session_runs 계측용 (mic/tab). 신규 start 에만
            // 의미 — renewal 은 renewSession() 이 별도로 처리한다.
            body: JSON.stringify({ source }),
            signal: fetchController.signal,
          });
        } finally {
          clearTimeout(fetchTimer);
        }
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
        setSessionId(json.session_id ?? null);
        heartbeatTickRef.current = 0;
        // start-lump 차감 성공 — 위젯 헤더 -N fly-up + topbar pulse.
        notifyDeductionRef.current('probing', FEATURE_COSTS.probing);
      } catch (e) {
        // AbortError = 8s 초과 = 서버 hang. generic session_failed 와 구분되는
        // 명시적 `session_timeout` 으로 사용자가 원인(서버 지연)을 인지.
        const aborted = e instanceof DOMException && e.name === 'AbortError';
        console.warn('[probing] session fetch failed', {
          phase: 'session_fetch',
          source,
          timeout: aborted,
          elapsed_ms: Date.now() - startedWallAt,
          error: e instanceof Error ? e.message : String(e),
        });
        setError(
          aborted
            ? 'session_timeout'
            : e instanceof Error
              ? e.message
              : 'session_failed',
        );
        setStatus('error');
        cleanup();
        startInFlightRef.current = false;
        return;
      }

      // 2) capture — source 분기. tab 모드는 getDisplayMedia 의 트랙을 그대로
      // pc.addTrack (raw passthrough). WebAudio resample 그래프를 끼우면
      // transcription endpoint 가 dc 를 즉시 close (PR #401 진단으로 확정).
      //
      // 이 단계 = 사용자 조작 다이얼로그(탭 선택 + "오디오 공유" 체크, 또는 mic
      // 권한 승인). watchdog 은 여전히 정지 상태 — 사용자가 얼마나 오래 고르든
      // 타임아웃 없음. 취소/거부는 아래 NotAllowedError 경로가 처리 (spec A).
      phaseRef.current = 'capture';
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
            endReasonRef.current = 'error';
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
        console.warn('[probing] capture failed', {
          phase: 'capture',
          source,
          name,
          elapsed_ms: Date.now() - startedWallAt,
          error: e,
        });
        if (source === 'tab') {
          setError(name === 'NotAllowedError' ? 'tab_audio_denied' : 'tab_audio_failed');
        } else {
          setError(
            name === 'NotAllowedError' ? 'microphone_denied' : 'microphone_failed',
          );
        }
        endReasonRef.current = 'error';
        setStatus('error');
        cleanup();
        startInFlightRef.current = false;
        return;
      }
      captureStreamRef.current = captureStream;

      // 세션 원본 녹음(#554) — capture 스트림에 MediaRecorder 를 병렬로 붙인다.
      // STT WebRTC(아래 pc.addTrack)와 무간섭. 실패해도 STT 는 정상 진행.
      // renewal 은 같은 스트림 재사용이라 여기서 한 번만 시작하면 연속 녹음된다.
      startRecorder(captureStream);

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

      // 3) RTCPeerConnection + datachannel + SDP 교환.
      // 여기서 비로소 10s connect watchdog 을 arm 한다 — 사용자 조작(capture)
      // 이 끝났고, 남은 건 순수 네트워크 연결(SDP/ICE/DC)뿐이라 watchdog 의
      // 본래 감시 대상 (spec A). 'live' 도달 직전 clear, 실패 시 cleanup() 이
      // clear. 만료 로그는 phase='connecting' + elapsed_ms 로 재발 시 즉시 격리.
      phaseRef.current = 'connecting';
      const connectArmedAt = Date.now();
      if (connectWatchdogRef.current) clearTimeout(connectWatchdogRef.current);
      connectWatchdogRef.current = setTimeout(() => {
        connectWatchdogRef.current = null;
        const wpc = pcRef.current;
        const wdc = dcRef.current;
        console.warn('[probing] connect timeout', {
          phase: phaseRef.current,
          source,
          elapsed_ms: Date.now() - startedWallAt,
          connecting_ms: Date.now() - connectArmedAt,
          pcConnection: wpc?.connectionState ?? null,
          pcIce: wpc?.iceConnectionState ?? null,
          pcSignaling: wpc?.signalingState ?? null,
          pcGathering: wpc?.iceGatheringState ?? null,
          dcReadyState: wdc?.readyState ?? null,
        });
        setError('probing_connect_timeout');
        endReasonRef.current = 'error';
        setStatus('error');
        cleanup();
        startInFlightRef.current = false;
      }, CONNECT_TIMEOUT_MS);

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
        console.warn('[probing] connect failed', {
          phase: 'connecting',
          source,
          elapsed_ms: Date.now() - startedWallAt,
          connecting_ms: Date.now() - connectArmedAt,
          error: e instanceof Error ? e.message : String(e),
        });
        setError(e instanceof Error ? e.message : 'webrtc_failed');
        endReasonRef.current = 'error';
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
      phaseRef.current = 'idle';
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
    [cleanup, handleOaiEvent, renewSession, startRecorder, status],
  );

  // unmount 시 누수 방지. 세션이 살아 있으면 정리.
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    status,
    segments,
    error,
    renewing,
    sessionId,
    recording,
    start,
    stop,
  };
}

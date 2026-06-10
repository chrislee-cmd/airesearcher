'use client';

// AI 동시통역 — host console.
//
// Lifecycle: idle → starting → live → ending → ended
//
// On "Start" we:
//   1. POST /api/translate/sessions (server returns a Gemini Live ephemeral
//      auth token + LiveKit host token + room name)
//   2. getUserMedia({ audio })
//   3. Open the Gemini Live Bidi WebSocket directly from the browser,
//      authenticated with the ephemeral token.
//      - mic → AudioWorklet downsamples to PCM 16 kHz int16 → send via
//        sendRealtimeInput({ audio })
//      - server emits translated audio (PCM 24 kHz) on serverContent.modelTurn,
//        and source + target transcripts on serverContent.inputTranscription /
//        outputTranscription
//   4. Connect to LiveKit room, publish original ("input") and translated
//      ("output") audio tracks so viewers can subscribe to whichever they
//      want (mutually exclusive on the viewer side).
//   5. Open Supabase Realtime broadcast channel "live:<sessionId>" to send
//      caption deltas / commits to viewer pages.
//   6. POST finalized transcript segments to /messages so late-joining
//      viewers can backfill via RPC.
//
// On "Stop": tear down in reverse + POST /sessions/:id/end.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Room, LocalAudioTrack } from 'livekit-client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  ActivityHandling,
  GoogleGenAI,
  Modality,
  type LiveServerMessage,
  type Session as GeminiSession,
} from '@google/genai';
import { createClient as createBrowserSupabase } from '@/lib/supabase/client';
import { Checkbox } from './ui/checkbox';
import { ChromeButton } from './ui/chrome-button';
import { IconButton } from './ui/icon-button';

// Gemini Live audio constants — input + output sample rates are fixed by
// the protocol. Output is 24 kHz mono PCM int16; input must be 16 kHz mono
// PCM int16. AudioWorklet (PCM_ENCODER_SOURCE) handles the downsample.
const GEMINI_INPUT_SAMPLE_RATE = 16000;
const GEMINI_OUTPUT_SAMPLE_RATE = 24000;

type Status = 'idle' | 'starting' | 'live' | 'ending' | 'ended' | 'error';

// All paths that tear the session down. Logged via `console.info` so
// stray reconnect cycles in production can be traced back to a
// specific caller without re-deploying with extra instrumentation.
type CleanupCaller =
  | 'start_error_session'
  | 'start_error_mic'
  | 'start_error_livekit'
  | 'start_error_websocket'
  | 'start_reentry_guard'
  | 'stop'
  | 'unmount';

// Recording lifecycle, mirrored from supabase/migrations/0023.
// `null` = no row yet (host opted out, or session hasn't reached the
// finalize step yet).
type RecordingRow = {
  id: string;
  status: 'recording' | 'uploaded' | 'unlocked' | 'failed';
  size_bytes: number | null;
  duration_sec: number | null;
  credits_spent: number;
  unlocked_at: string | null;
  created_at: string;
};

const RECORDING_UNLOCK_CREDITS = 25;
const RECORDING_CHUNK_MS = 5000; // 5s timeslice — modest memory use, good resilience

type CaptionLine = {
  id: string;
  text: string;
  final: boolean;
  // Wall-clock ms when this line was last touched. Used by the prompter
  // view to keep only the last 30 seconds of content on screen — older
  // lines fade out at the top edge but remain in state so PR-B can
  // download the full transcript.
  ts: number;
};

// Display-only rolling window. Older lines are still in state (and on
// the DB via /messages) but the prompter pane only shows the most
// recent N seconds. 30s reads naturally for a teleprompter — long
// enough that a slow speaker still has context, short enough that the
// active line stays in the visual center.
const PROMPTER_WINDOW_MS = 30_000;

// Drop a freshly-finalized caption line if its punctuation/whitespace-
// normalized form matches a final line committed within this window.
// We have seen translation pipelines restart mid-session and spin up a
// second session that retranscribes the same audio with slightly
// different tokenization (e.g. comma added/removed). The dedup window
// keeps those copies off the prompter without blocking genuine repeats
// spoken minutes apart.
const DEDUP_WINDOW_MS = 60_000;

// Strip whitespace + Unicode punctuation/symbols so different
// tokenizations of the same utterance collide on the dedup key.
function normalizeForDedup(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
}

// Approximate same-utterance match. Catches translation refinement
// passes that exact-match dedup misses — e.g. "이걸" → "그걸",
// "5천 엔" → "오천 엔", or Korean numeral/synonym substitutions where
// only 1-2 characters differ across passes. Tunables:
//
// - FUZZY_LENGTH_TOLERANCE: skip the (expensive) edit distance step
//   if lengths differ by more than 30% — guards against false positives
//   on legitimately different short utterances ("네." vs "아니요.").
// - FUZZY_RATIO_THRESHOLD: 0.2 means "≤ 20% of characters different".
//   Tested against captured prod variants where 1-2 char substitution
//   should match but full word changes (different utterance) should not.
// - LEVENSHTEIN_CAP: defensive bail on pathological lengths. Real
//   normalized keys land well under this.
const FUZZY_LENGTH_TOLERANCE = 0.3;
const FUZZY_RATIO_THRESHOLD = 0.2;
const LEVENSHTEIN_CAP = 400;

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  if (al > LEVENSHTEIN_CAP || bl > LEVENSHTEIN_CAP) {
    // Unlikely; bail with max distance so the caller treats as not-a-dup.
    return Math.max(al, bl);
  }
  const prev = new Array<number>(bl + 1);
  const curr = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      curr[j] = del < ins ? (del < sub ? del : sub) : ins < sub ? ins : sub;
    }
    for (let j = 0; j <= bl; j++) prev[j] = curr[j];
  }
  return prev[bl];
}

function isFuzzyDup(candidate: string, prior: string): boolean {
  if (candidate === prior) return true;
  const cl = candidate.length;
  const pl = prior.length;
  if (cl === 0 || pl === 0) return false;
  const lengthDiff = Math.abs(cl - pl) / Math.max(cl, pl);
  if (lengthDiff > FUZZY_LENGTH_TOLERANCE) return false;
  const dist = levenshtein(candidate, prior);
  return dist / Math.max(cl, pl) <= FUZZY_RATIO_THRESHOLD;
}

// Containment dedup. Real-time STT can re-emit the same utterance with
// different chunking — once as a flurry of comma-separated short
// segments, once as a single concatenated long line. Length diff is too large for the
// fuzzy check (it short-circuits at 30%), but one is a substring of
// the other. Minimum length guard so short common phrases like "네." or
// "그래서" don't false-match against any longer line that happens to
// contain them.
// Script-aware containment minimum. CJK (Hangul / Hiragana / Katakana
// / CJK Unified) packs 2-3x the semantic weight per character vs
// Latin, so a 5-char CJK fragment ("잠깐 시간이", "바로 효과") is a
// phrase while a 5-char Latin substring ("after", "basic") shows up
// in unrelated sentences. Production trace showed Latin output
// dedup'ing legitimately distinct utterances ("So after building the
// basic system", "The decision I agonized over") because they share
// short Latin runs — text would briefly appear in the prompter and
// then vanish as the dedup orphan-filter pulled the partial. Use 5
// for CJK content, 15 for Latin so common phrases like "the basic"
// don't trigger false positives.
const CONTAINMENT_MIN_LEN_CJK = 5;
const CONTAINMENT_MIN_LEN_LATIN = 15;

function hasCJK(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0xAC00 && code <= 0xD7A3) || // Hangul syllables
      (code >= 0x4E00 && code <= 0x9FFF) || // CJK Unified Ideographs
      (code >= 0x3040 && code <= 0x309F) || // Hiragana
      (code >= 0x30A0 && code <= 0x30FF)    // Katakana
    ) {
      return true;
    }
  }
  return false;
}

function isContainmentDup(candidate: string, prior: string): boolean {
  const cl = candidate.length;
  const pl = prior.length;
  if (cl === 0 || pl === 0) return false;
  const shorter = cl < pl ? candidate : prior;
  const longer = cl < pl ? prior : candidate;
  // Pick the script-appropriate threshold based on the SHORTER side
  // since it's the one constrained against false matches. Mixed scripts
  // (e.g. Korean caption with a Latin brand name) default to the CJK
  // threshold since they're more likely meaningful phrases.
  const minLen = hasCJK(shorter) ? CONTAINMENT_MIN_LEN_CJK : CONTAINMENT_MIN_LEN_LATIN;
  if (shorter.length < minLen) return false;
  return longer.includes(shorter);
}

// Longest-common-substring dedup. Containment requires one full string
// to be inside the other, but live translation models also emit
// paraphrased refinements where the prefix changes ("구체적인 계기는
// 역시 피부 트러블이었고, 출산 이후의 고민, 피부 고민이었죠." vs
// "예를 들면, 출산 이후의 고민, 피부 고민이었죠.") — neither contains
// the other, but they share a long contiguous tail. Catching this requires
// inspecting the longest contiguous run of matching characters between
// the two normalized keys.
//
// Script-aware LCS minimum. 10 chars in Korean is roughly a 5-syllable
// phrase ("출산 이후의 고민") that two genuinely different utterances
// rarely share verbatim. The same 10 chars in English is "the basic"
// or "I want to" — common across countless unrelated sentences. The
// production failure mode was clearest here: distinct English commits
// kept matching each other on LCS, the orphan filter wiped them, and
// users watched their translated lines vanish mid-typing. Latin needs
// a much higher bar.
const LCS_MIN_LEN_CJK = 10;
const LCS_MIN_LEN_LATIN = 28;

function longestCommonSubstring(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0 || bl === 0) return 0;
  if (al > LEVENSHTEIN_CAP || bl > LEVENSHTEIN_CAP) return 0;
  let max = 0;
  let prev = new Array<number>(bl + 1).fill(0);
  let curr = new Array<number>(bl + 1).fill(0);
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      if (a.charCodeAt(i - 1) === b.charCodeAt(j - 1)) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > max) max = curr[j];
      } else {
        curr[j] = 0;
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return max;
}

function isLcsChunkDup(candidate: string, prior: string): boolean {
  // Use the looser CJK threshold if either side is CJK; require both
  // sides clear it. For pure Latin pairs, use the stricter Latin
  // threshold so common phrasing doesn't generate false dedups.
  const minLen =
    hasCJK(candidate) || hasCJK(prior) ? LCS_MIN_LEN_CJK : LCS_MIN_LEN_LATIN;
  if (candidate.length < minLen || prior.length < minLen) return false;
  return longestCommonSubstring(candidate, prior) >= minLen;
}

type SessionBundle = {
  session: {
    id: string;
    source_lang: string;
    target_lang: string;
    livekit_room: string;
    record_enabled: boolean;
  };
  gemini: {
    model: string;
    // `client_secret.value` is the ephemeral auth-token resource name
    // (e.g. "auth_tokens/abc...") returned by the server. The browser
    // passes it as the SDK's apiKey to open a v1alpha Live WebSocket.
    client_secret: { value: string; expires_at: number };
  };
  livekit: { url: string; token: string; room: string };
};

const LANGS: { value: string; label: string }[] = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'th', label: 'ไทย' },
  { value: 'zh', label: '中文' },
  { value: 'es', label: 'Español' },
];

// Heuristic sentence boundary used to split the Gemini Live transcript
// delta stream into committable caption lines. Transcript events arrive
// independently of model-turn boundaries, so we commit on punctuation
// and treat everything between boundaries as the rolling in-flight line.
const SENTENCE_END = /([.!?。！？]+|[。…?])(\s+|$)/;

function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

// AudioWorklet that decimates mic samples (whatever the host AudioContext
// rate, typically 48 kHz) down to 16 kHz int16 and posts 100 ms frames
// back to the main thread for sendRealtimeInput. Loaded via Blob URL so
// the worklet stays co-located with the consumer.
const PCM_ENCODER_SOURCE = `
class PcmEncoderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.ratio = sampleRate / this.targetRate;
    this.acc = 0;
    this.buf = [];
    this.flushAt = 1600; // ~100ms @ 16kHz
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch0 = input[0];
    if (!ch0) return true;
    for (let i = 0; i < ch0.length; i++) {
      this.acc += 1;
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio;
        let s = ch0[i];
        if (s > 1) s = 1; else if (s < -1) s = -1;
        this.buf.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      }
    }
    if (this.buf.length >= this.flushAt) {
      const out = new Int16Array(this.buf);
      this.port.postMessage(out.buffer, [out.buffer]);
      this.buf = [];
    }
    return true;
  }
}
registerProcessor('pcm-encoder', PcmEncoderProcessor);
`;

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  // String.fromCharCode chokes on very large arrays; chunk it.
  const chunk = 0x8000;
  let s = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return btoa(s);
}

export function TranslateConsole() {
  const t = useTranslations('TranslateConsole');
  const locale = useLocale();

  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sourceLang, setSourceLang] = useState('ko');
  const [targetLang, setTargetLang] = useState('en');
  const [recordEnabled, setRecordEnabled] = useState(true);
  // 'mic' = host's microphone; 'tab' = a browser tab's audio
  // (e.g. a Zoom/Meet/Teams call running in another tab). Tab capture
  // goes through getDisplayMedia, which on every supported browser
  // requires a user gesture and a tab-picker UI, so we lock this to
  // the host's choice and only acquire when the host clicks Start.
  const [inputSource, setInputSource] = useState<'mic' | 'tab'>('mic');

  const [inputLines, setInputLines] = useState<CaptionLine[]>([]);
  const [outputLines, setOutputLines] = useState<CaptionLine[]>([]);
  const [elapsed, setElapsed] = useState(0);
  // Host can mute the local translation playback without dropping the
  // LiveKit publish — viewers still hear the translated TTS, the host
  // just doesn't get the echo into their own room. Default ON because
  // the host typically wants to verify the translation in real time.
  const [outputAudible, setOutputAudible] = useState(true);
  // `now` ticks once per second while live so the 30-second prompter
  // window slides forward continuously even when the transcript deltas
  // pause (e.g. the speaker takes a breath). Without this the screen
  // would freeze on stale text.
  const [now, setNow] = useState(() => Date.now());

  const [shareToken, setShareToken] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  // Recording state — null until POST /recording succeeds. After
  // stop(), `recording.status` flips to `uploaded` (CTA appears) and
  // then `unlocked` after the credit charge (download buttons appear).
  const [recording, setRecording] = useState<RecordingRow | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  // Four downloadable formats now: two audio tracks (source-only,
  // translated-only) + two transcript zips (source-only "원문" and
  // translation-only "통역본", each bundling .txt + .docx). One unlock
  // covers all four — pricing didn't change.
  const [downloadingFormat, setDownloadingFormat] = useState<
    'm4a-input' | 'm4a-output' | 'zip-input' | 'zip-output' | null
  >(null);
  // Whether the MediaRecorder is actively capturing. Driven from the
  // recorder's onstart/onstop events so the indicator pill renders
  // without needing to read the ref during render.
  const [recorderActive, setRecorderActive] = useState(false);

  // Mutable refs held only for the duration of a live session.
  //
  // Gemini Live uses a WebSocket (Bidi protocol) instead of a WebRTC peer
  // connection. The SDK's Session object encapsulates that WS — we send
  // PCM audio via session.sendRealtimeInput and receive serverContent
  // messages via the onmessage callback we register at connect time.
  const geminiSessionRef = useRef<GeminiSession | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const outputPublishedRef = useRef(false);
  // Two AudioContexts so each side runs at its native sample rate
  // (no resampling through the Web Audio graph):
  //   inputCtx  — host system rate; AudioWorklet (pcm-encoder) decimates
  //               mic samples to 16 kHz int16 and posts them to the main
  //               thread for sendRealtimeInput.
  //   outputCtx — fixed at GEMINI_OUTPUT_SAMPLE_RATE so incoming PCM
  //               chunks copy straight into AudioBuffers without resample.
  const inputCtxRef = useRef<AudioContext | null>(null);
  const inputWorkletRef = useRef<AudioWorkletNode | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  // Playback scheduler for the translated PCM stream. Each incoming
  // chunk is decoded to a Float32 AudioBuffer and scheduled to start
  // immediately after the previous chunk ends, producing gap-less audio.
  // The shared GainNode feeds the monitor, LiveKit publish, and recording
  // destinations.
  const playbackGainRef = useRef<GainNode | null>(null);
  const playbackNextStartRef = useRef<number>(0);
  // LiveKit publish destination — translated PCM chain feeds this, and
  // its MediaStream is what the monitor <audio> element and LiveKit
  // LocalAudioTrack both read from.
  const audioDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const roomRef = useRef<Room | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const monitorAudioRef = useRef<HTMLAudioElement | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Rolling buffer for the currently-streaming caption line per side.
  // The translation API has no explicit completion event, so we keep one
  // mutable "current" entry per side and flush it whenever sentence-ending
  // punctuation arrives in the delta stream.
  const partialInputRef = useRef<Map<string, { id: string; text: string }>>(new Map());
  const partialOutputRef = useRef<Map<string, { id: string; text: string }>>(new Map());

  // Synchronous re-entry guard for start(). The status closure in start()
  // can be stale across rapid invocations (the captured `status` was
  // 'idle' even after setStatus('starting') was queued but not yet
  // applied). This ref is read+written in the same microtask so a second
  // start() entering before the first awaits cannot get past it.
  const startInFlightRef = useRef(false);

  // Dedup keys for finalized lines per kind. Sliding window — entries
  // older than DEDUP_WINDOW_MS are dropped on each insert so the map
  // never grows unbounded across a long session.
  const recentFinalsRef = useRef<Map<'input' | 'output', Array<{ key: string; ts: number }>>>(
    new Map([
      ['input', []],
      ['output', []],
    ]),
  );

  // Diagnostic sampler — bounded log of the first N Gemini Live messages
  // of each shape per session. The Bidi protocol emits incremental
  // transcripts independently of model turns, so we sample early events
  // to confirm whether deltas are incremental vs cumulative without
  // flooding the console on long sessions.
  const sampleCountRef = useRef<Map<string, number>>(new Map());
  const EVENT_SAMPLE_CAP = 8;

  // Recording graph — TWO dedicated MediaStreamDestinationNodes, one for
  // the host's source stream (mic/tab) and one for the translated TTS.
  // We do NOT reuse `audioDestRef` (which feeds LiveKit publish):
  // MediaRecorder reading the same destination as a simultaneous
  // LiveKit publish has produced silent/glitchy webm files in testing.
  //
  // Wiring:
  //   hostSrc (mic OR tab) → recordInputDestRef → MediaRecorder(input)
  //   ttsSrc (PCM playback) → recordOutputDestRef → MediaRecorder(output)
  //
  // recordInputDest lives on inputCtxRef; recordOutputDest lives on
  // outputCtxRef. The two recorders are started in the same microtask
  // after both graphs are wired so their wall-clock timelines align
  // within a few ms.
  const recordInputDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const recordOutputDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const recordInputSrcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const recordOutputSrcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mediaRecorderInputRef = useRef<MediaRecorder | null>(null);
  const mediaRecorderOutputRef = useRef<MediaRecorder | null>(null);
  const recordedInputChunksRef = useRef<Blob[]>([]);
  const recordedOutputChunksRef = useRef<Blob[]>([]);
  // One DB row owns BOTH tracks. The first POST creates it, the second
  // POST attaches the other kind to the same row.
  const recordingIdRef = useRef<string | null>(null);
  const recordingInputUploadUrlRef = useRef<string | null>(null);
  const recordingOutputUploadUrlRef = useRef<string | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);

  // Heartbeat ticker for elapsed display.
  useEffect(() => {
    if (status !== 'live') {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      return;
    }
    tickRef.current = setInterval(() => {
      const wall = Date.now();
      if (startedAtRef.current) {
        setElapsed(wall - startedAtRef.current);
      }
      // Keep the prompter window honest even when deltas pause.
      setNow(wall);
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [status]);

  // Monitor audio routing. `outputAudible` is the host's local mute
  // toggle: when OFF, the host's own <audio> element is muted but the
  // translated TTS keeps flowing through LiveKit so viewers still hear
  // it. We do NOT stop the publish — the gain node / track on the
  // outbound side stays untouched.
  useEffect(() => {
    if (!monitorAudioRef.current) return;
    monitorAudioRef.current.muted = !outputAudible;
  }, [outputAudible]);

  // `caller` is purely diagnostic — surfaces in the production log so we
  // can match a stray `disconnect from room` cycle back to whichever
  // path tore the session down (start error vs stop vs unmount vs
  // re-entry guard). No behaviour difference between values.
  const cleanup = useCallback((caller: CleanupCaller) => {
    console.info('[translate] cleanup', {
      caller,
      sessionId: sessionIdRef.current,
      hasRoom: !!roomRef.current,
      hasGemini: !!geminiSessionRef.current,
    });
    try {
      channelRef.current?.unsubscribe();
    } catch {}
    channelRef.current = null;
    try {
      geminiSessionRef.current?.close();
    } catch {}
    geminiSessionRef.current = null;
    micStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    micStreamRef.current = null;
    outputPublishedRef.current = false;
    try {
      inputWorkletRef.current?.disconnect();
    } catch {}
    inputWorkletRef.current = null;
    try {
      inputSourceRef.current?.disconnect();
    } catch {}
    inputSourceRef.current = null;
    try {
      playbackGainRef.current?.disconnect();
    } catch {}
    playbackGainRef.current = null;
    playbackNextStartRef.current = 0;
    audioDestRef.current = null;
    try {
      recordInputSrcRef.current?.disconnect();
    } catch {}
    recordInputSrcRef.current = null;
    try {
      recordOutputSrcRef.current?.disconnect();
    } catch {}
    recordOutputSrcRef.current = null;
    recordInputDestRef.current = null;
    recordOutputDestRef.current = null;
    try {
      void inputCtxRef.current?.close();
    } catch {}
    inputCtxRef.current = null;
    try {
      void outputCtxRef.current?.close();
    } catch {}
    outputCtxRef.current = null;
    try {
      const recIn = mediaRecorderInputRef.current;
      if (recIn && recIn.state !== 'inactive') recIn.stop();
    } catch {}
    try {
      const recOut = mediaRecorderOutputRef.current;
      if (recOut && recOut.state !== 'inactive') recOut.stop();
    } catch {}
    mediaRecorderInputRef.current = null;
    mediaRecorderOutputRef.current = null;
    recordedInputChunksRef.current = [];
    recordedOutputChunksRef.current = [];
    recordingIdRef.current = null;
    recordingInputUploadUrlRef.current = null;
    recordingOutputUploadUrlRef.current = null;
    recordingStartedAtRef.current = null;
    setRecorderActive(false);
    if (roomRef.current) {
      void roomRef.current.disconnect();
      roomRef.current = null;
    }
    if (monitorAudioRef.current) {
      monitorAudioRef.current.srcObject = null;
    }
    partialInputRef.current.clear();
    partialOutputRef.current.clear();
  }, []);

  const pushLine = useCallback(
    (kind: 'input' | 'output', line: CaptionLine) => {
      const setter = kind === 'input' ? setInputLines : setOutputLines;
      setter((prev) => {
        const existing = prev.findIndex((l) => l.id === line.id);
        if (existing === -1) return [...prev, line];
        const next = prev.slice();
        next[existing] = line;
        return next;
      });
    },
    [],
  );

  const broadcastCaption = useCallback(
    (kind: 'input' | 'output', line: CaptionLine, lang: string) => {
      // The viewer prompter only renders translated output, so input
      // captions don't need to traverse the broadcast channel — saves
      // bandwidth on long sessions. They're still persisted via
      // /messages below so PR-B can offer a bilingual download.
      if (kind === 'input') return;
      channelRef.current
        ?.send({
          type: 'broadcast',
          event: 'caption',
          payload: { kind, id: line.id, text: line.text, final: line.final, lang },
        })
        .catch(() => {});
    },
    [],
  );

  const persistMessage = useCallback(
    async (kind: 'input' | 'output', text: string, lang: string) => {
      const id = sessionIdRef.current;
      if (!id) return;
      try {
        await fetch(`/api/translate/sessions/${id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, text, lang }),
        });
      } catch {
        // Best-effort. Caption is already on the broadcast channel.
      }
    },
    [],
  );

  const appendStreaming = useCallback(
    (kind: 'input' | 'output', delta: string, lang: string) => {
      if (!delta) return;
      const partial = kind === 'input' ? partialInputRef : partialOutputRef;
      const wall = Date.now();
      // Reuse a single rolling line id per kind, replaced when a sentence
      // boundary commits.
      const current = partial.current.get('current') ?? { id: `${kind}-${wall}`, text: '' };
      const next = current.text + delta;
      const match = next.match(SENTENCE_END);
      if (match && match.index !== undefined) {
        const cut = match.index + match[1].length;
        const finalText = next.slice(0, cut).trim();
        const remainder = next.slice(cut).trim();
        if (finalText) {
          // Dedup against recent finals (see DEDUP_WINDOW_MS comment).
          // We normalize punctuation+whitespace because successive OpenAI
          // sessions tokenize the same utterance slightly differently
          // (a comma appearing or vanishing between runs is the typical
          // diff). The DISPLAY text stays original — only the lookup key
          // is normalized.
          const dedupKey = normalizeForDedup(finalText);
          const bucket = recentFinalsRef.current.get(kind) ?? [];
          const fresh = bucket.filter((e) => wall - e.ts <= DEDUP_WINDOW_MS);
          // PR #224 dedup stack — applied in order:
          //   1. Fuzzy (Levenshtein ratio ≤ 20%) — catches single-char
          //      substitutions like "이걸" → "그걸".
          //   2. Containment — catches the case where OpenAI emits the
          //      same utterance once as N short comma-separated commits
          //      and again as one long concatenated commit. The shorter
          //      side must clear CONTAINMENT_MIN_LEN to avoid common
          //      short phrases ("네.") wrongly matching against any
          //      longer line that contains them.
          const isDup =
            dedupKey.length > 0 &&
            fresh.some(
              (e) =>
                isFuzzyDup(dedupKey, e.key) ||
                isContainmentDup(dedupKey, e.key) ||
                isLcsChunkDup(dedupKey, e.key),
            );
          if (isDup) {
            console.info('[translate] dedup', {
              kind,
              preview: finalText.slice(0, 40),
            });
            // The partial that was about to be finalized lives in
            // {input,output}Lines as a non-final preview row (rendered
            // with the trailing "…"). Skipping the commit also means
            // skipping the pushLine that would have replaced it with
            // final=true — without this cleanup it stays as an
            // orphaned partial row forever, and the prompter slowly
            // fills with greyed "…" copies of every deduped utterance.
            // Drop it now so the prompter only shows what we actually
            // commit.
            const setter = kind === 'input' ? setInputLines : setOutputLines;
            setter((prev) => prev.filter((l) => l.id !== current.id));
          } else {
            fresh.push({ key: dedupKey, ts: wall });
            recentFinalsRef.current.set(kind, fresh);
            const finalLine: CaptionLine = { id: current.id, text: finalText, final: true, ts: wall };
            pushLine(kind, finalLine);
            broadcastCaption(kind, finalLine, lang);
            void persistMessage(kind, finalText, lang);
          }
        }
        if (remainder) {
          const nextId = `${kind}-${wall}`;
          partial.current.set('current', { id: nextId, text: remainder });
          const partialLine: CaptionLine = { id: nextId, text: remainder, final: false, ts: wall };
          pushLine(kind, partialLine);
          broadcastCaption(kind, partialLine, lang);
        } else {
          partial.current.delete('current');
        }
      } else {
        partial.current.set('current', { id: current.id, text: next });
        const partialLine: CaptionLine = { id: current.id, text: next, final: false, ts: wall };
        pushLine(kind, partialLine);
        broadcastCaption(kind, partialLine, lang);
      }
    },
    [broadcastCaption, persistMessage, pushLine],
  );

  // Decode a base64 PCM (int16, little-endian) chunk into a Float32Array
  // for AudioBuffer.copyToChannel.
  const decodeBase64Pcm = useCallback((b64: string): Float32Array<ArrayBuffer> => {
    const bin = atob(b64);
    const len = bin.length;
    const i16 = new Int16Array(len >> 1);
    // Walk bytes pairwise; little-endian int16.
    for (let i = 0, j = 0; i + 1 < len; i += 2, j++) {
      const lo = bin.charCodeAt(i);
      const hi = bin.charCodeAt(i + 1);
      const v = (hi << 8) | lo;
      i16[j] = v >= 0x8000 ? v - 0x10000 : v;
    }
    // Concretely back the Float32Array with an ArrayBuffer (not
    // SharedArrayBuffer) so `AudioBuffer.copyToChannel` accepts it
    // under TS lib.dom strict mode.
    const f32 = new Float32Array(new ArrayBuffer(i16.length * 4));
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 0x8000;
    return f32;
  }, []);

  // Schedule a translated-audio chunk on the playback graph. Each chunk
  // starts immediately after the prior one ended so playback is gapless
  // even when the transport delivers bursts. Anything that should hear
  // the translated audio (monitor <audio>, LiveKit publish, recording)
  // taps `playbackGainRef`.
  const playPcmChunk = useCallback(
    (b64: string) => {
      const ctx = outputCtxRef.current;
      const gain = playbackGainRef.current;
      if (!ctx || !gain) return;
      const f32 = decodeBase64Pcm(b64);
      if (f32.length === 0) return;
      const buf = ctx.createBuffer(1, f32.length, GEMINI_OUTPUT_SAMPLE_RATE);
      buf.copyToChannel(f32, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(gain);
      const startAt = Math.max(ctx.currentTime + 0.02, playbackNextStartRef.current);
      src.start(startAt);
      playbackNextStartRef.current = startAt + buf.duration;
    },
    [decodeBase64Pcm],
  );

  const handleGeminiMessage = useCallback(
    (msg: LiveServerMessage) => {
      // Diagnostic sampler — see sampleCountRef comment. We classify
      // each message by the first content field present so the sampler
      // shows the shape of typical traffic (modelTurn / inputTranscription
      // / outputTranscription / setupComplete / interrupted / goAway).
      const sc = msg.serverContent;
      const sampleKey = msg.setupComplete
        ? 'setupComplete'
        : sc?.inputTranscription
          ? 'inputTranscription'
          : sc?.outputTranscription
            ? 'outputTranscription'
            : sc?.modelTurn
              ? 'modelTurn'
              : sc?.turnComplete
                ? 'turnComplete'
                : sc?.interrupted
                  ? 'interrupted'
                  : msg.goAway
                    ? 'goAway'
                    : '<other>';
      const seen = sampleCountRef.current.get(sampleKey) ?? 0;
      if (seen < EVENT_SAMPLE_CAP) {
        sampleCountRef.current.set(sampleKey, seen + 1);
        console.info('[translate] gemini-event', {
          n: seen + 1,
          kind: sampleKey,
          payload: msg,
        });
      }

      if (!sc) return;

      // Source-language transcript — auto-detected by the model from the
      // mic audio when inputAudioTranscription is set at session create.
      if (sc.inputTranscription?.text) {
        appendStreaming('input', sc.inputTranscription.text, sourceLang);
      }
      // Translated text — aligned with the synthesised output audio
      // when outputAudioTranscription is set at session create.
      if (sc.outputTranscription?.text) {
        appendStreaming('output', sc.outputTranscription.text, targetLang);
      }
      // Translated audio — base64 PCM int16 chunks at
      // GEMINI_OUTPUT_SAMPLE_RATE, delivered as inlineData parts on the
      // model turn. We schedule them on the playback graph which feeds
      // monitor, LiveKit, and recording in one shot.
      const parts = sc.modelTurn?.parts;
      if (parts && parts.length > 0) {
        for (const part of parts) {
          const data = part.inlineData?.data;
          if (data) playPcmChunk(data);
        }
      }
      // `sc.interrupted` from the server means the model abandoned the
      // current turn — clear the scheduled playback time so the next
      // chunk plays immediately instead of waiting for the cancelled
      // tail to finish.
      if (sc.interrupted) {
        playbackNextStartRef.current = 0;
      }
    },
    [appendStreaming, playPcmChunk, sourceLang, targetLang],
  );

  const start = useCallback(async () => {
    // Two-layer guard: (1) the status closure may be stale across rapid
    // invocations (React batches the setStatus('starting') below so a
    // second click within the same microtask still sees 'idle'); (2) the
    // ref check is synchronous and survives any closure staleness, so it
    // is the actual stopgap against concurrent start() calls.
    if (startInFlightRef.current) {
      console.info('[translate] start re-entry blocked (in-flight)');
      return;
    }
    if (status === 'live' || status === 'starting') return;
    startInFlightRef.current = true;
    // RESET dedup memory on every Start. We tried persisting across
    // Stop+Start (commit bc07d6b) to suppress duplicate commits when
    // the user re-transcribed the tail of the previous session, but
    // that backfired in practice: a heavy testing loop pollutes the
    // memory with phrases from prior sessions, and the next session's
    // legitimate first commit gets caught against those stale entries.
    // Net effect was a black-hole prompter — every utterance matched
    // something old, nothing landed. The cross-session dedup case is
    // rare in production (users don't stop+start within seconds), so
    // we revert to the simpler "fresh memory per session" semantics.
    recentFinalsRef.current.set('input', []);
    recentFinalsRef.current.set('output', []);
    // Reset event sampler too — each session gets a fresh budget so we
    // see the protocol shape from t=0 of every recording.
    sampleCountRef.current.clear();
    setError(null);
    setInputLines([]);
    setOutputLines([]);
    setElapsed(0);
    setShareToken(null);
    setShareCopied(false);
    // Reset recording UI for the new session — last session's locked CTA
    // (if any) should disappear the moment the host hits Start.
    setRecording(null);
    setRecordingError(null);
    setUnlocking(false);
    setDownloadingFormat(null);
    setStatus('starting');

    let bundle: SessionBundle;
    try {
      const res = await fetch('/api/translate/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_lang: sourceLang,
          target_lang: targetLang,
          record_enabled: recordEnabled,
        }),
      });
      const json = (await res.json()) as SessionBundle | { error: string };
      if (!res.ok || 'error' in json) {
        throw new Error((json as { error: string }).error ?? 'session_failed');
      }
      bundle = json;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'session_failed');
      setStatus('error');
      startInFlightRef.current = false;
      return;
    }

    sessionIdRef.current = bundle.session.id;

    // Source stream — either the host's microphone or a captured
    // browser tab's audio (Zoom/Meet/Teams running in another tab).
    // `mic` keeps the variable name because the rest of the pipeline
    // (LiveKit "input" publish, OpenAI WebRTC addTrack, cleanup via
    // micStreamRef) doesn't care which kind of capture it is.
    let mic: MediaStream;
    try {
      if (inputSource === 'tab') {
        // getDisplayMedia requires a video constraint on every browser
        // that supports tab-audio capture; we ask for the cheapest
        // surface (browser tab) and immediately stop the video track
        // since we never render or upload it.
        const display = await navigator.mediaDevices.getDisplayMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
          video: { displaySurface: 'browser' },
        });
        display.getVideoTracks().forEach((tr) => tr.stop());
        const audioTracks = display.getAudioTracks();
        if (audioTracks.length === 0) {
          // The host picked a surface but didn't enable "Share tab
          // audio" in the picker — or the platform doesn't support
          // it (Safari, most mobile browsers). Without an audio
          // track there's nothing to translate, so surface a
          // dedicated error instead of silently going live.
          display.getTracks().forEach((tr) => tr.stop());
          setError('tab_audio_unavailable');
          setStatus('error');
          startInFlightRef.current = false;
          return;
        }
        mic = new MediaStream(audioTracks);
      } else {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    } catch {
      setError(inputSource === 'tab' ? 'tab_audio_denied' : 'microphone_denied');
      setStatus('error');
      startInFlightRef.current = false;
      return;
    }
    micStreamRef.current = mic;

    // LiveKit FIRST — connect and publish the mic so viewers have
    // something to subscribe to right away. The translated output track
    // is published below, immediately after we wire the playback graph,
    // because Gemini Live emits PCM continuously and the graph (not the
    // network) is the source of truth for "an output track exists."
    outputPublishedRef.current = false;
    try {
      const room = new Room({ adaptiveStream: true, dynacast: true });
      await room.connect(bundle.livekit.url, bundle.livekit.token);
      roomRef.current = room;
      const inputTrack = new LocalAudioTrack(mic.getAudioTracks()[0]);
      await room.localParticipant.publishTrack(inputTrack, { name: 'input' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'livekit_failed');
      setStatus('error');
      cleanup('start_error_livekit');
      startInFlightRef.current = false;
      return;
    }

    // ── Output audio plumbing (translated TTS → monitor + LiveKit + recording) ──
    //
    // outputCtx runs at GEMINI_OUTPUT_SAMPLE_RATE so AudioBuffers built from
    // incoming PCM chunks copy in without resampling. A single GainNode is
    // the fan-out point: monitor <audio>, LiveKit publish, and the output
    // recorder all tap from it.
    type WebkitWindow = Window & typeof globalThis & {
      webkitAudioContext?: typeof AudioContext;
    };
    const w = window as WebkitWindow;
    const AudioCtx = w.AudioContext ?? w.webkitAudioContext;
    if (!AudioCtx) {
      setError('audio_unsupported');
      setStatus('error');
      cleanup('start_error_websocket');
      startInFlightRef.current = false;
      return;
    }
    let outputCtx: AudioContext;
    let playbackGain: GainNode;
    let outputDest: MediaStreamAudioDestinationNode;
    try {
      outputCtx = new AudioCtx({ sampleRate: GEMINI_OUTPUT_SAMPLE_RATE });
      outputCtxRef.current = outputCtx;
      // start() is in the click handler's microtask, but the context can
      // still come up suspended in stricter engines. resume() is
      // best-effort: if it rejects we still publish.
      if (outputCtx.state === 'suspended') {
        void outputCtx.resume().catch((err) => {
          console.warn('[translate] outputCtx.resume failed', err);
        });
      }
      playbackGain = outputCtx.createGain();
      playbackGainRef.current = playbackGain;
      outputDest = outputCtx.createMediaStreamDestination();
      audioDestRef.current = outputDest;
      playbackGain.connect(outputDest);
      playbackNextStartRef.current = 0;

      if (monitorAudioRef.current) {
        monitorAudioRef.current.srcObject = outputDest.stream;
        monitorAudioRef.current.muted = !outputAudible;
        monitorAudioRef.current.play().catch(() => {});
      }

      const localTtsTrack = outputDest.stream.getAudioTracks()[0];
      if (localTtsTrack && roomRef.current) {
        outputPublishedRef.current = true;
        const outputTrack = new LocalAudioTrack(localTtsTrack);
        roomRef.current.localParticipant
          .publishTrack(outputTrack, { name: 'output' })
          .then(() => {
            console.info(
              `[translate] output PUBLISHED — ctxState=${outputCtx.state}, ` +
                `localTrackMuted=${localTtsTrack.muted}`,
            );
          })
          .catch((err) => {
            console.warn('[translate] output publish FAILED', err);
            outputPublishedRef.current = false;
          });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'audio_failed');
      setStatus('error');
      cleanup('start_error_websocket');
      startInFlightRef.current = false;
      return;
    }

    // ── Recording graph (split source vs. translated) ──
    // Each recorder reads its own MediaStreamDestinationNode so neither
    // contends with the live LiveKit publish. The output recorder lives
    // on outputCtx; the input recorder lives on inputCtx (constructed
    // immediately below).
    let inputCtx: AudioContext;
    try {
      inputCtx = new AudioCtx();
      inputCtxRef.current = inputCtx;
      if (inputCtx.state === 'suspended') {
        void inputCtx.resume().catch((err) => {
          console.warn('[translate] inputCtx.resume failed', err);
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'audio_failed');
      setStatus('error');
      cleanup('start_error_websocket');
      startInFlightRef.current = false;
      return;
    }

    if (recordEnabled) {
      try {
        let mimeType = 'audio/webm;codecs=opus';
        if (typeof MediaRecorder !== 'undefined') {
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'audio/webm';
          }
          if (MediaRecorder.isTypeSupported(mimeType)) {
            const inputRecDest = inputCtx.createMediaStreamDestination();
            recordInputDestRef.current = inputRecDest;
            const hostRecSrc = inputCtx.createMediaStreamSource(mic);
            recordInputSrcRef.current = hostRecSrc;
            hostRecSrc.connect(inputRecDest);

            const outputRecDest = outputCtx.createMediaStreamDestination();
            recordOutputDestRef.current = outputRecDest;
            playbackGain.connect(outputRecDest);

            const recIn = new MediaRecorder(inputRecDest.stream, { mimeType });
            const recOut = new MediaRecorder(outputRecDest.stream, { mimeType });
            mediaRecorderInputRef.current = recIn;
            mediaRecorderOutputRef.current = recOut;
            recordedInputChunksRef.current = [];
            recordedOutputChunksRef.current = [];

            recIn.ondataavailable = (ev) => {
              if (ev.data && ev.data.size > 0) {
                recordedInputChunksRef.current.push(ev.data);
              }
            };
            recOut.ondataavailable = (ev) => {
              if (ev.data && ev.data.size > 0) {
                recordedOutputChunksRef.current.push(ev.data);
              }
            };
            const fail = () => {
              setRecordingError('recorder_failed');
              setRecorderActive(false);
            };
            recIn.onerror = fail;
            recOut.onerror = fail;
            recIn.onstart = () => setRecorderActive(true);
            recOut.onstart = () => setRecorderActive(true);
            const maybeIdle = () => {
              const a = mediaRecorderInputRef.current;
              const b = mediaRecorderOutputRef.current;
              if ((!a || a.state === 'inactive') && (!b || b.state === 'inactive')) {
                setRecorderActive(false);
              }
            };
            recIn.onstop = maybeIdle;
            recOut.onstop = maybeIdle;
            recIn.start(RECORDING_CHUNK_MS);
            recOut.start(RECORDING_CHUNK_MS);
            recordingStartedAtRef.current = Date.now();

            const sid = sessionIdRef.current;
            if (sid) {
              (async () => {
                try {
                  const r1 = await fetch(
                    `/api/translate/sessions/${sid}/recording`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ kind: 'output' }),
                    },
                  );
                  if (!r1.ok) throw new Error('reserve_failed');
                  const j1 = (await r1.json()) as {
                    recording_id: string;
                    upload_url: string;
                  };
                  recordingIdRef.current = j1.recording_id;
                  recordingOutputUploadUrlRef.current = j1.upload_url;

                  const r2 = await fetch(
                    `/api/translate/sessions/${sid}/recording`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ kind: 'input' }),
                    },
                  );
                  if (!r2.ok) throw new Error('reserve_failed');
                  const j2 = (await r2.json()) as {
                    recording_id: string;
                    upload_url: string;
                  };
                  recordingIdRef.current = j2.recording_id;
                  recordingInputUploadUrlRef.current = j2.upload_url;
                } catch {
                  setRecordingError('reserve_failed');
                }
              })();
            }
          }
        }
      } catch {
        setRecordingError('recorder_failed');
      }
    }

    // ── Mic capture → AudioWorklet PCM encoder → Gemini WebSocket ──
    let workletNode: AudioWorkletNode;
    try {
      const workletBlob = new Blob([PCM_ENCODER_SOURCE], {
        type: 'application/javascript',
      });
      const workletUrl = URL.createObjectURL(workletBlob);
      try {
        await inputCtx.audioWorklet.addModule(workletUrl);
      } finally {
        URL.revokeObjectURL(workletUrl);
      }
      const micSrc = inputCtx.createMediaStreamSource(mic);
      inputSourceRef.current = micSrc;
      workletNode = new AudioWorkletNode(inputCtx, 'pcm-encoder');
      inputWorkletRef.current = workletNode;
      micSrc.connect(workletNode);
      // Worklets need a downstream node for `process()` to be scheduled
      // in some engines; route through a zero-gain to keep the graph
      // active without producing audible output on the speakers.
      const silentSink = inputCtx.createGain();
      silentSink.gain.value = 0;
      workletNode.connect(silentSink);
      silentSink.connect(inputCtx.destination);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'audio_failed');
      setStatus('error');
      cleanup('start_error_websocket');
      startInFlightRef.current = false;
      return;
    }

    // ── Open the Gemini Live WebSocket ──
    // The browser passes the ephemeral auth-token resource name as
    // apiKey; the SDK auto-routes to v1alpha + access_token= for it.
    // The session config is locked server-side via liveConnectConstraints
    // (see src/lib/gemini-live.ts), so we re-state it here only because
    // the SDK still requires `model` + `config` at connect time.
    try {
      const ai = new GoogleGenAI({
        apiKey: bundle.gemini.client_secret.value,
        apiVersion: 'v1alpha',
      });
      const session = await ai.live.connect({
        model: bundle.gemini.model,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          translationConfig: {
            targetLanguageCode: targetLang,
            echoTargetLanguage: false,
          },
          realtimeInputConfig: {
            activityHandling: ActivityHandling.NO_INTERRUPTION,
          },
        },
        callbacks: {
          onopen: () => {
            console.info('[translate] gemini ws open');
          },
          onmessage: (msg: LiveServerMessage) => handleGeminiMessage(msg),
          onerror: (err) => {
            console.warn('[translate] gemini ws error', err);
          },
          onclose: (ev) => {
            console.info('[translate] gemini ws closed', {
              code: ev?.code,
              reason: ev?.reason,
            });
          },
        },
      });
      geminiSessionRef.current = session;

      // The worklet has been emitting PCM frames since the moment it was
      // wired; route them to the open session now. Earlier frames were
      // simply dropped (port had no listener), which is fine — Gemini's
      // VAD doesn't care about the pre-connect tail.
      workletNode.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
        const session = geminiSessionRef.current;
        if (!session) return;
        try {
          session.sendRealtimeInput({
            audio: {
              data: arrayBufferToBase64(ev.data),
              mimeType: `audio/pcm;rate=${GEMINI_INPUT_SAMPLE_RATE}`,
            },
          });
        } catch (err) {
          console.warn('[translate] sendRealtimeInput failed', err);
        }
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : 'websocket_failed');
      setStatus('error');
      cleanup('start_error_websocket');
      startInFlightRef.current = false;
      return;
    }

    // Supabase broadcast channel
    const supa = createBrowserSupabase();
    const ch = supa.channel(`live:${bundle.session.id}`, {
      config: { broadcast: { self: false } },
    });
    ch.subscribe();
    channelRef.current = ch;

    // Flip status='live' on the row so anon viewers see it.
    void supa
      .from('translate_sessions')
      .update({ status: 'live', started_at: new Date().toISOString() })
      .eq('id', bundle.session.id);

    startedAtRef.current = Date.now();
    setStatus('live');
    startInFlightRef.current = false;
  }, [
    cleanup,
    handleGeminiMessage,
    inputSource,
    outputAudible,
    recordEnabled,
    sourceLang,
    targetLang,
    status,
  ]);

  // Stop one MediaRecorder cleanly and wait for the final dataavailable
  // tick. Returns the assembled Blob, or null if no chunks were recorded.
  const finalizeOneRecorder = useCallback(
    async (
      rec: MediaRecorder | null,
      chunks: Blob[],
    ): Promise<{ blob: Blob; durationSec: number } | null> => {
      if (!rec) return null;
      if (rec.state === 'inactive') {
        if (chunks.length === 0) return null;
      } else {
        await new Promise<void>((resolve) => {
          const done = () => {
            rec.removeEventListener('stop', done);
            resolve();
          };
          rec.addEventListener('stop', done);
          try {
            rec.stop();
          } catch {
            resolve();
          }
        });
      }
      if (chunks.length === 0) return null;
      const mimeType = chunks[0]?.type || 'audio/webm';
      const blob = new Blob(chunks, { type: mimeType });
      const start = recordingStartedAtRef.current ?? Date.now();
      const durationSec = Math.max(0, Math.round((Date.now() - start) / 1000));
      return { blob, durationSec };
    },
    [],
  );

  const uploadAndFinalizeRecording = useCallback(
    async (sessionId: string) => {
      // Stop and finalize both recorders in parallel — they share a
      // common start timestamp and the AudioContext is about to be
      // closed in cleanup(), so any delay here would clip the tail.
      const [inputFinal, outputFinal] = await Promise.all([
        finalizeOneRecorder(
          mediaRecorderInputRef.current,
          recordedInputChunksRef.current,
        ),
        finalizeOneRecorder(
          mediaRecorderOutputRef.current,
          recordedOutputChunksRef.current,
        ),
      ]);
      if (!inputFinal && !outputFinal) return;

      const recordingId = recordingIdRef.current;
      if (!recordingId) {
        setRecordingError('reserve_failed');
        return;
      }

      // Upload each track to its own signed URL, then PATCH (one PATCH
      // per track — server-side merges sizes and keeps the longer of
      // the two durations). Either side missing → recorder for that
      // side never ran; just skip it. The row still ends up
      // status='uploaded' so the unlock CTA appears.
      const tracks: Array<{
        label: 'input' | 'output';
        uploadUrl: string | null;
        finalized: { blob: Blob; durationSec: number } | null;
      }> = [
        {
          label: 'input',
          uploadUrl: recordingInputUploadUrlRef.current,
          finalized: inputFinal,
        },
        {
          label: 'output',
          uploadUrl: recordingOutputUploadUrlRef.current,
          finalized: outputFinal,
        },
      ];

      for (const t of tracks) {
        if (!t.finalized) continue;
        if (!t.uploadUrl) {
          setRecordingError('reserve_failed');
          continue;
        }
        try {
          const put = await fetch(t.uploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': t.finalized.blob.type || 'audio/webm',
            },
            body: t.finalized.blob,
          });
          if (!put.ok) {
            setRecordingError('upload_failed');
            continue;
          }
        } catch {
          setRecordingError('upload_failed');
          continue;
        }
        try {
          const patch = await fetch(
            `/api/translate/sessions/${sessionId}/recording`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                recording_id: recordingId,
                size_bytes: t.finalized.blob.size,
                duration_sec: t.finalized.durationSec,
              }),
            },
          );
          if (!patch.ok) {
            setRecordingError('finalize_failed');
          }
        } catch {
          setRecordingError('finalize_failed');
        }
      }

      try {
        // Re-read the row so the post-session CTA renders with the
        // canonical server state (status='uploaded').
        const get = await fetch(
          `/api/translate/sessions/${sessionId}/recording`,
        );
        if (get.ok) {
          const json = (await get.json()) as { recording: RecordingRow | null };
          setRecording(json.recording ?? null);
        }
      } catch {
        // The recording row exists; the CTA reload-from-mount path will
        // pick it up next time. No need to surface a separate error.
      }
    },
    [finalizeOneRecorder],
  );

  const stop = useCallback(async () => {
    if (status === 'idle' || status === 'ended') return;
    setStatus('ending');

    // Flush any in-flight rolling chunks so the recorded transcript
    // doesn't lose the tail of the conversation.
    for (const [kind, ref, lang] of [
      ['input', partialInputRef, sourceLang] as const,
      ['output', partialOutputRef, targetLang] as const,
    ]) {
      const current = ref.current.get('current');
      if (current && current.text.trim()) {
        const finalLine: CaptionLine = {
          id: current.id,
          text: current.text.trim(),
          final: true,
          ts: Date.now(),
        };
        pushLine(kind, finalLine);
        broadcastCaption(kind, finalLine, lang);
        void persistMessage(kind, current.text.trim(), lang);
      }
    }

    // Close the Gemini Live WebSocket gracefully so the server frees
    // session state immediately. cleanup() will close it again as a
    // safety net, but doing it here also stops the worklet from queuing
    // more PCM that would never get acked.
    try {
      geminiSessionRef.current?.close();
    } catch {}

    const id = sessionIdRef.current;

    // Finalize the recorder BEFORE cleanup — cleanup nukes the chunk
    // buffer and the MediaRecorder ref.
    if (id) {
      try {
        await uploadAndFinalizeRecording(id);
      } catch {
        // The function already surfaces errors via setRecordingError.
      }
    }

    cleanup('stop');
    sessionIdRef.current = null;
    startedAtRef.current = null;
    if (id) {
      try {
        await fetch(`/api/translate/sessions/${id}/end`, { method: 'POST' });
      } catch {}
    }
    setShareToken(null);
    setShareCopied(false);
    setStatus('ended');
  }, [
    broadcastCaption,
    cleanup,
    persistMessage,
    pushLine,
    sourceLang,
    status,
    targetLang,
    uploadAndFinalizeRecording,
  ]);

  // Stop on unmount.
  useEffect(() => {
    return () => {
      cleanup('unmount');
    };
  }, [cleanup]);

  const generateShare = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id || sharing) return;
    setSharing(true);
    try {
      const res = await fetch(`/api/translate/sessions/${id}/share`, {
        method: 'POST',
      });
      const json = (await res.json()) as { share_token?: string; error?: string };
      if (res.ok && json.share_token) {
        setShareToken(json.share_token);
        setShareCopied(false);
      }
    } catch {
      // surface via existing error state? keep silent for now — host can
      // retry by clicking again.
    } finally {
      setSharing(false);
    }
  }, [sharing]);

  const revokeShare = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id) return;
    setSharing(true);
    try {
      await fetch(`/api/translate/sessions/${id}/share`, { method: 'DELETE' });
      setShareToken(null);
      setShareCopied(false);
    } finally {
      setSharing(false);
    }
  }, []);

  // Charge RECORDING_UNLOCK_CREDITS credits and flip the recording row to `unlocked`. The
  // server enforces idempotency via the (org_id, generation_id) UNIQUE
  // on credit_transactions so a double click just no-ops the second
  // call.
  const unlockRecording = useCallback(async () => {
    if (!recording || unlocking) return;
    if (recording.status === 'unlocked') return;
    setUnlocking(true);
    setRecordingError(null);
    try {
      const res = await fetch(
        `/api/translate/recordings/${recording.id}/unlock`,
        { method: 'POST' },
      );
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setRecordingError(json.error ?? 'unlock_failed');
        return;
      }
      // Optimistic UI: server side flipped status, mirror it locally.
      setRecording({
        ...recording,
        status: 'unlocked',
        unlocked_at: new Date().toISOString(),
        credits_spent: RECORDING_UNLOCK_CREDITS,
      });
    } catch {
      setRecordingError('unlock_failed');
    } finally {
      setUnlocking(false);
    }
  }, [recording, unlocking]);

  // Trigger a download for one of the four formats. All stream directly
  // from the API route — m4a-input/m4a-output are transcoded on demand
  // from the per-track persisted webms; zip-input/zip-output bundle a
  // kind-filtered transcript (.txt + .docx) rendered from
  // translate_messages.
  const downloadFormat = useCallback(
    async (format: 'm4a-input' | 'm4a-output' | 'zip-input' | 'zip-output') => {
      if (!recording || downloadingFormat) return;
      if (recording.status !== 'unlocked') return;
      setDownloadingFormat(format);
      try {
        const res = await fetch(
          `/api/translate/recordings/${recording.id}/download?format=${format}`,
          {
            headers: {
              // Locale hint for the transcript renderers — the route
              // handler reads `x-app-locale` and falls back to ko.
              'x-app-locale': locale,
            },
          },
        );
        if (!res.ok) {
          // Surface the specific server-side error code so the panel
          // can render `input_audio_unavailable` distinctly from a
          // generic network failure (legacy rows have no input track).
          let code = 'download_failed';
          try {
            const j = (await res.json()) as { error?: string };
            if (j.error) code = j.error;
          } catch {}
          setRecordingError(code);
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download =
          format === 'm4a-input'
            ? `translate-${recording.id}-input.m4a`
            : format === 'm4a-output'
              ? `translate-${recording.id}-output.m4a`
              : format === 'zip-input'
                ? `translate-${recording.id}-input.zip`
                : `translate-${recording.id}-output.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch {
        setRecordingError('download_failed');
      } finally {
        setDownloadingFormat(null);
      }
    },
    [downloadingFormat, locale, recording],
  );

  // Build the viewer URL the host shows / copies. When a viewer subdomain
  // is configured (e.g. `live.researchmochi.com`) we use it; otherwise we
  // fall back to the same origin with a `/live/<token>` path.
  const shareUrl = useMemo(() => {
    if (!shareToken) return null;
    if (typeof window === 'undefined') return null;
    const subdomain = process.env.NEXT_PUBLIC_TRANSLATE_VIEWER_HOST;
    const host = subdomain || window.location.host;
    return `${window.location.protocol}//${host}/live/${shareToken}`;
  }, [shareToken]);

  const copyShareUrl = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      // clipboard may be blocked — fall back to selecting the input
      // (handled in the UI by `readOnly` + visible value).
    }
  }, [shareUrl]);


  const live = status === 'live';
  const busy = status === 'starting' || status === 'ending';
  const langOptions = useMemo(() => LANGS, []);
  // Display-only rolling window. We keep every line in `outputLines`
  // state for the eventual "download full transcript" feature (PR-B),
  // but only render the last 30 seconds on the prompter so the screen
  // stays light and the active line stays in the visual center.
  const promptedLines = useMemo(
    () => outputLines.filter((l) => now - l.ts <= PROMPTER_WINDOW_MS),
    [outputLines, now],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 border-b border-line-soft pb-3">
        <label className="flex flex-col gap-1 text-[11.5px] text-mute">
          <span>{t('sourceLang')}</span>
          <select
            value={sourceLang}
            onChange={(e) => setSourceLang(e.target.value)}
            disabled={live || busy}
            className="h-8 rounded-[4px] border border-line bg-paper px-2 text-[12.5px] text-ink"
          >
            {langOptions.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11.5px] text-mute">
          <span>{t('targetLang')}</span>
          <select
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
            disabled={live || busy}
            className="h-8 rounded-[4px] border border-line bg-paper px-2 text-[12.5px] text-ink"
          >
            {langOptions.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11.5px] text-mute">
          <span className="flex items-center gap-1">
            {t('inputSource.label')}
            {inputSource === 'tab' ? (
              <span
                aria-label={t('inputSource.tabHint')}
                title={t('inputSource.tabHint')}
                className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-line text-[9px] leading-none text-mute-soft"
              >
                ?
              </span>
            ) : null}
          </span>
          <select
            value={inputSource}
            onChange={(e) => setInputSource(e.target.value as 'mic' | 'tab')}
            disabled={live || busy}
            className="h-8 rounded-[4px] border border-line bg-paper px-2 text-[12.5px] text-ink"
          >
            <option value="mic">{t('inputSource.mic')}</option>
            <option value="tab">{t('inputSource.tab')}</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-mute">
          <Checkbox
            checked={recordEnabled}
            onChange={(e) => setRecordEnabled(e.target.checked)}
            disabled={live || busy}
          />
          {t('recordEnabled')}
        </label>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[12px] tabular-nums text-mute">
            {live ? formatElapsed(elapsed) : '00:00'}
          </span>
          <IconButton
            variant="bordered"
            size="md"
            onClick={() => setOutputAudible((v) => !v)}
            aria-pressed={outputAudible}
            aria-label={outputAudible ? t('monitorMute.muteAria') : t('monitorMute.unmuteAria')}
            title={outputAudible ? t('monitorMute.muteAria') : t('monitorMute.unmuteAria')}
          >
            {outputAudible ? <SpeakerOnIcon /> : <SpeakerOffIcon />}
          </IconButton>
          <span
            className={`rounded-[4px] border px-2 py-0.5 text-[11px] ${
              live
                ? 'border-amore text-amore'
                : status === 'error'
                  ? 'border-line text-mute'
                  : 'border-line text-mute-soft'
            }`}
          >
            {t(`status.${status}`)}
          </span>
          {live && recordEnabled && recorderActive ? (
            <span
              className="inline-flex items-center gap-1 rounded-[4px] border border-amore px-2 py-0.5 text-[11px] text-amore"
              aria-label={t('recording.indicatorAria')}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amore" aria-hidden="true" />
              {t('recording.indicator')}
            </span>
          ) : null}
          {live ? (
            <>
              {!shareToken ? (
                <ChromeButton
                  size="lg"
                  onClick={() => void generateShare()}
                  disabled={sharing}
                >
                  {sharing ? t('share.creating') : t('share.create')}
                </ChromeButton>
              ) : null}
              <ChromeButton
                size="lg"
                onClick={() => void stop()}
              >
                {t('stop')}
              </ChromeButton>
            </>
          ) : (
            <ChromeButton
              variant="primary"
              size="lg"
              onClick={() => void start()}
              disabled={busy}
            >
              {busy ? t('starting') : t('start')}
            </ChromeButton>
          )}
        </div>
      </div>

      {shareToken && shareUrl ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[4px] border border-line bg-paper px-3 py-2 text-[12px] text-ink">
          <span className="text-mute-soft">{t('share.label')}</span>
          <input
            readOnly
            value={shareUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-[260px] flex-1 rounded-[4px] border border-line-soft bg-paper px-2 py-1 font-mono text-[12px] text-ink"
          />
          <ChromeButton
            size="md"
            onClick={() => void copyShareUrl()}
          >
            {shareCopied ? t('share.copied') : t('share.copy')}
          </ChromeButton>
          <ChromeButton
            variant="mute"
            size="md"
            onClick={() => void revokeShare()}
            disabled={sharing}
          >
            {t('share.revoke')}
          </ChromeButton>
          <span className="text-[11px] text-mute-soft">{t('share.expiresIn4h')}</span>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-[4px] border border-line bg-paper px-3 py-2 text-[12px] text-mute">
          {t('errorPrefix')} {t.has(`errors.${error}`) ? t(`errors.${error}`) : error}
        </div>
      ) : null}

      <PrompterPane lines={promptedLines} empty={t('prompter.empty')} />

      {status === 'ended' || (recording && status !== 'live') ? (
        <RecordingDownloadPanel
          recording={recording}
          recordingError={recordingError}
          unlocking={unlocking}
          downloadingFormat={downloadingFormat}
          onUnlock={() => void unlockRecording()}
          onDownload={(f) => void downloadFormat(f)}
        />
      ) : null}

      <audio ref={monitorAudioRef} autoPlay playsInline className="hidden" />
    </div>
  );
}

function RecordingDownloadPanel({
  recording,
  recordingError,
  unlocking,
  downloadingFormat,
  onUnlock,
  onDownload,
}: {
  recording: RecordingRow | null;
  recordingError: string | null;
  unlocking: boolean;
  downloadingFormat:
    | 'm4a-input'
    | 'm4a-output'
    | 'zip-input'
    | 'zip-output'
    | null;
  onUnlock: () => void;
  onDownload: (
    f: 'm4a-input' | 'm4a-output' | 'zip-input' | 'zip-output',
  ) => void;
}) {
  const t = useTranslations('TranslateConsole');
  // While the recording is still finalizing (upload in-flight) the row
  // status is 'recording'. Treat as "preparing" rather than rendering a
  // half-broken CTA.
  const ready =
    recording && (recording.status === 'uploaded' || recording.status === 'unlocked');
  const unlocked = recording?.status === 'unlocked';

  return (
    <section className="rounded-[4px] border border-line bg-paper p-4 text-[12.5px] text-ink">
      <div className="mb-2 text-[11px] uppercase tracking-[0.08em] text-mute-soft">
        {t('download.eyebrow')}
      </div>
      {recordingError ? (
        <div className="mb-3 rounded-[4px] border border-line-soft px-3 py-2 text-[12px] text-mute">
          {t.has(`download.errors.${recordingError}`)
            ? t(`download.errors.${recordingError}`)
            : recordingError}
        </div>
      ) : null}
      {!recording ? (
        <p className="text-[12.5px] text-mute">{t('download.notAvailable')}</p>
      ) : !ready ? (
        <p className="text-[12.5px] text-mute">{t('download.preparing')}</p>
      ) : !unlocked ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[220px]">
            <div className="text-[13px] text-ink">{t('download.lockedTitle')}</div>
            <div className="mt-1 text-[12px] text-mute">
              {t('download.lockedHint', { credits: RECORDING_UNLOCK_CREDITS })}
            </div>
          </div>
          <ChromeButton
            variant="primary"
            size="lg"
            onClick={onUnlock}
            disabled={unlocking}
          >
            {unlocking
              ? t('download.unlocking')
              : t('download.unlock', { credits: RECORDING_UNLOCK_CREDITS })}
          </ChromeButton>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-[4px] border border-amore px-2 py-0.5 text-[11px] text-amore">
            {t('download.unlockedPill')}
          </span>
          <ChromeButton
            size="lg"
            onClick={() => onDownload('m4a-input')}
            disabled={downloadingFormat !== null}
          >
            {downloadingFormat === 'm4a-input'
              ? t('download.preparingFile')
              : t('download.audioInput')}
          </ChromeButton>
          <ChromeButton
            size="lg"
            onClick={() => onDownload('m4a-output')}
            disabled={downloadingFormat !== null}
          >
            {downloadingFormat === 'm4a-output'
              ? t('download.preparingFile')
              : t('download.audioOutput')}
          </ChromeButton>
          <ChromeButton
            size="lg"
            onClick={() => onDownload('zip-input')}
            disabled={downloadingFormat !== null}
          >
            {downloadingFormat === 'zip-input'
              ? t('download.preparingFile')
              : t('download.zipInput')}
          </ChromeButton>
          <ChromeButton
            size="lg"
            onClick={() => onDownload('zip-output')}
            disabled={downloadingFormat !== null}
          >
            {downloadingFormat === 'zip-output'
              ? t('download.preparingFile')
              : t('download.zipOutput')}
          </ChromeButton>
        </div>
      )}
    </section>
  );
}

function SpeakerOnIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

function SpeakerOffIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}

// Prompter pane — a single centred column that auto-scrolls as new
// translated lines arrive. Visually the chrome is the surrounding
// page; this component renders no border or box. A soft mask at the
// top edge fades older lines as they age out of the 30-second window.
function PrompterPane({ lines, empty }: { lines: CaptionLine[]; empty: string }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Pin to bottom on every new line so the latest text stays in the
  // active reading position.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <div
      className="relative min-h-[360px]"
      style={{
        WebkitMaskImage:
          'linear-gradient(180deg, transparent 0%, #000 18%, #000 100%)',
        maskImage:
          'linear-gradient(180deg, transparent 0%, #000 18%, #000 100%)',
      }}
    >
      <div
        ref={scrollRef}
        className="mx-auto flex max-h-[60vh] min-h-[360px] w-full max-w-[760px] flex-col gap-3 overflow-y-auto px-4 py-8 text-[18px] leading-[1.7] tracking-[-0.005em] text-ink"
      >
        {lines.length === 0 ? (
          <div className="m-auto text-center text-[14px] text-mute-soft">{empty}</div>
        ) : (
          lines.map((l) => (
            <p
              key={l.id}
              className={l.final ? 'text-center' : 'text-center text-mute'}
            >
              {l.text}
              {l.final ? '' : '…'}
            </p>
          ))
        )}
      </div>
    </div>
  );
}


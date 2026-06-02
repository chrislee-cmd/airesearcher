'use client';

// AI 동시통역 — host console.
//
// Lifecycle: idle → starting → live → ending → ended
//
// On "Start" we:
//   1. POST /api/translate/sessions (server returns OpenAI client_secret +
//      LiveKit host token + room name)
//   2. getUserMedia({ audio })
//   3. RTCPeerConnection ↔ OpenAI Realtime
//      - publish mic track
//      - receive translated TTS track via ontrack
//      - datachannel "oai-events" carries transcript + response text events
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
import { createClient as createBrowserSupabase } from '@/lib/supabase/client';
import { ChromeButton } from './ui/chrome-button';
import { IconButton } from './ui/icon-button';

type Status = 'idle' | 'starting' | 'live' | 'ending' | 'ended' | 'error';

// All paths that tear the session down. Logged via `console.info` so
// stray reconnect cycles in production can be traced back to a
// specific caller without re-deploying with extra instrumentation.
type CleanupCaller =
  | 'start_error_session'
  | 'start_error_mic'
  | 'start_error_livekit'
  | 'start_error_webrtc'
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
// In production we've seen the pipeline restart mid-session (root cause
// still under investigation — see [translate] cleanup logs), which spins
// up a second OpenAI session that retranscribes the same audio with
// slightly different tokenization (e.g. comma added/removed). The
// dedup window keeps those copies off the prompter without blocking
// genuine repeats spoken minutes apart.
const DEDUP_WINDOW_MS = 60_000;

// Strip whitespace + Unicode punctuation/symbols so different
// tokenizations of the same utterance collide on the dedup key.
function normalizeForDedup(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
}

type SessionBundle = {
  session: {
    id: string;
    source_lang: string;
    target_lang: string;
    livekit_room: string;
    record_enabled: boolean;
  };
  openai: {
    model: string;
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

// Heuristic sentence boundary used to split the translations-API
// continuous delta stream into committable caption lines. The
// translations endpoint emits no `.completed` event, so we commit on
// punctuation and treat everything between boundaries as the rolling
// in-flight line.
const SENTENCE_END = /([.!?。！？]+|[。…?])(\s+|$)/;

function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
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
  // window slides forward continuously even when the OpenAI deltas
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
  // translated-only) + text/docx transcripts. One unlock covers all
  // four — pricing didn't change.
  const [downloadingFormat, setDownloadingFormat] = useState<
    'm4a-input' | 'm4a-output' | 'txt' | 'docx' | null
  >(null);
  // Whether the MediaRecorder is actively capturing. Driven from the
  // recorder's onstart/onstop events so the indicator pill renders
  // without needing to read the ref during render.
  const [recorderActive, setRecorderActive] = useState(false);

  // Mutable refs held only for the duration of a live session.
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const ttsStreamRef = useRef<MediaStream | null>(null);
  const outputPublishedRef = useRef(false);
  // Web Audio graph used to re-emit the OpenAI translation track as a
  // local MediaStream that LiveKit can publish. A remote track received
  // via pc.ontrack from one peer connection cannot be republished into
  // another peer connection directly — Web Audio "lifts" the audio data
  // through an AudioContext so the track LiveKit sees is local.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
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

  // Recording graph — TWO dedicated MediaStreamDestinationNodes, one for
  // the host's source stream (mic/tab) and one for the translated TTS.
  // We do NOT reuse `audioDestRef` (which feeds LiveKit publish):
  // MediaRecorder reading the same destination as a simultaneous
  // LiveKit publish has produced silent/glitchy webm files in testing.
  //
  // Wiring:
  //   hostSrc (mic OR tab) → recordInputDestRef → MediaRecorder(input)
  //   ttsSrc (translated)  → recordOutputDestRef → MediaRecorder(output)
  //
  // Both destinations live on the SAME AudioContext as the
  // LiveKit-publish graph so the source MediaStreamSourceNodes are
  // single-context and don't need cross-context re-emission. Two
  // recorders are started in the same microtask after the graph is
  // wired so their timelines stay aligned within ~1 audio frame.
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
      hasPc: !!pcRef.current,
    });
    try {
      channelRef.current?.unsubscribe();
    } catch {}
    channelRef.current = null;
    try {
      dcRef.current?.close();
    } catch {}
    dcRef.current = null;
    try {
      pcRef.current?.close();
    } catch {}
    pcRef.current = null;
    micStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    micStreamRef.current = null;
    ttsStreamRef.current = null;
    outputPublishedRef.current = false;
    try {
      audioSourceRef.current?.disconnect();
    } catch {}
    audioSourceRef.current = null;
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
      void audioCtxRef.current?.close();
    } catch {}
    audioCtxRef.current = null;
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
          const isDup = dedupKey.length > 0 && fresh.some((e) => e.key === dedupKey);
          if (isDup) {
            console.info('[translate] dedup', {
              kind,
              preview: finalText.slice(0, 40),
            });
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

  const handleOaiEvent = useCallback(
    (raw: string) => {
      let msg: { type?: string; [k: string]: unknown };
      try {
        msg = JSON.parse(raw) as { type?: string };
      } catch {
        return;
      }
      const type = msg.type ?? '';

      // Source-language transcript — emitted by gpt-realtime-translate
      // when `audio.input.transcription` is enabled at session-create.
      if (type === 'session.input_transcript.delta') {
        appendStreaming('input', String(msg.delta ?? ''), sourceLang);
        return;
      }
      // Translated text — streams continuously.
      if (type === 'session.output_transcript.delta') {
        appendStreaming('output', String(msg.delta ?? ''), targetLang);
        return;
      }
      // Note: `session.output_audio.delta` is delivered via the WebRTC
      // media track, not the data channel — we don't need to handle it
      // here.
    },
    [appendStreaming, sourceLang, targetLang],
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
    // Reset dedup memory so a fresh session never matches against the
    // previous one's keys. Within a single session the dedup window
    // still slides naturally per-line.
    recentFinalsRef.current.set('input', []);
    recentFinalsRef.current.set('output', []);
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

    // LiveKit FIRST — connect and publish the mic so viewers have something
    // to subscribe to right away. The translated output track gets
    // published from inside `pc.ontrack` below, the moment OpenAI starts
    // sending us translated audio (which only happens once the host
    // actually speaks). Publishing the output here too early — before
    // the audio track exists — would silently no-op and viewers who
    // toggle "Translation" later would hear nothing.
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

    // OpenAI WebRTC
    const pc = new RTCPeerConnection();
    pcRef.current = pc;
    mic.getAudioTracks().forEach((tr) => pc.addTrack(tr, mic));
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      ttsStreamRef.current = stream;
      if (monitorAudioRef.current) {
        monitorAudioRef.current.srcObject = stream;
        monitorAudioRef.current.muted = !outputAudible;
        monitorAudioRef.current.play().catch(() => {});
      }
      // Publish the translated TTS track into LiveKit. ontrack can fire
      // multiple times across renegotiations; guard with
      // outputPublishedRef so we only publish once per session.
      if (outputPublishedRef.current) return;
      const room = roomRef.current;
      if (!stream || !room) return;
      try {
        // Browsers refuse to publish a track from one RTCPeerConnection
        // (OpenAI) into another (LiveKit) directly. Web Audio routing
        // re-emits the audio as a fresh local MediaStreamTrack we can
        // attach to LocalAudioTrack.
        type WebkitWindow = Window &
          typeof globalThis & {
            webkitAudioContext?: typeof AudioContext;
          };
        const w = window as WebkitWindow;
        const AudioCtx = w.AudioContext ?? w.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;
        // pc.ontrack fires from a WebRTC event, not the original click
        // gesture, so the AudioContext can start suspended on stricter
        // engines. A suspended ctx means the destination MediaStream
        // carries silence — viewers would join, see the "output" track,
        // and hear nothing. resume() is best-effort: if it rejects we
        // still publish, just log it.
        if (ctx.state === 'suspended') {
          void ctx.resume().catch((err) => {
            console.warn('[translate] audioCtx.resume failed', err);
          });
        }
        const src = ctx.createMediaStreamSource(stream);
        audioSourceRef.current = src;
        const dst = ctx.createMediaStreamDestination();
        audioDestRef.current = dst;
        src.connect(dst);

        // ── Recording graph (PR #183: split source vs. translated) ──
        // Two dedicated destination nodes on the same AudioContext:
        //   recordInputDest  ← host source (mic or tab)
        //   recordOutputDest ← translated TTS
        // Each feeds its own MediaRecorder so the unlocked UI can offer
        // 원문 오디오 + 통역 오디오 as separate downloads. We do NOT mix
        // them and we do NOT share `dst` (the LiveKit publish dest) —
        // MediaRecorder reading the same dest as a live publish has
        // produced silent/glitchy webm output in testing.
        const mic = micStreamRef.current;
        if (recordEnabled && mic) {
          try {
            // Pick a MIME the browser actually supports. Chrome desktop
            // (our only supported recording surface) ships
            // `audio/webm;codecs=opus`. Fall back to plain webm if the
            // codec-tagged form is rejected; if both fail, recording
            // silently skips and the UI stays in the "no recording
            // available" branch.
            let mimeType = 'audio/webm;codecs=opus';
            if (typeof MediaRecorder !== 'undefined') {
              if (!MediaRecorder.isTypeSupported(mimeType)) {
                mimeType = 'audio/webm';
              }
              if (MediaRecorder.isTypeSupported(mimeType)) {
                // Build the input (source) track graph + recorder.
                const inputDest = ctx.createMediaStreamDestination();
                recordInputDestRef.current = inputDest;
                const hostRecSrc = ctx.createMediaStreamSource(mic);
                recordInputSrcRef.current = hostRecSrc;
                hostRecSrc.connect(inputDest);

                // Build the output (translated TTS) track graph + recorder.
                const outputDest = ctx.createMediaStreamDestination();
                recordOutputDestRef.current = outputDest;
                const ttsRecSrc = ctx.createMediaStreamSource(stream);
                recordOutputSrcRef.current = ttsRecSrc;
                ttsRecSrc.connect(outputDest);

                const recIn = new MediaRecorder(inputDest.stream, { mimeType });
                const recOut = new MediaRecorder(outputDest.stream, { mimeType });
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
                  // Best-effort: ditch the recording. UI stays in the
                  // post-stop "no download available" branch.
                  setRecordingError('recorder_failed');
                  setRecorderActive(false);
                };
                recIn.onerror = fail;
                recOut.onerror = fail;
                // The indicator pill flips on once EITHER recorder is
                // active, and only flips off once BOTH have stopped.
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
                // Start both in the same tick so the two webm timelines
                // align within an audio frame.
                recIn.start(RECORDING_CHUNK_MS);
                recOut.start(RECORDING_CHUNK_MS);
                recordingStartedAtRef.current = Date.now();

                // Reserve metadata + signed upload URLs for BOTH tracks
                // now so each stop() turns into a single PUT. We POST
                // output first (default kind) to create the row, then
                // POST input — the server attaches it to the same row.
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
                      // r2 should attach to the same row r1 created.
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

        const localTtsTrack = dst.stream.getAudioTracks()[0];
        if (!localTtsTrack) return;
        outputPublishedRef.current = true;
        const outputTrack = new LocalAudioTrack(localTtsTrack);
        console.info(
          `[translate] publishing output — ctxState=${ctx.state}, ` +
          `localTrackEnabled=${localTtsTrack.enabled}, ` +
          `localTrackReadyState=${localTtsTrack.readyState}, ` +
          `localTrackMuted=${localTtsTrack.muted}`,
        );
        room.localParticipant
          .publishTrack(outputTrack, { name: 'output' })
          .then(() => {
            console.info(
              `[translate] output PUBLISHED — ctxState=${ctx.state}, ` +
              `localTrackMuted=${localTtsTrack.muted}`,
            );
          })
          .catch((err) => {
            console.warn('[translate] output publish FAILED', err);
            // Allow a retry on the next ontrack if this one races with
            // disconnect.
            outputPublishedRef.current = false;
          });
      } catch {
        outputPublishedRef.current = false;
      }
    };
    const dc = pc.createDataChannel('oai-events');
    dcRef.current = dc;
    dc.onmessage = (ev) => handleOaiEvent(String(ev.data));

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // The translation-model SDP exchange has its own endpoint family.
      const sdpRes = await fetch(
        'https://api.openai.com/v1/realtime/translations/calls',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${bundle.openai.client_secret.value}`,
            'Content-Type': 'application/sdp',
          },
          body: offer.sdp ?? '',
        },
      );
      if (!sdpRes.ok) throw new Error(`openai_sdp_${sdpRes.status}`);
      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'webrtc_failed');
      setStatus('error');
      cleanup('start_error_webrtc');
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
    handleOaiEvent,
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

    // Ask OpenAI to close the translation session gracefully.
    try {
      dcRef.current?.send(JSON.stringify({ type: 'session.close' }));
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
  // from the per-track persisted webms, txt/docx are rendered from
  // translate_messages.
  const downloadFormat = useCallback(
    async (format: 'm4a-input' | 'm4a-output' | 'txt' | 'docx') => {
      if (!recording || downloadingFormat) return;
      if (recording.status !== 'unlocked') return;
      setDownloadingFormat(format);
      try {
        const res = await fetch(
          `/api/translate/recordings/${recording.id}/download?format=${format}`,
          {
            headers: {
              // Locale hint for the txt/docx renderers — the route
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
              : format === 'txt'
                ? `translate-${recording.id}.txt`
                : `translate-${recording.id}.docx`;
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
          <input
            type="checkbox"
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
  downloadingFormat: 'm4a-input' | 'm4a-output' | 'txt' | 'docx' | null;
  onUnlock: () => void;
  onDownload: (f: 'm4a-input' | 'm4a-output' | 'txt' | 'docx') => void;
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
            onClick={() => onDownload('txt')}
            disabled={downloadingFormat !== null}
          >
            {downloadingFormat === 'txt'
              ? t('download.preparingFile')
              : t('download.txt')}
          </ChromeButton>
          <ChromeButton
            size="lg"
            onClick={() => onDownload('docx')}
            disabled={downloadingFormat !== null}
          >
            {downloadingFormat === 'docx'
              ? t('download.preparingFile')
              : t('download.docx')}
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


'use client';

// Voice Concierge — React hook owning the full RealtimeSession lifecycle.
//
// Verified against @openai/agents@0.11.6 (re-exports from
// @openai/agents-realtime):
//   - `RealtimeAgent({ name, instructions, tools? })` — text-only ctor;
//     tools optional, wired in PR3 via the buildVoiceTools() factory.
//   - `new RealtimeSession(agent, { transport: 'webrtc', model })` —
//     transport defaults to WebRTC when run in a browser.
//   - `session.connect({ apiKey })` — `apiKey` must be a string or a
//     function returning a string/Promise<string>. Our ek_... is a plain
//     string.
//   - Events (RealtimeSessionEventTypes): `history_added`, `history_updated`,
//     `audio_start`, `audio_stopped`, `error`. The SDK does NOT expose
//     `user_transcript` / `agent_transcript` events as the public design
//     doc suggested — transcripts arrive via history_added / history_updated
//     with role='user' (status='completed') or role='assistant'
//     (status='completed' once the audio finishes).
//   - `session.mute(muted)`, `session.close()`.
//   - PR3: The public RealtimeSession surface does NOT have
//     `session.update({ instructions })`. The closest options are
//     `session.updateAgent(newAgent)` (rebuilds the whole agent — heavy)
//     and `session.transport.updateSessionConfig({ instructions })` (the
//     lighter, declared-API path). PR3 uses transport.updateSessionConfig
//     for route-driven re-syncs since we only ever change the instructions
//     string, never the tool set.
//
// The hook returns a stable state machine + transcript list; the
// provider/panel are pure renderers.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RealtimeAgent,
  RealtimeSession,
  type RealtimeItem,
} from '@openai/agents/realtime';
import { VOICE_MODEL, VOICE_PERSONA_NAME } from '@/lib/voice/config';
import { buildVoiceTools, type VoiceRouter, type VoiceToastPush } from './tools';

export type VoiceState =
  | 'idle'
  | 'requesting-mic'
  | 'connecting'
  | 'live'
  | 'ending'
  | 'error';

export type VoiceTranscript = {
  /** Stable id from the SDK (RealtimeMessageItem.itemId). */
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

export type UseRealtimeSessionResult = {
  state: VoiceState;
  /** Last user-visible error key — translated by the panel. */
  errorKey?: 'mic_denied' | 'quota_exceeded' | 'preview_only' | 'generic';
  transcripts: VoiceTranscript[];
  /** True while the model is producing audio (drives the "speaking" indicator). */
  isAssistantSpeaking: boolean;
  /** Microphone mute state (null until session connects). */
  muted: boolean | null;
  /** Smoothed mic input level (0..1). Used by the FAB/panel to render
   *  "you are being heard" feedback while the user speaks. Stays at 0
   *  when mic was denied (silent stream) or session not live. */
  inputLevel: number;
  /** PR4 Bundle 3: true when the panel should render the text-input
   *  fallback instead of (or in addition to) voice. Auto-flips on
   *  mic_denied during start(), and on user request via toggleTextMode(). */
  textMode: boolean;
  start: (
    route: string,
    locale: 'ko' | 'en',
    opts?: { greet?: boolean },
  ) => Promise<void>;
  stop: () => Promise<void>;
  toggleMute: () => void;
  /** PR4 Bundle 3: send a typed user message to the live session. The
   *  SDK's sendMessage(string) auto-triggers a model response. No-op if
   *  no session is connected or the input is whitespace-only. */
  sendText: (text: string) => void;
  /** PR4 Bundle 3: flip between voice-active (mic track) and text-only
   *  mode. When entering text mode we release the mic; switching back
   *  to voice requires stop() + start() because the WebRTC peer's
   *  initial offer already locked the track set. The panel handles that
   *  by closing + reopening; this just owns the toggle flag. */
  setTextMode: (next: boolean) => void;
  /** Push a refreshed system prompt to the live session. PR3: called by
   *  the provider on pathname change. No-op if no session is connected. */
  resyncInstructions: (route: string, locale: 'ko' | 'en') => Promise<void>;
};

export type UseRealtimeSessionDeps = {
  /** next/navigation router instance — bound into the navigate /
   *  startFeature / openPurchase tool execute() bodies. */
  router: VoiceRouter;
  /** Toast pusher — bound into the tool factory so the user sees
   *  feedback for actions like "Navigating" / "Opening purchase". */
  toast: VoiceToastPush;
  /** Localized tool-status copy. */
  toolCopy: {
    navigating: string;
    openingPurchase: string;
    escalating: string;
    highlightFallback: string;
  };
};

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Extract a displayable text snippet from a RealtimeMessageItem.
 * - user input_audio: prefer `transcript` (may be null while in-progress)
 * - user input_text: just the text
 * - assistant output_audio: prefer `transcript`
 * - assistant output_text: text
 */
function itemToTranscript(item: RealtimeItem): VoiceTranscript | null {
  if (item.type !== 'message') return null;
  if (item.role !== 'user' && item.role !== 'assistant') return null;
  const parts = item.content ?? [];
  // Concatenate any text/transcript fragments. SDK splits into multiple
  // content entries when the same turn mixes modalities.
  const text = parts
    .map((p) => {
      if ('text' in p && typeof p.text === 'string') return p.text;
      if ('transcript' in p && typeof p.transcript === 'string') return p.transcript;
      return '';
    })
    .join('')
    .trim();
  if (!text) return null;
  return { id: item.itemId, role: item.role, text };
}

/** Map an /ephemeral failure body to an error key the panel can render. */
function fetchErrorToKey(status: number, body: { error?: string } | null): VoiceTranscript['id'] {
  if (status === 429 || body?.error === 'quota_exceeded') return 'quota_exceeded';
  if (status === 403 || body?.error === 'preview_only') return 'preview_only';
  return 'generic';
}

/**
 * PR4 Bundle 3: Build a silent audio MediaStream for text-only sessions.
 *
 * The WebRTC transport in @openai/agents-realtime always attaches an
 * outgoing audio track to its peer connection (the SDK adds it in
 * openaiRealtimeWebRtc when the browser exposes mediaDevices). When the
 * user denies mic access we still need *some* audio track to satisfy the
 * SDP negotiation, otherwise connect() rejects mid-handshake. A 0-volume
 * OscillatorNode → MediaStreamDestination gives us a valid track that
 * the server transcribes as nothing — the user just types instead.
 */
function buildSilentMicStream(): MediaStream | null {
  if (typeof window === 'undefined') return null;
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0; // truly silent
    osc.connect(gain);
    const dest = ctx.createMediaStreamDestination();
    gain.connect(dest);
    osc.start();
    return dest.stream;
  } catch {
    return null;
  }
}

// ── Hook ────────────────────────────────────────────────────────────────

export function useRealtimeSession(
  deps: UseRealtimeSessionDeps,
): UseRealtimeSessionResult {
  const [state, setState] = useState<VoiceState>('idle');
  const [errorKey, setErrorKey] = useState<UseRealtimeSessionResult['errorKey']>();
  const [transcripts, setTranscripts] = useState<VoiceTranscript[]>([]);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [muted, setMuted] = useState<boolean | null>(null);
  // Smoothed mic level (0..1). Driven by an AnalyserNode rAF loop; gated
  // behind real-mic acquisition so denied/silent sessions stay at 0.
  const [inputLevel, setInputLevel] = useState(0);
  // PR4 Bundle 3: text-input fallback flag. Owned here (not in the panel)
  // because start() needs to flip it on mic_denied before the panel ever
  // sees an error state.
  const [textMode, setTextModeState] = useState(false);

  // Refs — anything the React lifecycle should NOT trigger re-renders on.
  // Critical for the SDK objects: a strict-mode double-mount would
  // otherwise spin up two parallel WebRTC connections.
  const sessionRef = useRef<RealtimeSession | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  // Guards against double-start (e.g. rapid button clicks while the
  // /ephemeral request is still in flight).
  const startingRef = useRef(false);
  // Latest transcript text we've already POSTed, keyed by item id.
  // Lets us flush only NEW final text on history_updated.
  const persistedTextRef = useRef<Map<string, string>>(new Map());
  // Latest deps captured for tool factory rebuild. We stash them in a ref
  // so the tool execute() bodies always close over the freshest router
  // instance even if the provider re-renders. (next/navigation's router
  // is stable across renders, but tool copy / toast push can change.)
  // Updated in an effect rather than at render time so we don't violate
  // the no-refs-during-render rule. The tools are built once per session
  // inside start() and only read depsRef.current at that point — first
  // render → first start() always sees the initial deps; subsequent
  // re-renders flow through this effect before the user can click again.
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  }, [deps]);
  // Resync-in-flight guard: if two route changes fire back-to-back we
  // skip the second until the first completes — design §2.3 ("never two
  // updates in flight at once").
  const resyncingRef = useRef(false);

  // Last-20 cap on the in-memory transcript list. We don't paginate; the
  // panel is ephemeral and the server has the durable copy.
  const TRANSCRIPT_LIMIT = 20;

  // Audio level monitor — owned alongside the mic stream so its lifetime
  // matches the WebRTC peer. Refs (no re-render) for the AudioContext +
  // rAF handle so we can tear them down cleanly in stop()/unmount.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const levelRafRef = useRef<number | null>(null);

  const stopLevelMonitor = useCallback(() => {
    if (levelRafRef.current !== null) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        void audioCtxRef.current.close();
      } catch {
        /* ctx already closed */
      }
      audioCtxRef.current = null;
    }
    setInputLevel(0);
  }, []);

  const startLevelMonitor = useCallback((stream: MediaStream) => {
    if (typeof window === 'undefined') return;
    try {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      src.connect(analyser);
      audioCtxRef.current = ctx;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length / 255;
        // Gamma-correct so quiet speech still moves the bar; clamp to 1.
        const level = Math.min(1, Math.pow(avg, 0.6) * 1.8);
        setInputLevel(level);
        levelRafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* AudioContext unavailable — leave inputLevel at 0 */
    }
  }, []);

  const releaseMic = useCallback(() => {
    stopLevelMonitor();
    if (micStreamRef.current) {
      for (const t of micStreamRef.current.getTracks()) t.stop();
      micStreamRef.current = null;
    }
  }, [stopLevelMonitor]);

  const stop = useCallback(async () => {
    if (!sessionRef.current && !sessionIdRef.current) {
      setState('idle');
      return;
    }
    setState('ending');
    try {
      sessionRef.current?.close();
    } catch {
      // SDK throws if close() runs before connect resolves — safe to swallow.
    }
    sessionRef.current = null;
    releaseMic();

    const sid = sessionIdRef.current;
    if (sid) {
      try {
        await fetch(`/api/voice/sessions/${sid}/end`, { method: 'POST' });
      } catch {
        // best-effort; user already closed the panel.
      }
    }
    sessionIdRef.current = null;
    persistedTextRef.current.clear();
    setIsAssistantSpeaking(false);
    setMuted(null);
    setState('idle');
  }, [releaseMic]);

  const start = useCallback(
    async (
      route: string,
      locale: 'ko' | 'en',
      opts?: { greet?: boolean },
    ) => {
      if (startingRef.current || sessionRef.current) return;
      startingRef.current = true;
      setErrorKey(undefined);
      setTranscripts([]);
      persistedTextRef.current.clear();
      // Reset text-mode on each fresh start — the panel reopens cleanly
      // and a previously-denied mic gets a second chance.
      setTextModeState(false);

      try {
        // ── 1. Mic permission ──────────────────────────────────────────
        // PR4 Bundle 3: mic_denied is no longer a fatal error. We flip
        // textMode on, skip the mic-track step, and keep going. The
        // WebRTC peer still wants SOMETHING to negotiate, so we hand it
        // a silent track from a 0-volume AudioContext stream. The model
        // still produces audio OUT (so the user gets voice replies),
        // they just type their input.
        setState('requesting-mic');
        let micIsReal = false;
        try {
          micStreamRef.current = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
          micIsReal = true;
        } catch {
          micStreamRef.current = buildSilentMicStream();
          setTextModeState(true);
          // Surface a soft error key the panel uses to render an inline
          // hint above the text input. We still proceed with connect.
          setErrorKey('mic_denied');
        }
        // Wire the level meter only when the user actually granted mic
        // access — a silent fallback stream would always report 0 and the
        // animation would never wake up, which is correct.
        if (micIsReal && micStreamRef.current) {
          startLevelMonitor(micStreamRef.current);
        }

        // ── 2. /api/voice/ephemeral ────────────────────────────────────
        setState('connecting');
        const res = await fetch('/api/voice/ephemeral', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ route, locale }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          const key = fetchErrorToKey(res.status, body);
          setErrorKey(key as UseRealtimeSessionResult['errorKey']);
          setState('error');
          releaseMic();
          startingRef.current = false;
          return;
        }
        const { apiKey, sessionId, instructions } = (await res.json()) as {
          apiKey: string;
          sessionId: string;
          instructions: string;
        };
        sessionIdRef.current = sessionId;

        // ── 3. Build agent + session ──────────────────────────────────
        // The Agents SDK overrides whatever instructions live in the
        // ephemeral session config with the RealtimeAgent ctor's
        // instructions on `session.connect()` (via session.update). So
        // we MUST pass the server-built prompt here — otherwise the
        // model only sees a one-line stub and forgets the whole feature
        // catalog / persona / safety prompt. The server also still bakes
        // the same prompt into the ephemeral as a safety-net default.
        //
        // PR3: tools are now wired in via buildVoiceTools(). The SDK
        // auto-feeds each tool.execute() return value back to the model
        // as a function_call_output — no manual conversation.item.create.
        const d = depsRef.current;
        const tools = buildVoiceTools({
          router: d.router,
          toast: d.toast,
          copy: d.toolCopy,
          getSessionId: () => sessionIdRef.current,
        });
        const agent = new RealtimeAgent({
          name: VOICE_PERSONA_NAME,
          instructions,
          tools,
        });
        const session = new RealtimeSession(agent, {
          model: VOICE_MODEL,
          transport: 'webrtc',
          // Don't keep audio bytes in the in-memory history — saves RAM
          // and matches the "text-only persistence" privacy policy
          // (design §9).
          historyStoreAudio: false,
        });
        sessionRef.current = session;

        // ── 4. Wire transcript events ──────────────────────────────────
        const updateFromHistory = (history: RealtimeItem[]) => {
          // Take the last N message items and project them into the
          // VoiceTranscript shape the panel renders.
          const next: VoiceTranscript[] = [];
          for (let i = history.length - 1; i >= 0 && next.length < TRANSCRIPT_LIMIT; i--) {
            const t = itemToTranscript(history[i]);
            if (t) next.unshift(t);
          }
          setTranscripts(next);

          // Persist any newly-final text we haven't already POSTed.
          // We treat "text changed since last persist" as the signal —
          // the SDK keeps the same itemId across in-progress updates.
          if (!sessionIdRef.current) return;
          for (const t of next) {
            const prev = persistedTextRef.current.get(t.id);
            if (prev === t.text) continue;
            persistedTextRef.current.set(t.id, t.text);
            // Fire-and-forget — the panel transcript is the source of
            // truth for UX, the DB row is just the durable replay copy.
            fetch(`/api/voice/sessions/${sessionIdRef.current}/message`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ role: t.role, text: t.text }),
            }).catch(() => {
              /* best-effort */
            });
          }
        };

        session.on('history_updated', updateFromHistory);
        session.on('audio_start', () => setIsAssistantSpeaking(true));
        session.on('audio_stopped', () => setIsAssistantSpeaking(false));
        session.on('audio_interrupted', () => setIsAssistantSpeaking(false));
        session.on('error', (e) => {
          // Surface the SDK error so we can actually diagnose 'generic'
          // failures in the panel — the catch below swallowed everything
          // in PR2/PR3 and we hit a tool-schema rejection blind.
          console.error('[voice-concierge] session error', e);
          setState('error');
          setErrorKey('generic');
        });

        // ── 5. Connect ─────────────────────────────────────────────────
        await session.connect({ apiKey });
        setMuted(session.muted);
        setState('live');

        // ── 6. Proactive greeting (PR4 Bundle 1) ───────────────────────
        // First-time users get an assistant-initiated turn so they don't
        // have to figure out "do I start talking now?". We use the raw
        // transport.sendEvent escape hatch with `response.create` —
        // session.sendMessage(string) would inject a synthetic USER turn
        // (the SDK types RealtimeUserInput as user-role only), which is
        // semantically wrong. response.create is the documented way to
        // request an assistant turn out of order.
        //
        // No browser autoplay-policy concern: this only fires after the
        // user explicitly clicked the FAB, so the audio context is
        // already in a user-gesture-unlocked state.
        if (opts?.greet) {
          try {
            const greetingHint = locale === 'ko'
              ? '사용자와 처음 만난 듯 짧게 자기소개하고 무엇을 하고 있는지 한 가지만 부드럽게 물어보세요.'
              : 'Greet briefly as if meeting for the first time, then ask one gentle question about what they are working on.';
            session.transport.sendEvent({
              type: 'response.create',
              response: { instructions: greetingHint },
            });
          } catch {
            // Transport not ready / SDK shape changed — fall back to
            // user-initiated turn, no fatal.
          }
        }
      } catch (e) {
        console.error('[voice-concierge] start() failed', e);
        setState('error');
        setErrorKey('generic');
        releaseMic();
      } finally {
        startingRef.current = false;
      }
    },
    [releaseMic, startLevelMonitor],
  );

  // ── Resync instructions on route change (PR3) ─────────────────────────
  //
  // The provider drives this on usePathname() changes (debounce + diff
  // already applied on its side). Here we just need to: (a) noop if
  // there's no live session, (b) prevent overlapping requests, (c) push
  // the new instructions via the transport layer (the only public
  // surface the SDK exposes for live instruction swaps).
  const resyncInstructions = useCallback(
    async (route: string, locale: 'ko' | 'en') => {
      const session = sessionRef.current;
      if (!session) return;
      if (resyncingRef.current) return;
      resyncingRef.current = true;
      try {
        const res = await fetch('/api/voice/instructions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ route, locale }),
        });
        if (!res.ok) return;
        const body = (await res.json().catch(() => null)) as {
          instructions?: string;
        } | null;
        if (!body?.instructions) return;
        try {
          // updateSessionConfig is the declared transport-layer API for
          // live config swaps (handoffs use the same path internally —
          // see node_modules/.../transportLayer.d.ts comment).
          session.transport.updateSessionConfig({
            instructions: body.instructions,
          });
        } catch {
          /* transport not ready / closed mid-resync — drop silently */
        }
      } catch {
        /* network error during resync — drop, will retry on next nav */
      } finally {
        resyncingRef.current = false;
      }
    },
    [],
  );

  const toggleMute = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const next = !(muted ?? false);
    try {
      s.mute(next);
      setMuted(next);
    } catch {
      /* transport doesn't support muting — leave state as-is */
    }
  }, [muted]);

  // ── PR4 Bundle 3: text input ─────────────────────────────────────────
  //
  // session.sendMessage(string) injects a USER-role message into the
  // history and (per the SDK source) automatically issues a
  // response.create after the conversation.item.create. So a single call
  // covers both halves of a typed turn.
  const sendText = useCallback((text: string) => {
    const s = sessionRef.current;
    if (!s) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      s.sendMessage(trimmed);
    } catch {
      /* transport not ready — silently drop, panel can retry */
    }
  }, []);

  // Voice users can flip into text-only mode mid-session. We also mute
  // the mic when entering text mode so the model isn't reacting to room
  // noise while the user types. Flipping back unmutes.
  const setTextMode = useCallback((next: boolean) => {
    setTextModeState(next);
    const s = sessionRef.current;
    if (!s) return;
    try {
      s.mute(next);
      setMuted(next);
    } catch {
      /* transport doesn't support muting — text input still works */
    }
  }, []);

  // Ensure we never leak a mic stream / WebRTC peer on unmount. The hook
  // outlives the panel (it lives in the provider) so this only fires on
  // app unload, but the cleanup is cheap and defensive.
  useEffect(() => {
    return () => {
      try {
        sessionRef.current?.close();
      } catch {
        /* noop */
      }
      releaseMic();
    };
  }, [releaseMic]);

  return {
    state,
    errorKey,
    transcripts,
    isAssistantSpeaking,
    muted,
    textMode,
    inputLevel,
    start,
    stop,
    toggleMute,
    sendText,
    setTextMode,
    resyncInstructions,
  };
}

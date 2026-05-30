'use client';

// Voice Concierge — React hook owning the full RealtimeSession lifecycle.
//
// Verified against @openai/agents@0.11.6 (re-exports from
// @openai/agents-realtime):
//   - `RealtimeAgent({ name, instructions, voice? })` — text-only ctor;
//     tools optional, omitted in PR2 (PR3 wires them).
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
  start: (route: string, locale: 'ko' | 'en') => Promise<void>;
  stop: () => Promise<void>;
  toggleMute: () => void;
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

// ── Hook ────────────────────────────────────────────────────────────────

export function useRealtimeSession(): UseRealtimeSessionResult {
  const [state, setState] = useState<VoiceState>('idle');
  const [errorKey, setErrorKey] = useState<UseRealtimeSessionResult['errorKey']>();
  const [transcripts, setTranscripts] = useState<VoiceTranscript[]>([]);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [muted, setMuted] = useState<boolean | null>(null);

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

  // Last-20 cap on the in-memory transcript list. We don't paginate; the
  // panel is ephemeral and the server has the durable copy.
  const TRANSCRIPT_LIMIT = 20;

  const releaseMic = useCallback(() => {
    if (micStreamRef.current) {
      for (const t of micStreamRef.current.getTracks()) t.stop();
      micStreamRef.current = null;
    }
  }, []);

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
    async (route: string, locale: 'ko' | 'en') => {
      if (startingRef.current || sessionRef.current) return;
      startingRef.current = true;
      setErrorKey(undefined);
      setTranscripts([]);
      persistedTextRef.current.clear();

      try {
        // ── 1. Mic permission ──────────────────────────────────────────
        setState('requesting-mic');
        try {
          micStreamRef.current = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
        } catch {
          setState('error');
          setErrorKey('mic_denied');
          startingRef.current = false;
          return;
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
        const agent = new RealtimeAgent({
          name: VOICE_PERSONA_NAME,
          instructions,
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
        session.on('error', () => {
          setState('error');
          setErrorKey('generic');
        });

        // ── 5. Connect ─────────────────────────────────────────────────
        await session.connect({ apiKey });
        setMuted(session.muted);
        setState('live');
      } catch {
        setState('error');
        setErrorKey('generic');
        releaseMic();
      } finally {
        startingRef.current = false;
      }
    },
    [releaseMic],
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
    start,
    stop,
    toggleMute,
  };
}

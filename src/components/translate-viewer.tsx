'use client';

// AI 동시통역 — public viewer.
//
// What runs here per share link:
//   1. backfill captions via /api/translate/public/:token/transcript-since
//      so a late-join visitor sees what's already been said
//   2. subscribe to the Supabase Realtime broadcast channel
//      "live:<sessionId>" for live caption deltas (input + output)
//   3. fetch /api/translate/public/:token/viewer-token to mint a
//      subscribe-only LiveKit JWT and join the room
//   4. wire the audio mode radio (input / output / mute) so only one
//      track is ever audible:
//        - SFU-level: setSubscribed(false) on the other track so we don't
//          even download it
//        - browser-level: <audio>.muted = !want as a belt-and-suspenders
//          safety net

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Room,
  RoomEvent,
  type RemoteAudioTrack,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient as createBrowserSupabase } from '@/lib/supabase/client';

type AudioMode = 'input' | 'output' | 'mute';
type SessionStatus = 'idle' | 'live' | 'ended';
type CaptionLine = { id: string; text: string; final: boolean };

type BackfillRow = { kind: 'input' | 'output'; text: string; lang: string | null; ts: string };

type Props = {
  token: string;
  sessionId: string;
  sourceLang: string;
  targetLang: string;
  initialStatus: SessionStatus;
  // The LiveKit room name is derived server-side and tunnelled here for
  // future use (e.g. a "share to a second viewer" link that pre-shows
  // the room) — we currently fetch it again from the viewer-token API.
  livekitRoom?: string;
  recordEnabled: boolean;
};

const LANG_LABEL: Record<string, string> = {
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  th: 'ไทย',
  zh: '中文',
  es: 'Español',
};

function langName(code: string) {
  return LANG_LABEL[code] ?? code.toUpperCase();
}

const COPY = {
  audioInput: 'Original',
  audioOutput: 'Translation',
  audioMute: 'Mute',
  status: {
    idle: 'Waiting to start…',
    live: 'Live',
    ended: 'Session ended',
  },
  recordedHint: 'You can also follow along by reading the captions.',
  ephemeralHint: 'Live captions only — this session is not being recorded.',
  hostLabel: 'Host language',
  viewerLabel: 'Translated to',
} as const;

export function TranslateViewer({
  token,
  sessionId,
  sourceLang,
  targetLang,
  initialStatus,
  recordEnabled,
}: Props) {
  const [status, setStatus] = useState<SessionStatus>(initialStatus);
  const [mode, setMode] = useState<AudioMode>('input');
  const [inputLines, setInputLines] = useState<CaptionLine[]>([]);
  const [outputLines, setOutputLines] = useState<CaptionLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Mobile browsers (especially iOS Safari) block <audio>.play() that
  // wasn't called from inside a user gesture. LiveKit signals this via
  // RoomEvent.AudioPlaybackStatusChanged. When blocked we show a
  // tap-to-enable banner and call room.startAudio() from the click —
  // that single user-gesture unlocks playback for every track in the
  // room.
  const [needsTap, setNeedsTap] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const inputAudioRef = useRef<HTMLAudioElement | null>(null);
  const outputAudioRef = useRef<HTMLAudioElement | null>(null);
  const trackByNameRef = useRef<Record<'input' | 'output', RemoteAudioTrack | null>>({
    input: null,
    output: null,
  });
  const trackPubByNameRef = useRef<Record<'input' | 'output', RemoteTrackPublication | null>>({
    input: null,
    output: null,
  });

  const pushLine = useCallback(
    (kind: 'input' | 'output', line: CaptionLine) => {
      const setter = kind === 'input' ? setInputLines : setOutputLines;
      setter((prev) => {
        const idx = prev.findIndex((l) => l.id === line.id);
        if (idx === -1) return [...prev, line];
        const next = prev.slice();
        next[idx] = line;
        return next;
      });
    },
    [],
  );

  // Resolve the audible track / muted state every time the mode flips.
  // We do this in BOTH places so the host can be confident a viewer
  // never accidentally hears both streams at once:
  //   1. setSubscribed on the unwanted track so the SFU stops shipping it
  //   2. <audio>.muted on the corresponding element so any in-flight
  //      buffer doesn't slip through during the unsubscribe round-trip
  const applyMode = useCallback(() => {
    const room = roomRef.current;
    if (room) {
      for (const k of ['input', 'output'] as const) {
        const want = mode === k;
        const pub = trackPubByNameRef.current[k];
        if (pub) {
          try {
            pub.setSubscribed(want);
          } catch {
            // ignore — race with disconnect
          }
        }
      }
    }
    if (inputAudioRef.current) {
      inputAudioRef.current.muted = mode !== 'input';
      // Re-trigger play() so a mode change inside a user gesture (the
      // radio click) carries the playback permission through to the
      // <audio> element on mobile browsers. The catch is fine: if it's
      // already playing, play() rejects with NotAllowedError on some
      // engines and we don't care.
      if (mode === 'input') void inputAudioRef.current.play().catch(() => {});
    }
    if (outputAudioRef.current) {
      outputAudioRef.current.muted = mode !== 'output';
      if (mode === 'output') void outputAudioRef.current.play().catch(() => {});
    }
  }, [mode]);

  useEffect(() => {
    applyMode();
  }, [applyMode]);

  // Backfill on mount (only useful when the host turned recording on —
  // otherwise the RPC returns empty by design).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!recordEnabled) return;
      try {
        const res = await fetch(
          `/api/translate/public/${encodeURIComponent(token)}/transcript-since?since=1970-01-01T00:00:00Z`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as { messages?: BackfillRow[] };
        if (cancelled) return;
        const inputs: CaptionLine[] = [];
        const outputs: CaptionLine[] = [];
        for (const m of json.messages ?? []) {
          const line: CaptionLine = {
            id: `bf-${m.ts}-${m.kind}`,
            text: m.text,
            final: true,
          };
          (m.kind === 'input' ? inputs : outputs).push(line);
        }
        if (inputs.length) setInputLines(inputs);
        if (outputs.length) setOutputLines(outputs);
      } catch {
        // best-effort — live deltas will fill the panel anyway
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recordEnabled, token]);

  // Subscribe to the broadcast channel for live caption deltas.
  useEffect(() => {
    const supa = createBrowserSupabase();
    const ch = supa.channel(`live:${sessionId}`, {
      config: { broadcast: { self: true } },
    });
    type Payload = { kind: 'input' | 'output'; id: string; text: string; final: boolean };
    ch.on('broadcast', { event: 'caption' }, ({ payload }) => {
      const p = payload as Payload;
      pushLine(p.kind, { id: p.id, text: p.text, final: p.final });
    });
    ch.subscribe();
    channelRef.current = ch;
    return () => {
      try {
        ch.unsubscribe();
      } catch {
        // ignore
      }
      channelRef.current = null;
    };
  }, [pushLine, sessionId]);

  // Connect to the LiveKit room as a subscribe-only viewer. We grab a
  // short-lived token from our public API rather than handing the
  // viewer the host token.
  //
  // IMPORTANT: this effect must only re-run when `token` changes. Earlier
  // versions had `status` in the dep array — once `onParticipantConnected`
  // flipped status to 'live', the effect tore the room down and
  // immediately rebuilt it. That cycle (connect → setStatus('live') →
  // disconnect → reconnect) is what produced the symptom where the host
  // tracks "unpublished" right after the viewer joined and no audio
  // ever started flowing for the Translation track.
  useEffect(() => {
    if (initialStatus === 'ended') return;
    let cancelled = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const onTrackSubscribed = (track: RemoteTrack, pub: RemoteTrackPublication) => {
      if (track.kind !== 'audio') return;
      const name = pub.trackName as 'input' | 'output' | undefined;
      if (name !== 'input' && name !== 'output') return;
      trackByNameRef.current[name] = track as RemoteAudioTrack;
      trackPubByNameRef.current[name] = pub;
      const el = name === 'input' ? inputAudioRef.current : outputAudioRef.current;
      if (el) {
        track.attach(el);
        el.muted = mode !== name;
        el.play().catch(() => {
          // autoplay may be blocked until the viewer interacts — the
          // status banner asks for a click in that case
        });
      }
    };

    const onTrackUnsubscribed = (
      _track: RemoteTrack,
      pub: RemoteTrackPublication,
    ) => {
      const name = pub.trackName as 'input' | 'output' | undefined;
      if (name === 'input' || name === 'output') {
        trackByNameRef.current[name] = null;
      }
    };

    const onParticipantConnected = () => {
      setStatus('live');
    };

    const onDisconnected = () => {
      setStatus('ended');
    };

    const onAudioPlaybackChanged = () => {
      setNeedsTap(!room.canPlaybackAudio);
    };

    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.Disconnected, onDisconnected);
    room.on(RoomEvent.AudioPlaybackStatusChanged, onAudioPlaybackChanged);

    (async () => {
      try {
        const res = await fetch(
          `/api/translate/public/${encodeURIComponent(token)}/viewer-token`,
        );
        const json = (await res.json()) as
          | { livekit: { url: string; token: string } }
          | { error: string };
        if ('error' in json) throw new Error(json.error);
        if (cancelled) return;
        await room.connect(json.livekit.url, json.livekit.token);
        // Default to "input" audio on subscribe so the visitor hears
        // exactly one track when they land.
        applyMode();
        // canPlaybackAudio is initialized before connect resolves; if
        // the engine pre-blocked playback we surface the tap-to-enable
        // banner immediately rather than waiting for the first track.
        if (!room.canPlaybackAudio) setNeedsTap(true);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'connect_failed');
      }
    })();

    return () => {
      cancelled = true;
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.off(RoomEvent.AudioPlaybackStatusChanged, onAudioPlaybackChanged);
      void room.disconnect();
      roomRef.current = null;
    };
    // We intentionally do NOT include `status`, `mode`, or `applyMode`
    // in the deps: those change as a result of the room running, and
    // adding them would tear the room down on every event. The room
    // lives for as long as the token does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, initialStatus]);

  const visibleInput = useMemo(() => inputLines.slice(-40), [inputLines]);
  const visibleOutput = useMemo(() => outputLines.slice(-40), [outputLines]);

  // Synchronous user-gesture handler. On mobile we MUST call
  // room.startAudio() and the corresponding <audio>.play() from inside
  // this click — promises chained off it lose the gesture permission.
  const enableAudio = useCallback(() => {
    const room = roomRef.current;
    if (room) {
      void room.startAudio().catch(() => {});
    }
    if (mode === 'input') void inputAudioRef.current?.play().catch(() => {});
    if (mode === 'output') void outputAudioRef.current?.play().catch(() => {});
    setNeedsTap(false);
  }, [mode]);

  // When the visitor taps a different radio, that click is itself a user
  // gesture so we can opportunistically also unlock audio in case the
  // initial state wasn't tappable.
  const selectMode = useCallback(
    (m: AudioMode) => {
      const room = roomRef.current;
      if (room && !room.canPlaybackAudio) {
        void room.startAudio().catch(() => {});
      }
      setMode(m);
      if (m === 'input') void inputAudioRef.current?.play().catch(() => {});
      if (m === 'output') void outputAudioRef.current?.play().catch(() => {});
    },
    [],
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-[-0.02em] text-ink">
            Research-mochi · Live
          </h1>
          <p className="mt-1 text-[12px] text-mute">
            {COPY.hostLabel}: <span className="text-ink">{langName(sourceLang)}</span>
            {' · '}
            {COPY.viewerLabel}: <span className="text-ink">{langName(targetLang)}</span>
          </p>
        </div>
        <span
          className={`rounded-[4px] border px-2 py-0.5 text-[11px] ${
            status === 'live'
              ? 'border-amore text-amore'
              : status === 'ended'
                ? 'border-line text-mute'
                : 'border-line text-mute-soft'
          }`}
        >
          {COPY.status[status]}
        </span>
      </header>

      {needsTap ? (
        <button
          onClick={enableAudio}
          className="flex w-full items-center justify-between rounded-[4px] border border-amore bg-amore px-4 py-3 text-[13px] text-paper hover:opacity-90"
        >
          <span>Tap to enable audio</span>
          <span className="text-[11px] opacity-80">
            Mobile browsers require a tap to start playback
          </span>
        </button>
      ) : null}

      <fieldset className="flex flex-wrap items-center gap-4 rounded-[4px] border border-line bg-paper px-3 py-2 text-[12.5px] text-ink">
        <legend className="px-1 text-[11px] uppercase tracking-[0.08em] text-mute-soft">
          Audio
        </legend>
        {(['input', 'output', 'mute'] as const).map((m) => (
          <label key={m} className="flex items-center gap-2 text-[12.5px] text-ink">
            <input
              type="radio"
              name="audio-mode"
              checked={mode === m}
              onChange={() => selectMode(m)}
            />
            {m === 'input' && `${COPY.audioInput} (${langName(sourceLang)})`}
            {m === 'output' && `${COPY.audioOutput} (${langName(targetLang)})`}
            {m === 'mute' && COPY.audioMute}
          </label>
        ))}
        <span className="ml-auto text-[11px] text-mute-soft">
          {recordEnabled ? COPY.recordedHint : COPY.ephemeralHint}
        </span>
      </fieldset>

      {error ? (
        <div className="rounded-[4px] border border-line bg-paper px-3 py-2 text-[12px] text-mute">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <CaptionColumn label={`${langName(sourceLang)} (Original)`} lines={visibleInput} />
        <CaptionColumn label={`${langName(targetLang)} (Translation)`} lines={visibleOutput} />
      </div>

      <audio ref={inputAudioRef} autoPlay playsInline className="hidden" />
      <audio ref={outputAudioRef} autoPlay playsInline className="hidden" />
    </div>
  );
}

function CaptionColumn({ label, lines }: { label: string; lines: CaptionLine[] }) {
  return (
    <div className="rounded-[4px] border border-line bg-paper">
      <div className="border-b border-line-soft px-3 py-2 text-[11px] uppercase tracking-[0.08em] text-mute-soft">
        {label}
      </div>
      <div className="max-h-[480px] min-h-[300px] overflow-y-auto px-3 py-3 text-[13.5px] leading-[1.75] text-ink">
        {lines.length === 0 ? (
          <div className="text-mute-soft">…</div>
        ) : (
          lines.map((l) => (
            <p key={l.id} className={l.final ? '' : 'text-mute'}>
              {l.text}
              {l.final ? '' : '…'}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

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
import { Button } from '@/components/ui/button';
import { ChromeButton } from '@/components/ui/chrome-button';

type AudioMode = 'input' | 'output' | 'mute';
type SessionStatus = 'idle' | 'live' | 'ended';
// `ts` is wall-clock ms when the line was last updated. Used by the
// prompter pane to keep only the last 30 seconds on screen — older
// lines fade off the top edge but stay in state so PR-B can offer a
// full transcript download.
type CaptionLine = { id: string; text: string; final: boolean; ts: number };

type BackfillRow = { kind: 'input' | 'output'; text: string; lang: string | null; ts: string };

// Display window — mirrors the host. 30 seconds of translated lines.
const PROMPTER_WINDOW_MS = 30_000;

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
  // PR-B: downloads (audio + transcript) are gated to the host. The
  // anon viewer never sees a purchase path — just a notice once the
  // session ends.
  hostOnlyDownload: 'Audio and transcript download is host-only.',
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
  const [outputLines, setOutputLines] = useState<CaptionLine[]>([]);
  // Ticks once a second so the 30s prompter window slides forward even
  // when the host pauses speaking.
  const [now, setNow] = useState(() => Date.now());
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

  const pushLine = useCallback((line: CaptionLine) => {
    setOutputLines((prev) => {
      const idx = prev.findIndex((l) => l.id === line.id);
      if (idx === -1) return [...prev, line];
      const next = prev.slice();
      next[idx] = line;
      return next;
    });
  }, []);

  // Heartbeat — slides the prompter window forward when the host is
  // quiet.
  useEffect(() => {
    if (status === 'ended') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status]);

  // Resolve the audible track / muted state every time the mode flips.
  // We do this in BOTH places so the host can be confident a viewer
  // never accidentally hears both streams at once:
  //   1. setSubscribed on the unwanted track so the SFU stops shipping it
  //   2. <audio>.muted on the corresponding element so any in-flight
  //      buffer doesn't slip through during the unsubscribe round-trip
  // iOS-friendly mode application: BOTH tracks stay subscribed, we only
  // toggle the <audio>.muted attribute. iOS Safari can wedge if a track
  // is unsubscribed and re-subscribed mid-session (the first audio
  // chunk after re-subscription silently fails to decode), so the
  // subscribe lifecycle is now bound to the room, not the mode.
  const applyMode = useCallback(() => {
    if (inputAudioRef.current) {
      inputAudioRef.current.muted = mode !== 'input';
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
        // The viewer prompter only renders translated output. Input
        // captions are persisted server-side (for PR-B's bilingual
        // download) but never shown here, so we filter them out.
        const outputs: CaptionLine[] = [];
        for (const m of json.messages ?? []) {
          if (m.kind !== 'output') continue;
          outputs.push({
            id: `bf-${m.ts}-${m.kind}`,
            text: m.text,
            final: true,
            // Backfilled lines are all considered "now" so a late
            // joiner sees the most recent N seconds of context. The
            // wall-clock the host wrote at isn't useful for the
            // sliding window — we want the prompter to feel fresh
            // when the page mounts.
            ts: Date.now(),
          });
        }
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
      // Host stopped broadcasting input captions in PR-A, but we
      // defensively gate here too so an older host build never leaks
      // source-language text into the prompter pane.
      if (p.kind !== 'output') return;
      pushLine({ id: p.id, text: p.text, final: p.final, ts: Date.now() });
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
      console.info('[viewer] TrackSubscribed', {
        kind: track.kind,
        name: pub.trackName,
        sid: pub.trackSid,
      });
      if (track.kind !== 'audio') return;
      const name = pub.trackName as 'input' | 'output' | undefined;
      if (name !== 'input' && name !== 'output') return;
      trackByNameRef.current[name] = track as RemoteAudioTrack;
      trackPubByNameRef.current[name] = pub;
      // Let LiveKit own the <audio> element. It returns one already
      // wired up with the right attributes for iOS Safari/Chrome
      // (playsinline, autoplay, etc.). We bind that managed element to
      // our ref so mute/play decisions go to the same node LiveKit is
      // feeding.
      const audioEl = track.attach() as HTMLAudioElement;
      audioEl.style.position = 'fixed';
      audioEl.style.left = '-9999px';
      audioEl.style.width = '1px';
      audioEl.style.height = '1px';
      audioEl.muted = mode !== name;
      document.body.appendChild(audioEl);
      if (name === 'input') inputAudioRef.current = audioEl;
      else outputAudioRef.current = audioEl;
      // Always call play(); iOS lets a muted element start streaming so
      // that when the user later unmutes, the buffer is already flowing.
      audioEl.play().catch((err) => {
        console.warn('[viewer] play blocked, awaiting tap', { name, err });
      });
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
      console.info('[viewer] AudioPlaybackStatusChanged', {
        canPlaybackAudio: room.canPlaybackAudio,
      });
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
      // Detach + remove the LiveKit-managed <audio> elements from the
      // DOM. Skipping this leaves them appended to body across
      // remounts.
      for (const k of ['input', 'output'] as const) {
        const t = trackByNameRef.current[k];
        try {
          t?.detach().forEach((el) => el.remove());
        } catch {
          // ignore
        }
        trackByNameRef.current[k] = null;
        if (k === 'input') inputAudioRef.current = null;
        else outputAudioRef.current = null;
      }
      void room.disconnect();
      roomRef.current = null;
    };
    // We intentionally do NOT include `status`, `mode`, or `applyMode`
    // in the deps: those change as a result of the room running, and
    // adding them would tear the room down on every event. The room
    // lives for as long as the token does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, initialStatus]);

  // Display-only 30-second rolling window. Full transcript stays in
  // `outputLines` for PR-B's download path.
  const promptedLines = useMemo(
    () => outputLines.filter((l) => now - l.ts <= PROMPTER_WINDOW_MS),
    [outputLines, now],
  );

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
          <h1 className="text-3xl font-bold tracking-[-0.02em] text-ink">
            Research-mochi · Live
          </h1>
          <p className="mt-1 text-md text-mute">
            {COPY.hostLabel}: <span className="text-ink">{langName(sourceLang)}</span>
            {' · '}
            {COPY.viewerLabel}: <span className="text-ink">{langName(targetLang)}</span>
          </p>
        </div>
        <span
          className={`rounded-xs border px-2 py-0.5 text-sm ${
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
        // ChromeButton primary owns the 4px-radius amore-fill chrome
        // documented for this exact site. Layout overrides (justify-between,
        // taller px-4/py-3, text-lg) reproduce the original banner shape
        // — chrome lg defaults to h-8 + px-3 + text-md.
        <ChromeButton
          variant="primary"
          size="lg"
          fullWidth
          onClick={enableAudio}
          className="!flex !h-auto !justify-between !px-4 !py-3 !text-lg"
        >
          <span>Tap to enable audio</span>
          <span className="text-sm opacity-80">
            Mobile browsers require a tap to start playback
          </span>
        </ChromeButton>
      ) : null}

      <fieldset
        className="flex flex-wrap items-center gap-4 rounded-xs border border-line bg-paper px-3 py-2 text-md text-ink"
        role="radiogroup"
        aria-label="Audio"
      >
        <legend className="px-1 text-sm uppercase tracking-[0.08em] text-mute-soft">
          Audio
        </legend>
        {(['input', 'output', 'mute'] as const).map((m) => {
          const selected = mode === m;
          const label =
            m === 'input'
              ? `${COPY.audioInput} (${langName(sourceLang)})`
              : m === 'output'
                ? `${COPY.audioOutput} (${langName(targetLang)})`
                : COPY.audioMute;
          // Button role=radio matches the existing in-app pattern
          // (report-generator's REPORT_TYPES picker). variant="link" keeps
          // the row text-only; selected state reads amore + bold to mirror
          // the old "filled radio dot + label" affordance without a native
          // <input>.
          return (
            <Button
              key={m}
              variant="link"
              size="sm"
              role="radio"
              aria-checked={selected}
              onClick={() => selectMode(m)}
              className={
                selected
                  ? '!px-1 !text-md !text-amore'
                  : '!px-1 !font-normal !text-ink hover:!text-amore'
              }
            >
              {label}
            </Button>
          );
        })}
        <span className="ml-auto text-sm text-mute-soft">
          {recordEnabled ? COPY.recordedHint : COPY.ephemeralHint}
        </span>
      </fieldset>

      {error ? (
        <div className="rounded-xs border border-line bg-paper px-3 py-2 text-md text-mute">
          {error}
        </div>
      ) : null}

      {status === 'ended' ? (
        <div className="rounded-xs border border-line bg-paper px-3 py-2 text-md text-mute">
          {COPY.hostOnlyDownload}
        </div>
      ) : null}

      <PrompterPane lines={promptedLines} />

      {/* No pre-created <audio> elements: LiveKit's track.attach() now
          creates them inside onTrackSubscribed (it sets iOS-correct
          attributes and appends them to the body). */}
    </div>
  );
}

// Prompter pane — a single centred column, larger typography for
// at-a-glance readability on the public viewer. The chrome is the
// surrounding page; this component renders no border. Older lines
// fade out at the top edge as the 30s window slides forward.
function PrompterPane({ lines }: { lines: CaptionLine[] }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <div
      className="relative min-h-[420px]"
      style={{
        WebkitMaskImage:
          'linear-gradient(180deg, transparent 0%, #000 18%, #000 100%)',
        maskImage:
          'linear-gradient(180deg, transparent 0%, #000 18%, #000 100%)',
      }}
    >
      <div
        ref={scrollRef}
        className="mx-auto flex max-h-[68vh] min-h-[420px] w-full max-w-[820px] flex-col gap-4 overflow-y-auto px-4 py-10 text-3xl leading-[1.65] tracking-[-0.005em] text-ink"
      >
        {lines.length === 0 ? (
          <div className="m-auto text-center text-xl text-mute-soft">…</div>
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

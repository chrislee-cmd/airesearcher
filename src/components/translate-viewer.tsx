'use client';

// AI 동시통역 — public viewer (Memphis observer redesign, CD frames 01–06).
//
// SSOT = design-handoff/interpreter-observer/ (BUILD-SPEC §1 class map +
// `Interpreter Observer View.dc.html`). Legacy flat prompter layout →
// Memphis system: mint header band + language-pair pills + twin caption
// panels (ORIGINAL / TRANSLATION) + a bottom segmented channel bar. The
// presentation is a fresh build; only the LiveKit + Realtime + audio-unlock
// LOGIC below is preserved from the previous viewer.
//
// What runs here per share link:
//   1. backfill captions via /api/translate/public/:token/transcript-since
//      so a late-join visitor sees what's already been said (both original
//      + translation rows — the twin panels each need their own history)
//   2. subscribe to the Supabase Realtime broadcast channel
//      "live:<sessionId>" for live caption deltas (input + output)
//   3. fetch /api/translate/public/:token/viewer-token to mint a
//      subscribe-only LiveKit JWT and join the room
//   4. wire the audio mode radio (input / output / mute) so only one
//      track is ever audible:
//        - both tracks stay SUBSCRIBED (iOS Safari wedges if a track is
//          unsubscribed/re-subscribed mid-session — the audio-unlock
//          contract depends on this)
//        - <audio>.muted = !want is the only per-mode toggle
//
// Frame ↔ state mapping (§1):
//   01 audio locked   → `needsTap` (autoplay blocked) → unlock gate
//   05 waiting         → live but no captions yet → dashed twin panels
//   02 translation     → mode 'output'  → TRANSLATION panel emphasized + 🔊
//   03 original         → mode 'input'   → ORIGINAL panel emphasized + 🔊
//   04 muted            → mode 'mute'    → TRANSLATION emphasized (no 🔊) +
//                          peach channel bar
//   06 ended            → status 'ended' → neutral header + ✓ tile + duration

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Room,
  RoomEvent,
  type RemoteAudioTrack,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteVideoTrack,
} from 'livekit-client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient as createBrowserSupabase } from '@/lib/supabase/client';
import { getTranslateAnonId } from '@/lib/translate-anon-id';

type AudioMode = 'input' | 'output' | 'mute';
type SessionStatus = 'idle' | 'live' | 'ended';
// `ts` is wall-clock ms when the line was last updated. Kept in state
// (never pruned) so a future transcript-download path has the full history;
// the panels render the accumulated lines bottom-anchored + scrollable.
type CaptionLine = { id: string; text: string; final: boolean; ts: number };

type BackfillRow = { kind: 'input' | 'output'; text: string; lang: string | null; ts: string };

type Props = {
  token: string;
  sessionId: string;
  sourceLang: string;
  targetLang: string;
  initialStatus: SessionStatus;
  // Session start wall-clock (ISO) — drives the header LIVE elapsed timer
  // and the ended-screen session length (§4 contract-change #4: duration
  // comes from session state, no new API).
  startedAt: string | null;
  recordEnabled: boolean;
};

// CD renders the header title, headings and caption lines in Outfit
// (display). Same runtime var as the host fullview (STREAM_FONT) — no
// hardcoded font. `--font-outfit` is defined by the /live route layout.
const DISPLAY_FONT = {
  fontFamily: 'var(--font-outfit), var(--font-sans)',
} as const;

const LANG_LABEL: Record<string, string> = {
  // i18n-allow-korean -- 언어 라벨 endonym (각 언어를 자국어 표기로 노출, 번역 안 함)
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  th: 'ไทย',
  zh: '中文',
  es: 'Español',
};

// Language-pair pills mirror the CD comp's flag + endonym. Flag maps the
// language code to a representative region glyph; unknown codes render
// without a flag (label still shows via langName). Emoji, not literals.
const LANG_FLAG: Record<string, string> = {
  ko: '🇰🇷',
  en: '🇺🇸',
  ja: '🇯🇵',
  th: '🇹🇭',
  zh: '🇨🇳',
  es: '🇪🇸',
};

function langName(code: string) {
  return LANG_LABEL[code] ?? code.toUpperCase();
}

// This public page deliberately bypasses next-intl (see /live layout): it
// renders in English chrome, and the *content* (captions) is already in the
// visitor's target language. Copy lives here as a flat English map — zero
// Korean literals. (Full 4-locale visitor-language chrome would require
// wiring next-intl into this bypass route, which is out of scope.)
const COPY = {
  headerTitle: 'Live Interpreter',
  livePill: 'LIVE',
  endedPill: 'ENDED',
  audioChannel: 'AUDIO CHANNEL',
  audioChannelMuted: 'AUDIO CHANNEL · MUTED',
  channelHelper: 'Captions keep running on any channel.',
  channelHelperMuted: 'Following by captions only.',
  channelLockedHelper: 'Available after you enable audio.',
  seg: { input: 'Original', output: 'Translation', mute: 'Mute' },
  original: 'ORIGINAL',
  translation: 'TRANSLATION',
  playing: '🔊 PLAYING',
  captionsOnly: 'CAPTIONS ONLY',
  sharedScreen: {
    sharing: 'SHARING',
    address: '🖥️ Host is sharing a screen',
    viewOnly: "View only · you can't control the shared screen",
  },
  unlock: {
    heading: 'Tap to start listening',
    reason:
      'Your browser needs one tap before it can play live audio. Captions start at the same time.',
    cta: '▶ Enable audio',
    footnote: 'Prefer to read only? You can mute after enabling.',
  },
  waiting: {
    heading: 'Waiting for the first words…',
    hint: 'Captions appear here the moment someone speaks. Audio is already connected.',
  },
  ended: {
    heading: 'The session has ended',
    body: 'Thanks for listening. Live interpretation for this session is no longer broadcasting.',
  },
  connectError: 'Could not connect to the live session. Please refresh to try again.',
} as const;

// mm:ss (minutes may exceed 59 → shown as total minutes, matching CD "24:18").
function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function TranslateViewer({
  token,
  sessionId,
  sourceLang,
  targetLang,
  initialStatus,
  startedAt,
  recordEnabled,
}: Props) {
  const [status, setStatus] = useState<SessionStatus>(initialStatus);
  const [mode, setMode] = useState<AudioMode>('input');
  const [inputLines, setInputLines] = useState<CaptionLine[]>([]);
  const [outputLines, setOutputLines] = useState<CaptionLine[]>([]);
  // Ticks once a second so the header elapsed timer stays live even while
  // the host is quiet.
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  // Frozen wall-clock ms captured when the session transitions to 'ended'
  // during this page's lifetime, so the ended screen can show an accurate
  // session length. Null when the page loads already-ended (no reliable end
  // time without a new API) — the ended screen then shows the language pair
  // only rather than a fabricated duration.
  const [endedAt, setEndedAt] = useState<number | null>(null);
  // Mobile browsers (especially iOS Safari) block <audio>.play() that
  // wasn't called from inside a user gesture. LiveKit signals this via
  // RoomEvent.AudioPlaybackStatusChanged. When blocked we show the unlock
  // gate (frame 01) and call room.startAudio() from the CTA click — that
  // single user-gesture unlocks playback for every track in the room.
  const [needsTap, setNeedsTap] = useState(false);
  // 🖥️ Shared-screen relay (frame 07). Non-null when the host is publishing a
  // 'screen' video track → the screen renders on top and captions drop to two
  // columns below. Null (mic-only session or host stopped sharing) → the
  // captions keep the vertical stack (frames 02–04). Video is progressive
  // enhancement: audio + captions are unaffected either way.
  const [screenTrack, setScreenTrack] = useState<RemoteVideoTrack | null>(null);

  const roomRef = useRef<Room | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const inputAudioRef = useRef<HTMLAudioElement | null>(null);
  const outputAudioRef = useRef<HTMLAudioElement | null>(null);
  const trackByNameRef = useRef<Record<'input' | 'output', RemoteAudioTrack | null>>({
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

  // Heartbeat — keeps the header elapsed timer moving while the host is
  // quiet. Stops once the session ends.
  useEffect(() => {
    if (status === 'ended') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status]);

  // Resolve the audible track / muted state every time the mode flips.
  // iOS-friendly: BOTH tracks stay subscribed, we only toggle
  // <audio>.muted. iOS Safari can wedge if a track is unsubscribed and
  // re-subscribed mid-session, so the subscribe lifecycle is bound to the
  // room, not the mode.
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
  // otherwise the RPC returns empty by design). Both original + translation
  // rows are kept: the redesign's twin panels each render their own
  // history, so — unlike the legacy translation-only prompter — original
  // (input) captions now belong in the dedicated ORIGINAL panel.
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
            // Backfilled lines are all stamped "now" so a late joiner sees
            // recent context anchored to page mount.
            ts: Date.now(),
          };
          if (m.kind === 'input') inputs.push(line);
          else outputs.push(line);
        }
        if (inputs.length) setInputLines(inputs);
        if (outputs.length) setOutputLines(outputs);
      } catch {
        // best-effort — live deltas will fill the panels anyway
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recordEnabled, token]);

  // Subscribe to the broadcast channel for live caption deltas. Both kinds
  // are routed to their panel; original captions land in the ORIGINAL panel
  // (a dedicated surface in the redesign, no longer a leak into the
  // translation stream).
  useEffect(() => {
    const supa = createBrowserSupabase();
    const ch = supa.channel(`live:${sessionId}`, {
      config: { broadcast: { self: true } },
    });
    type Payload = { kind: 'input' | 'output'; id: string; text: string; final: boolean };
    ch.on('broadcast', { event: 'caption' }, ({ payload }) => {
      const p = payload as Payload;
      if (p.kind !== 'input' && p.kind !== 'output') return;
      pushLine(p.kind, { id: p.id, text: p.text, final: p.final, ts: Date.now() });
    });
    // Presence: announce this viewer so the host's listener panel can show
    // who is currently tuned in. Best-effort — no extra fetch, no DB write.
    ch.subscribe((subStatus) => {
      if (subStatus !== 'SUBSCRIBED') return;
      void ch.track({
        anon_id: getTranslateAnonId(),
        joined_at: new Date().toISOString(),
        user_agent:
          typeof navigator !== 'undefined' ? navigator.userAgent : '',
      });
    });
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

  // Connect to the LiveKit room as a subscribe-only viewer. This effect
  // must only re-run when `token`/`initialStatus` change — see the long
  // note at the cleanup return about why `status`/`mode` are excluded.
  useEffect(() => {
    if (initialStatus === 'ended') return;
    let cancelled = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const onTrackSubscribed = (track: RemoteTrack, pub: RemoteTrackPublication) => {
      // 🖥️ Shared-screen video (frame 07). Store the track so React renders the
      // ScreenStage; the <video> attach happens in that component's effect.
      if (track.kind === 'video' && pub.trackName === 'screen') {
        setScreenTrack(track as RemoteVideoTrack);
        return;
      }
      if (track.kind !== 'audio') return;
      const name = pub.trackName as 'input' | 'output' | undefined;
      if (name !== 'input' && name !== 'output') return;
      trackByNameRef.current[name] = track as RemoteAudioTrack;
      // Let LiveKit own the <audio> element — it returns one already wired
      // for iOS Safari/Chrome (playsinline, autoplay). Bind it to our ref
      // so mute/play decisions go to the same node LiveKit feeds.
      const audioEl = track.attach() as HTMLAudioElement;
      audioEl.style.position = 'fixed';
      audioEl.style.left = '-9999px';
      audioEl.style.width = '1px';
      audioEl.style.height = '1px';
      audioEl.muted = mode !== name;
      document.body.appendChild(audioEl);
      if (name === 'input') inputAudioRef.current = audioEl;
      else outputAudioRef.current = audioEl;
      // Always call play(); iOS lets a muted element start streaming so the
      // buffer is already flowing when the user later unmutes.
      audioEl.play().catch(() => {});
    };

    const onTrackUnsubscribed = (
      _track: RemoteTrack,
      pub: RemoteTrackPublication,
    ) => {
      // 🖥️ Host stopped sharing → drop back to the vertical caption stack.
      if (pub.trackName === 'screen') {
        setScreenTrack(null);
        return;
      }
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
      // Freeze the end time so the ended screen can report session length.
      setEndedAt(Date.now());
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
        if (!room.canPlaybackAudio) setNeedsTap(true);
      } catch {
        if (cancelled) return;
        setError(COPY.connectError);
      }
    })();

    return () => {
      cancelled = true;
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.off(RoomEvent.AudioPlaybackStatusChanged, onAudioPlaybackChanged);
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
      // 🖥️ Detach happens in ScreenStage's own effect cleanup; just drop the
      // reference so a re-connect starts from the vertical stack.
      setScreenTrack(null);
      void room.disconnect();
      roomRef.current = null;
    };
    // We intentionally do NOT include `status`, `mode`, or `applyMode` in
    // the deps: those change as a result of the room running, and adding
    // them would tear the room down on every event. The room lives for as
    // long as the token does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, initialStatus]);

  // Synchronous user-gesture handler. On mobile we MUST call
  // room.startAudio() and <audio>.play() from inside this click — promises
  // chained off it lose the gesture permission. This is the audio-unlock
  // contract: the CTA click IS the play() trigger.
  const enableAudio = useCallback(() => {
    const room = roomRef.current;
    if (room) {
      void room.startAudio().catch(() => {});
    }
    if (mode === 'input') void inputAudioRef.current?.play().catch(() => {});
    if (mode === 'output') void outputAudioRef.current?.play().catch(() => {});
    setNeedsTap(false);
  }, [mode]);

  // When the visitor taps a different channel, that click is itself a user
  // gesture so we opportunistically unlock audio in case the initial state
  // wasn't tappable.
  const selectMode = useCallback((m: AudioMode) => {
    const room = roomRef.current;
    if (room && !room.canPlaybackAudio) {
      void room.startAudio().catch(() => {});
    }
    setMode(m);
    if (m === 'input') void inputAudioRef.current?.play().catch(() => {});
    if (m === 'output') void outputAudioRef.current?.play().catch(() => {});
  }, []);

  const ended = status === 'ended';
  const locked = !ended && needsTap;
  const hasCaptions = inputLines.length > 0 || outputLines.length > 0;
  // Frame 05: connected + audio available but nothing spoken yet.
  const waiting = !ended && !locked && !hasCaptions;

  // Header LIVE elapsed timer — seconds since started_at. Frame 01 (locked)
  // shows a bare "LIVE" (matches CD); once listening, the timer runs.
  const startedMs = startedAt ? Date.parse(startedAt) : NaN;
  const elapsedLabel =
    !Number.isNaN(startedMs) && !locked && status === 'live'
      ? ` ${formatDuration((now - startedMs) / 1000)}`
      : '';

  // Ended-screen session length (frame 06). Accurate only when we observed
  // the live→ended transition this session (endedAt captured).
  const endedDuration =
    endedAt != null && !Number.isNaN(startedMs)
      ? formatDuration((endedAt - startedMs) / 1000)
      : null;

  const langPair = `${langName(sourceLang)} → ${langName(targetLang)}`;

  // Panel emphasis + badges (§1, frames 02/03/04):
  //   input  → ORIGINAL emphasized (ink shadow) + 🔊 on ORIGINAL
  //   output → TRANSLATION emphasized (success shadow) + 🔊 on TRANSLATION
  //   mute   → TRANSLATION emphasized (success shadow), no 🔊
  // "CAPTIONS ONLY" marks the translation panel only when original is the
  // audible channel (mode input).
  const originalEmphasized = mode === 'input';
  const translationEmphasized = mode === 'output' || mode === 'mute';

  // Twin ORIGINAL/TRANSLATION panels — laid out vertically by default (frames
  // 02–04) or as two columns under the shared screen (frame 07). Same panels
  // either way; only the parent flex direction changes. Each panel is
  // `flex-1`, so it fills a column or a row cell identically.
  const twinPanels = waiting ? (
    <>
      <WaitingPanel
        tone="original"
        langLabel={langName(sourceLang)}
        variant="dots"
      />
      <WaitingPanel
        tone="translation"
        langLabel={langName(targetLang)}
        variant="text"
      />
    </>
  ) : (
    <>
      <CaptionPanel
        tone="original"
        label={COPY.original}
        langLabel={langName(sourceLang)}
        lines={inputLines}
        emphasized={originalEmphasized}
        playing={mode === 'input'}
        captionsOnly={false}
      />
      <CaptionPanel
        tone="translation"
        label={COPY.translation}
        langLabel={langName(targetLang)}
        lines={outputLines}
        emphasized={translationEmphasized}
        playing={mode === 'output'}
        captionsOnly={mode === 'input'}
      />
    </>
  );

  return (
    <div className="flex min-h-0 w-full max-w-[600px] flex-1 flex-col">
      {/* Page frame — border 3px ink · radius 16 · fv-frame shadow · canvas bg */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--fv-radius-panel-lg)] border-[3px] border-ink bg-surface-canvas shadow-[var(--fv-frame-shadow)]">
        <ViewerHeader
          ended={ended}
          liveLabel={ended ? COPY.endedPill : `${COPY.livePill}${elapsedLabel}`}
          sourceLang={sourceLang}
          targetLang={targetLang}
        />

        {ended ? (
          <EndedScreen langPair={langPair} duration={endedDuration} />
        ) : locked ? (
          <UnlockGate onEnable={enableAudio} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-[14px] p-[18px]">
            {error ? (
              <div
                role="alert"
                className="rounded-sm border-2 border-ink bg-paper px-[15px] py-[11px] text-md font-bold text-mute shadow-memphis-sm"
              >
                {error}
              </div>
            ) : null}
            {screenTrack ? (
              // Frame 07 — shared screen on top, captions in two columns below.
              <>
                <ScreenStage track={screenTrack} />
                <div className="flex min-h-0 flex-1 gap-[14px]">
                  {twinPanels}
                </div>
              </>
            ) : (
              // Frames 02–04 — captions vertical stack (no screen being shared).
              twinPanels
            )}
          </div>
        )}

        {!ended ? (
          <ChannelBar
            mode={mode}
            locked={locked}
            sourceLang={sourceLang}
            targetLang={targetLang}
            onSelect={selectMode}
          />
        ) : null}
      </div>
    </div>
  );
}

// ── Header band (mint · ended = surface-disabled) ───────────────────────
function ViewerHeader({
  ended,
  liveLabel,
  sourceLang,
  targetLang,
}: {
  ended: boolean;
  liveLabel: string;
  sourceLang: string;
  targetLang: string;
}) {
  return (
    <header
      className={`flex shrink-0 flex-col gap-[11px] border-b-[3px] border-ink px-[22px] py-4 ${
        ended ? 'bg-surface-disabled' : 'bg-mint'
      }`}
    >
      <div className="flex items-center gap-[11px]">
        <span aria-hidden className="text-2xl leading-none">
          🎧
        </span>
        <div className="min-w-0 flex-1">
          <div
            className="text-3xl font-extrabold tracking-[-0.02em] text-ink"
            style={DISPLAY_FONT}
          >
            {COPY.headerTitle}
          </div>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-pill border-[1.5px] border-ink bg-paper px-3 py-1 font-mono-label text-sm font-bold shadow-memphis-sm ${
            ended ? 'text-mute-soft' : 'text-ink'
          }`}
        >
          <span
            aria-hidden
            className={`h-[7px] w-[7px] rounded-full ${
              ended ? 'bg-mute-soft' : 'bg-amore'
            }`}
          />
          {liveLabel}
        </span>
      </div>
      {!ended ? (
        <div className="flex items-center gap-[9px]">
          <LangPill code={sourceLang} />
          <span aria-hidden className="text-xl text-ink">
            →
          </span>
          <LangPill code={targetLang} />
        </div>
      ) : null}
    </header>
  );
}

function LangPill({ code }: { code: string }) {
  const flag = LANG_FLAG[code];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pill border-[1.5px] border-ink bg-paper px-3 py-1 text-md font-bold text-ink">
      {flag ? <span aria-hidden>{flag}</span> : null}
      {langName(code)}
    </span>
  );
}

// ── Shared-screen stage (frame 07) ──────────────────────────────────────
// Mirrors the interpreter fullview's ShareMonitor (frame 10, merged) — the
// dark macOS-style monitor chrome is CD, and the interior renders the REAL
// relayed screen (CD's participant-tile stage is an example only; spec §4).
// The RemoteVideoTrack lifecycle is owned by LiveKit/the room effect; here we
// only attach/detach it to the <video>. Video is muted — audio flows through
// the separate 'input'/'output' tracks and the channel bar (playsInline +
// muted keeps iOS autoplay independent of the audio-unlock gate).
function ScreenStage({ track }: { track: RemoteVideoTrack }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return (
    <div className="flex min-h-0 flex-[1.2] flex-col overflow-hidden rounded-[var(--fv-radius-panel-lg)] border-[3px] border-ink bg-ink shadow-memphis-md">
      {/* titlebar — macOS traffic lights (장식 예외) + address chip + SHARING */}
      <div className="flex shrink-0 items-center gap-2 border-b-[1.5px] border-[color:var(--border-strong)] bg-ink-2 px-[13px] py-[9px]">
        {/* design-allow-hardcoded -- CD frame 07 traffic lights = literal macOS chrome (장식, 토큰 아님; interpreter-fullview ShareMonitor 선례) */}
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <span
            key={c}
            aria-hidden
            className="h-[11px] w-[11px] rounded-full"
            style={{ background: c }}
          />
        ))}
        {/* design-allow-hardcoded -- CD frame 07 address chip radius 6 (승격 fv radius 스케일 8~16 밖, ShareMonitor UrlPill 선례) */}
        <div className="ml-2 min-w-0 flex-1 truncate rounded-[6px] bg-ink px-[11px] py-1 font-mono-label text-sm text-faint">
          {COPY.sharedScreen.address}
        </div>
        <span className="shrink-0 font-mono-label text-xs font-bold tracking-[0.14em] text-mint">
          ● {COPY.sharedScreen.sharing}
        </span>
      </div>
      {/* body — the real relayed screen (read-only). object-contain preserves
          aspect ratio with an ink letterbox; the view-only note sits over it. */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-ink">
        <video
          ref={videoRef}
          className="h-full w-full bg-ink object-contain"
          autoPlay
          playsInline
          muted
        />
        {/* CD draws this over a light tile-stage; over the real (dark
            letterboxed) video we back it with a faint ink pill for legibility. */}
        <span className="absolute bottom-3 left-4 rounded-sm bg-ink/70 px-2 py-1 font-mono-label text-xs text-faint">
          {COPY.sharedScreen.viewOnly}
        </span>
      </div>
    </div>
  );
}

// ── Twin caption panel (ORIGINAL / TRANSLATION) ─────────────────────────
function CaptionPanel({
  tone,
  label,
  langLabel,
  lines,
  emphasized,
  playing,
  captionsOnly,
}: {
  tone: 'original' | 'translation';
  label: string;
  langLabel: string;
  lines: CaptionLine[];
  emphasized: boolean;
  playing: boolean;
  captionsOnly: boolean;
}) {
  const isTranslation = tone === 'translation';
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  // Emphasized channel → 3px border + colored hard shadow (success for
  // translation, ink for original). Idle → 2px + soft ink shadow.
  const frame = emphasized
    ? `border-[3px] ${isTranslation ? 'shadow-memphis-md-success' : 'shadow-memphis-md'}`
    : 'border-2 shadow-memphis-sm';

  return (
    <section
      className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-sm border-ink bg-paper ${frame}`}
    >
      <header
        className={`flex shrink-0 items-center gap-2 border-b-2 border-ink px-4 py-[10px] ${
          isTranslation ? 'bg-success-bg-soft' : 'bg-paper-soft'
        }`}
      >
        <span
          aria-hidden
          className={`h-2 w-2 rounded-full ${
            isTranslation
              ? 'bg-success'
              : emphasized
                ? 'bg-ink'
                : 'bg-mute-soft'
          }`}
        />
        <span
          className={`font-mono-label text-xs font-bold tracking-[0.14em] ${
            isTranslation
              ? 'text-success'
              : emphasized
                ? 'text-mute'
                : 'text-mute-soft'
          }`}
        >
          {label}
        </span>
        <span className="text-xl font-bold text-ink" style={DISPLAY_FONT}>
          {langLabel}
        </span>
        {playing ? (
          <span
            className={`ml-auto inline-flex items-center gap-1.5 rounded-pill border-[1.4px] font-mono-label text-xs font-bold ${
              isTranslation
                ? 'border-success-line bg-success-bg text-success-text'
                : 'border-ink bg-paper text-ink'
            } px-[9px] py-0.5`}
          >
            {COPY.playing}
          </span>
        ) : captionsOnly ? (
          <span className="ml-auto font-mono-label text-xs font-bold text-mute-soft">
            {COPY.captionsOnly}
          </span>
        ) : null}
      </header>
      <div
        ref={scrollRef}
        className="sc flex min-h-0 flex-1 flex-col justify-end gap-4 overflow-y-auto px-5 py-5"
        style={DISPLAY_FONT}
      >
        {lines.length === 0 ? (
          <p className="text-3xl leading-[1.6] text-faint">…</p>
        ) : (
          lines.map((l, i) => {
            const active = i === lines.length - 1;
            return (
              <p
                key={l.id}
                className={`text-3xl leading-[1.6] ${
                  active
                    ? `text-ink ${isTranslation ? 'font-semibold' : ''}`
                    : 'text-faint'
                }`}
              >
                {l.text}
                {active && !l.final ? (
                  <span className="text-faint">…</span>
                ) : null}
              </p>
            );
          })
        )}
      </div>
    </section>
  );
}

// ── Waiting panel (frame 05 — dashed, pre-speech) ───────────────────────
function WaitingPanel({
  tone,
  langLabel,
  variant,
}: {
  tone: 'original' | 'translation';
  langLabel: string;
  variant: 'dots' | 'text';
}) {
  const label = tone === 'translation' ? COPY.translation : COPY.original;
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-sm border-[1.8px] border-dashed border-line-empty bg-paper-soft">
      <header className="flex shrink-0 items-center gap-2 border-b-[1.5px] border-dashed border-line-empty px-4 py-[10px]">
        <span aria-hidden className="h-2 w-2 rounded-full bg-line-empty" />
        <span className="font-mono-label text-xs font-bold tracking-[0.14em] text-faint">
          {label}
        </span>
        <span className="text-xl font-bold text-faint" style={DISPLAY_FONT}>
          {langLabel}
        </span>
      </header>
      {variant === 'dots' ? (
        <div className="flex flex-1 items-center justify-center">
          <span
            aria-hidden
            className="font-mono-label text-3xl tracking-[0.3em] text-line-empty"
          >
            ● ● ●
          </span>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-[9px] px-5 text-center">
          <div className="text-lg font-bold text-mute">{COPY.waiting.heading}</div>
          <div className="max-w-[280px] text-md leading-[1.5] text-mute-soft">
            {COPY.waiting.hint}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Unlock gate (frame 01) ──────────────────────────────────────────────
function UnlockGate({ onEnable }: { onEnable: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[15px] p-10 text-center">
      <div className="flex h-[74px] w-[74px] items-center justify-center rounded-md border-[3px] border-ink bg-mint text-display shadow-memphis-lg">
        <span aria-hidden>🔈</span>
      </div>
      <div
        className="text-3xl font-extrabold tracking-[-0.02em] text-ink"
        style={DISPLAY_FONT}
      >
        {COPY.unlock.heading}
      </div>
      <div className="max-w-[330px] text-lg leading-[1.6] text-mute">
        {COPY.unlock.reason}
      </div>
      {/* Primary CTA — this click IS the audio-unlock user gesture. Native
          button: CD's ink-solid rounded-pill chrome doesn't map to a Button
          primitive variant (§7.11 radius/fill), same precedent as the host
          fullview's ink-solid action buttons. */}
      {/* eslint-disable-next-line react/forbid-elements -- CD frame 01 primary CTA = ink-solid rounded-pill gesture button; Button primitive variants don't match this chrome (fullview action-button precedent) */}
      <button
        type="button"
        onClick={onEnable}
        className="mt-1.5 inline-flex items-center gap-2 rounded-pill border-2 border-ink bg-ink px-[30px] py-3.5 text-xl font-extrabold text-paper shadow-memphis-lg"
      >
        {COPY.unlock.cta}
      </button>
      <div className="text-sm text-mute-soft">{COPY.unlock.footnote}</div>
    </div>
  );
}

// ── Ended screen (frame 06) ─────────────────────────────────────────────
function EndedScreen({
  langPair,
  duration,
}: {
  langPair: string;
  duration: string | null;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-10 text-center">
      <div className="flex h-[72px] w-[72px] items-center justify-center rounded-md border-[3px] border-ink bg-paper text-display shadow-memphis-lg">
        <span aria-hidden>✓</span>
      </div>
      <div
        className="text-3xl font-extrabold tracking-[-0.02em] text-ink"
        style={DISPLAY_FONT}
      >
        {COPY.ended.heading}
      </div>
      <div className="max-w-[360px] text-xl leading-[1.6] text-mute">
        {COPY.ended.body}
      </div>
      <div className="mt-1 font-mono-label text-sm text-faint">
        {duration ? `${duration} · ${langPair}` : langPair}
      </div>
    </div>
  );
}

// ── Bottom segmented channel bar ────────────────────────────────────────
// Frames 01(disabled) · 02/03/05(default) · 04(muted → peach bar).
function ChannelBar({
  mode,
  locked,
  sourceLang,
  targetLang,
  onSelect,
}: {
  mode: AudioMode;
  locked: boolean;
  sourceLang: string;
  targetLang: string;
  onSelect: (m: AudioMode) => void;
}) {
  const muted = mode === 'mute';
  const segs: { key: AudioMode; label: string }[] = [
    {
      key: 'input',
      label: `${LANG_FLAG[sourceLang] ?? ''} ${COPY.seg.input}`.trim(),
    },
    {
      key: 'output',
      label: `${LANG_FLAG[targetLang] ?? ''} ${COPY.seg.output}`.trim(),
    },
    { key: 'mute', label: `🔇 ${COPY.seg.mute}` },
  ];

  return (
    <div
      className={`flex shrink-0 flex-col gap-2 border-t-2 border-ink px-[18px] py-[13px] ${
        muted ? 'bg-peach-bg' : 'bg-paper'
      }`}
    >
      <div className="flex items-center gap-[9px]">
        <span
          className={`font-mono-label text-xs font-bold tracking-[0.14em] ${
            muted ? 'text-warning-text' : 'text-mute-soft'
          }`}
        >
          {muted ? COPY.audioChannelMuted : COPY.audioChannel}
        </span>
        <span
          className={`ml-auto text-sm ${
            muted
              ? 'text-warning-text'
              : locked
                ? 'text-mute-soft'
                : 'text-mute-soft'
          }`}
        >
          {locked
            ? COPY.channelLockedHelper
            : muted
              ? COPY.channelHelperMuted
              : COPY.channelHelper}
        </span>
      </div>
      {/* Segmented control — joined rounded-pill segments. Disabled (frame
          01) uses a surface-disabled track + ink/32 border and NO wrapper
          opacity (a11y: labels stay ≥4.5:1 via text-mute). Native buttons:
          the joined-segment ink-fill chrome has no Button primitive variant
          (§7.11), same precedent as the host fullview's custom chrome. */}
      <div
        role="radiogroup"
        aria-label={COPY.audioChannel}
        className={`inline-flex self-start overflow-hidden rounded-pill border-2 ${
          locked ? 'border-ink/32' : 'border-ink shadow-memphis-sm'
        }`}
      >
        {segs.map((s) => {
          const selected = !locked && mode === s.key;
          return (
            // eslint-disable-next-line react/forbid-elements -- CD segmented control = joined rounded-pill segments with ink-fill active; no Button primitive variant matches this chrome (fullview custom-chrome precedent)
            <button
              key={s.key}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={locked}
              onClick={() => onSelect(s.key)}
              className={`px-4 py-2 text-md ${
                selected
                  ? 'bg-ink font-extrabold text-paper'
                  : locked
                    ? 'bg-surface-disabled font-semibold text-mute'
                    : 'bg-paper font-semibold text-mute'
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

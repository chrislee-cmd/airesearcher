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
import { useTranslations } from 'next-intl';
import { Room, LocalAudioTrack } from 'livekit-client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient as createBrowserSupabase } from '@/lib/supabase/client';

type Status = 'idle' | 'starting' | 'live' | 'ending' | 'ended' | 'error';

type CaptionLine = {
  id: string;
  text: string;
  final: boolean;
};

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

function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function TranslateConsole() {
  const t = useTranslations('TranslateConsole');

  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sourceLang, setSourceLang] = useState('ko');
  const [targetLang, setTargetLang] = useState('en');
  const [recordEnabled, setRecordEnabled] = useState(true);
  const [monitorTranslation, setMonitorTranslation] = useState(true);
  // 'mic' = host's microphone; 'tab' = a browser tab's audio
  // (e.g. a Zoom/Meet/Teams call running in another tab). Tab capture
  // goes through getDisplayMedia, which on every supported browser
  // requires a user gesture and a tab-picker UI, so we lock this to
  // the host's choice and only acquire when the host clicks Start.
  const [inputSource, setInputSource] = useState<'mic' | 'tab'>('mic');

  const [inputLines, setInputLines] = useState<CaptionLine[]>([]);
  const [outputLines, setOutputLines] = useState<CaptionLine[]>([]);
  const [elapsed, setElapsed] = useState(0);

  const [shareToken, setShareToken] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

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

  // Heartbeat ticker for elapsed display.
  useEffect(() => {
    if (status !== 'live') {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      return;
    }
    tickRef.current = setInterval(() => {
      if (startedAtRef.current) {
        setElapsed(Date.now() - startedAtRef.current);
      }
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [status]);

  // Monitor audio routing.
  useEffect(() => {
    if (!monitorAudioRef.current) return;
    monitorAudioRef.current.muted = !monitorTranslation;
  }, [monitorTranslation]);

  const cleanup = useCallback(() => {
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
      void audioCtxRef.current?.close();
    } catch {}
    audioCtxRef.current = null;
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

  const handleOaiEvent = useCallback(
    (raw: string) => {
      let msg: { type?: string; [k: string]: unknown };
      try {
        msg = JSON.parse(raw) as { type?: string };
      } catch {
        return;
      }
      const type = msg.type ?? '';

      // Source-language transcription. The model emits a stream of
      // deltas keyed by conversation-item id and a single `.completed`
      // when the item closes; we buffer per-item so deltas merge
      // cleanly into the final transcript.
      if (type === 'conversation.item.input_audio_transcription.delta') {
        const itemId = String(msg.item_id ?? msg.id ?? 'in');
        const delta = String(msg.delta ?? '');
        const prev = partialInputRef.current.get(itemId)?.text ?? '';
        const next = prev + delta;
        partialInputRef.current.set(itemId, { id: itemId, text: next });
        const line: CaptionLine = { id: itemId, text: next, final: false };
        pushLine('input', line);
        broadcastCaption('input', line, sourceLang);
        return;
      }
      if (type === 'conversation.item.input_audio_transcription.completed') {
        const itemId = String(msg.item_id ?? msg.id ?? 'in');
        const text = String(
          msg.transcript ?? partialInputRef.current.get(itemId)?.text ?? '',
        );
        partialInputRef.current.delete(itemId);
        const line: CaptionLine = { id: itemId, text, final: true };
        pushLine('input', line);
        broadcastCaption('input', line, sourceLang);
        if (text.trim()) void persistMessage('input', text, sourceLang);
        return;
      }

      // Translated text. OpenAI has shipped both `response.text.*` and
      // `response.output_text.*` over time — handle either so we don't
      // regress on a server-side rename.
      if (type === 'response.text.delta' || type === 'response.output_text.delta') {
        const itemId = String(msg.response_id ?? msg.item_id ?? 'out');
        const delta = String(msg.delta ?? '');
        const prev = partialOutputRef.current.get(itemId)?.text ?? '';
        const next = prev + delta;
        partialOutputRef.current.set(itemId, { id: itemId, text: next });
        const line: CaptionLine = { id: itemId, text: next, final: false };
        pushLine('output', line);
        broadcastCaption('output', line, targetLang);
        return;
      }
      if (type === 'response.text.done' || type === 'response.output_text.done') {
        const itemId = String(msg.response_id ?? msg.item_id ?? 'out');
        const text = String(
          msg.text ?? partialOutputRef.current.get(itemId)?.text ?? '',
        );
        partialOutputRef.current.delete(itemId);
        const line: CaptionLine = { id: itemId, text, final: true };
        pushLine('output', line);
        broadcastCaption('output', line, targetLang);
        if (text.trim()) void persistMessage('output', text, targetLang);
        return;
      }
    },
    [broadcastCaption, persistMessage, pushLine, sourceLang, targetLang],
  );

  const start = useCallback(async () => {
    if (status === 'live' || status === 'starting') return;
    setError(null);
    setInputLines([]);
    setOutputLines([]);
    setElapsed(0);
    setShareToken(null);
    setShareCopied(false);
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
          return;
        }
        mic = new MediaStream(audioTracks);
      } else {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    } catch {
      setError(inputSource === 'tab' ? 'tab_audio_denied' : 'microphone_denied');
      setStatus('error');
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
      cleanup();
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
        monitorAudioRef.current.muted = !monitorTranslation;
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
      const sdpRes = await fetch(
        'https://api.openai.com/v1/realtime/calls',
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
      cleanup();
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
  }, [
    cleanup,
    handleOaiEvent,
    inputSource,
    monitorTranslation,
    recordEnabled,
    sourceLang,
    targetLang,
    status,
  ]);

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
        const finalLine: CaptionLine = { id: current.id, text: current.text.trim(), final: true };
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
    cleanup();
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
  }, [broadcastCaption, cleanup, persistMessage, pushLine, sourceLang, status, targetLang]);

  // Stop on unmount.
  useEffect(() => {
    return () => {
      cleanup();
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
        <label className="flex items-center gap-2 text-[12.5px] text-mute">
          <input
            type="checkbox"
            checked={monitorTranslation}
            onChange={(e) => setMonitorTranslation(e.target.checked)}
          />
          {t('monitor')}
        </label>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[12px] tabular-nums text-mute">
            {live ? formatElapsed(elapsed) : '00:00'}
          </span>
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
          {live ? (
            <>
              {!shareToken ? (
                <button
                  onClick={() => void generateShare()}
                  disabled={sharing}
                  className="h-8 rounded-[4px] border border-line bg-paper px-3 text-[12.5px] text-ink hover:border-amore disabled:opacity-50"
                >
                  {sharing ? t('share.creating') : t('share.create')}
                </button>
              ) : null}
              <button
                onClick={() => void stop()}
                className="h-8 rounded-[4px] border border-line bg-paper px-3 text-[12.5px] text-ink hover:border-amore"
              >
                {t('stop')}
              </button>
            </>
          ) : (
            <button
              onClick={() => void start()}
              disabled={busy}
              className="h-8 rounded-[4px] border border-amore bg-amore px-3 text-[12.5px] text-paper disabled:opacity-50"
            >
              {busy ? t('starting') : t('start')}
            </button>
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
          <button
            onClick={() => void copyShareUrl()}
            className="h-7 rounded-[4px] border border-line px-2 text-[11.5px] text-ink hover:border-amore"
          >
            {shareCopied ? t('share.copied') : t('share.copy')}
          </button>
          <button
            onClick={() => void revokeShare()}
            disabled={sharing}
            className="h-7 rounded-[4px] border border-line px-2 text-[11.5px] text-mute hover:border-amore disabled:opacity-50"
          >
            {t('share.revoke')}
          </button>
          <span className="text-[11px] text-mute-soft">{t('share.expiresIn4h')}</span>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-[4px] border border-line bg-paper px-3 py-2 text-[12px] text-mute">
          {t('errorPrefix')} {t.has(`errors.${error}`) ? t(`errors.${error}`) : error}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <CaptionColumn label={t('sourceColumn')} lines={inputLines} empty={t('emptySource')} />
        <CaptionColumn label={t('targetColumn')} lines={outputLines} empty={t('emptyTarget')} />
      </div>

      <audio ref={monitorAudioRef} autoPlay playsInline className="hidden" />
    </div>
  );
}

function CaptionColumn({
  label,
  lines,
  empty,
}: {
  label: string;
  lines: CaptionLine[];
  empty: string;
}) {
  const visible = lines.slice(-40);
  return (
    <div className="rounded-[4px] border border-line bg-paper">
      <div className="border-b border-line-soft px-3 py-2 text-[11px] uppercase tracking-[0.08em] text-mute-soft">
        {label}
      </div>
      <div className="max-h-[420px] min-h-[260px] overflow-y-auto px-3 py-3 text-[13.5px] leading-[1.75] text-ink">
        {visible.length === 0 ? (
          <div className="text-mute-soft">{empty}</div>
        ) : (
          visible.map((l) => (
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


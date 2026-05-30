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

  const [inputLines, setInputLines] = useState<CaptionLine[]>([]);
  const [outputLines, setOutputLines] = useState<CaptionLine[]>([]);
  const [elapsed, setElapsed] = useState(0);

  // Mutable refs held only for the duration of a live session.
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const ttsStreamRef = useRef<MediaStream | null>(null);
  const roomRef = useRef<Room | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const monitorAudioRef = useRef<HTMLAudioElement | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Current partial lines (delta accumulators) keyed by item.id from OpenAI.
  const partialInputRef = useRef<Map<string, string>>(new Map());
  const partialOutputRef = useRef<Map<string, string>>(new Map());

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

      // Input (mic) transcription stream.
      if (type === 'conversation.item.input_audio_transcription.delta') {
        const itemId = String(msg.item_id ?? msg.id ?? 'in');
        const delta = String(msg.delta ?? '');
        const prev = partialInputRef.current.get(itemId) ?? '';
        const next = prev + delta;
        partialInputRef.current.set(itemId, next);
        const line: CaptionLine = { id: itemId, text: next, final: false };
        pushLine('input', line);
        broadcastCaption('input', line, sourceLang);
        return;
      }
      if (type === 'conversation.item.input_audio_transcription.completed') {
        const itemId = String(msg.item_id ?? msg.id ?? 'in');
        const text = String(msg.transcript ?? partialInputRef.current.get(itemId) ?? '');
        partialInputRef.current.delete(itemId);
        const line: CaptionLine = { id: itemId, text, final: true };
        pushLine('input', line);
        broadcastCaption('input', line, sourceLang);
        if (text.trim()) void persistMessage('input', text, sourceLang);
        return;
      }

      // Translation (model output) text stream. The API has shipped both
      // `response.text.*` and `response.output_text.*` over time — handle
      // either.
      if (type === 'response.text.delta' || type === 'response.output_text.delta') {
        const itemId = String(msg.response_id ?? msg.item_id ?? 'out');
        const delta = String(msg.delta ?? '');
        const prev = partialOutputRef.current.get(itemId) ?? '';
        const next = prev + delta;
        partialOutputRef.current.set(itemId, next);
        const line: CaptionLine = { id: itemId, text: next, final: false };
        pushLine('output', line);
        broadcastCaption('output', line, targetLang);
        return;
      }
      if (type === 'response.text.done' || type === 'response.output_text.done') {
        const itemId = String(msg.response_id ?? msg.item_id ?? 'out');
        const text = String(msg.text ?? partialOutputRef.current.get(itemId) ?? '');
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

    // Mic
    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('microphone_denied');
      setStatus('error');
      return;
    }
    micStreamRef.current = mic;

    // OpenAI WebRTC
    const pc = new RTCPeerConnection();
    pcRef.current = pc;
    mic.getAudioTracks().forEach((tr) => pc.addTrack(tr, mic));
    pc.ontrack = (e) => {
      ttsStreamRef.current = e.streams[0];
      if (monitorAudioRef.current) {
        monitorAudioRef.current.srcObject = e.streams[0];
        monitorAudioRef.current.muted = !monitorTranslation;
        monitorAudioRef.current.play().catch(() => {});
      }
    };
    const dc = pc.createDataChannel('oai-events');
    dcRef.current = dc;
    dc.onmessage = (ev) => handleOaiEvent(String(ev.data));

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpRes = await fetch(
        `https://api.openai.com/v1/realtime?model=${encodeURIComponent(bundle.openai.model)}`,
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

    // Wait briefly for ontrack to land so we can publish both tracks.
    if (!ttsStreamRef.current) {
      await new Promise((r) => setTimeout(r, 600));
    }

    // LiveKit publish
    try {
      const room = new Room({ adaptiveStream: true, dynacast: true });
      await room.connect(bundle.livekit.url, bundle.livekit.token);
      roomRef.current = room;
      const inputTrack = new LocalAudioTrack(mic.getAudioTracks()[0]);
      await room.localParticipant.publishTrack(inputTrack, { name: 'input' });
      if (ttsStreamRef.current) {
        const ttsTrack = ttsStreamRef.current.getAudioTracks()[0];
        if (ttsTrack) {
          const outputTrack = new LocalAudioTrack(ttsTrack);
          await room.localParticipant.publishTrack(outputTrack, { name: 'output' });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'livekit_failed');
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
    monitorTranslation,
    recordEnabled,
    sourceLang,
    targetLang,
    status,
  ]);

  const stop = useCallback(async () => {
    if (status === 'idle' || status === 'ended') return;
    setStatus('ending');
    const id = sessionIdRef.current;
    cleanup();
    sessionIdRef.current = null;
    startedAtRef.current = null;
    if (id) {
      try {
        await fetch(`/api/translate/sessions/${id}/end`, { method: 'POST' });
      } catch {}
    }
    setStatus('ended');
  }, [cleanup, status]);

  // Stop on unmount.
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

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
            <button
              onClick={() => void stop()}
              className="h-8 rounded-[4px] border border-line bg-paper px-3 text-[12.5px] text-ink hover:border-amore"
            >
              {t('stop')}
            </button>
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

      {error ? (
        <div className="rounded-[4px] border border-line bg-paper px-3 py-2 text-[12px] text-mute">
          {t('errorPrefix')} {error}
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


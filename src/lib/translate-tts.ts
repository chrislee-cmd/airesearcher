// AI 동시통역 — client-side custom TTS layer (single fixed voice).
//
// Why this exists: `gpt-realtime-translate` emits translated *audio* with
// dynamic voice adaptation (the synthesized speech mimics the source
// speaker's tone), and the endpoint exposes NO output-voice selector —
// passing `output.voice` 400s the session outright (see openai-realtime.ts,
// PR #566 dead end). The audible symptom is a voice that jumps between
// male / female / neutral timbre utterance-to-utterance.
//
// The only lever left is to DROP the model's audio track and re-synthesize
// the translated *text* (already streamed for captions) with our own TTS,
// pinned to one fixed voice. This module owns that synthesis queue.
//
// Pipeline shape (latency-minimizing):
//   output final text → split into sentences → per-sentence fetch
//   `/api/translate/tts` (server holds the voice constant + API key) →
//   decodeAudioData → schedule playback gaplessly, IN ORDER, into the
//   caller's audio destinations (LiveKit output publish + recording + a
//   local-monitor gain). Sentence N+1 is synthesized while N is still
//   playing — we await synthesis serially (which preserves order) but the
//   `.start()` scheduling is non-blocking, so decode of the next sentence
//   overlaps playback of the current one.

/**
 * Split a committed translation line into sentence-sized synthesis chunks.
 *
 * We cut on sentence-final punctuation (Latin `.?!`, CJK 。！？, and the
 * ellipsis …) KEEPING the punctuation with its sentence, so each chunk is a
 * natural prosodic unit. A trailing fragment with no terminal punctuation
 * (the common case for a mid-thought commit) is emitted as its own chunk so
 * nothing is dropped. Whitespace-only chunks are discarded.
 */
export function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  // Match up to and including a run of sentence-final punctuation, or the
  // remaining tail. `[^…。！？.?!]+` grabs the sentence body; the trailing
  // class grabs its terminator(s).
  const matches = trimmed.match(/[^…。！？.?!]+[…。！？.?!]+|[^…。！？.?!]+$/g);
  if (!matches) return [trimmed];
  return matches.map((s) => s.trim()).filter(Boolean);
}

export type TtsQueue = {
  /** Queue a committed output-final line for synthesis + playback. */
  enqueue: (text: string, lang: string) => void;
  /** Stop playback, abort in-flight synthesis, and drop the queue. */
  stop: () => void;
};

type QueueItem = { text: string; lang: string };

export function createTtsQueue(opts: {
  ctx: AudioContext;
  /**
   * Nodes each synthesized sentence is fanned out to. Typically the LiveKit
   * output-publish destination, the recording destination, and a local
   * monitor gain node. Whichever exist at creation time.
   */
  destinations: AudioNode[];
  /** Live session id (used for server-side host/auth validation). */
  getSessionId: () => string | null;
}): TtsQueue {
  const { ctx, destinations, getSessionId } = opts;

  const queue: QueueItem[] = [];
  const activeSources = new Set<AudioBufferSourceNode>();
  const abort = new AbortController();
  let pumping = false;
  let stopped = false;
  // Wall-clock (ctx time) at which the next sentence should begin, so
  // sequential sentences play back-to-back with no overlap and no gap. When
  // synthesis falls behind playback this lands in the past and we clamp to
  // `ctx.currentTime` (a small audible gap, never an overlap).
  let playCursor = 0;

  async function synthesize(text: string, lang: string): Promise<AudioBuffer | null> {
    const sessionId = getSessionId();
    if (!sessionId) return null;
    try {
      const res = await fetch('/api/translate/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, text, lang }),
        signal: abort.signal,
      });
      if (!res.ok) {
        console.warn('[translate-tts] synth failed', {
          status: res.status,
          preview: text.slice(0, 32),
        });
        return null;
      }
      const bytes = await res.arrayBuffer();
      // decodeAudioData detaches the buffer; it's a throwaway fetch result.
      return await ctx.decodeAudioData(bytes);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return null;
      console.warn('[translate-tts] synth error', err);
      return null;
    }
  }

  function schedule(buffer: AudioBuffer): void {
    if (stopped) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    for (const dest of destinations) src.connect(dest);
    const startAt = Math.max(ctx.currentTime, playCursor);
    src.onended = () => {
      activeSources.delete(src);
      try {
        src.disconnect();
      } catch {}
    };
    activeSources.add(src);
    try {
      src.start(startAt);
    } catch {
      activeSources.delete(src);
      return;
    }
    playCursor = startAt + buffer.duration;
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (!stopped && queue.length > 0) {
        const item = queue.shift()!;
        // Serial await keeps sentences in commit order; `.start()` inside
        // schedule() is non-blocking so the NEXT synthesize overlaps this
        // sentence's playback (the pipeline).
        const buffer = await synthesize(item.text, item.lang);
        if (buffer) schedule(buffer);
      }
    } finally {
      pumping = false;
      // A sentence enqueued between the loop check and this reset would be
      // stranded; re-pump if the queue refilled.
      if (!stopped && queue.length > 0) void pump();
    }
  }

  return {
    enqueue(text: string, lang: string) {
      if (stopped) return;
      for (const sentence of splitSentences(text)) {
        queue.push({ text: sentence, lang });
      }
      void pump();
    },
    stop() {
      stopped = true;
      queue.length = 0;
      try {
        abort.abort();
      } catch {}
      for (const src of activeSources) {
        try {
          src.stop();
        } catch {}
        try {
          src.disconnect();
        } catch {}
      }
      activeSources.clear();
    },
  };
}

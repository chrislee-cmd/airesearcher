// ElevenLabs Speech-to-Text (Scribe) response → our markdown format.
//
// Scribe returns word-level data with optional speaker diarization. We
// reconstruct utterances by grouping consecutive words from the same speaker,
// then emit the same `[HH:MM:SS] Speaker N: ...` format Deepgram produces, so
// downstream consumers (preview, .docx export) need no changes.

export type ElevenLabsWord = {
  text: string;
  type?: 'word' | 'spacing' | 'audio_event';
  start?: number;
  end?: number;
  speaker_id?: string | number | null;
};

export type ElevenLabsScribeResult = {
  language_code?: string;
  language_probability?: number;
  text?: string;
  words?: ElevenLabsWord[];
  // The webhook payload wraps the same shape — we accept either.
  data?: ElevenLabsScribeResult;
  request_id?: string;
};

// Speaker-grouped turn with millisecond boundaries — the shape AI-UT persists
// as `ut_sessions.transcript_words` so card 626 can snap clip boundaries to
// utterance edges (avoid cutting mid-sentence). Kept separate from the markdown
// path so QA/interview consumers are untouched.
export type TranscriptTurn = {
  start_ms: number;
  end_ms: number;
  speaker: number;
  text: string;
};

export function buildTurnsMs(result: ElevenLabsScribeResult): TranscriptTurn[] {
  const root = result.data ?? result;
  const words = (root.words ?? []).filter(
    (w) => w.type !== 'spacing' && typeof w.text === 'string',
  );
  const turns: TranscriptTurn[] = [];
  for (const w of words) {
    const speaker = normalizeSpeaker(w.speaker_id);
    const startMs = Math.round((typeof w.start === 'number' ? w.start : 0) * 1000);
    const endMs = Math.round(
      (typeof w.end === 'number' ? w.end : (typeof w.start === 'number' ? w.start : 0)) * 1000,
    );
    const piece = w.type === 'audio_event' ? `[${w.text}]` : (w.text as string);
    const prev = turns[turns.length - 1];
    if (prev && prev.speaker === speaker) {
      prev.text = prev.text ? `${prev.text} ${piece}`.trim() : piece;
      prev.end_ms = endMs;
    } else {
      turns.push({ start_ms: startMs, end_ms: endMs, speaker, text: piece });
    }
  }
  return turns;
}

function toTimestamp(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return '00:00:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function normalizeSpeaker(s: string | number | null | undefined): number {
  if (s === null || s === undefined) return 0;
  if (typeof s === 'number') return s;
  // Scribe emits "speaker_0", "speaker_1", ... — strip prefix.
  const m = /([0-9]+)$/.exec(s);
  return m ? Number(m[1]) : 0;
}

export function elevenlabsToMarkdown(
  result: ElevenLabsScribeResult,
  filename: string,
): { markdown: string; duration: number; speakers: number } {
  const root = result.data ?? result;
  const words = (root.words ?? []).filter(
    (w) => w.type !== 'spacing' && typeof w.text === 'string',
  );

  type Block = { speaker: number; start: number; end: number; text: string };
  const blocks: Block[] = [];
  for (const w of words) {
    const speaker = normalizeSpeaker(w.speaker_id);
    const start = typeof w.start === 'number' ? w.start : 0;
    const end = typeof w.end === 'number' ? w.end : start;
    const prev = blocks[blocks.length - 1];
    if (prev && prev.speaker === speaker) {
      // Append to current speaker turn — preserve audio events as bracketed tags.
      const piece = w.type === 'audio_event' ? `[${w.text}]` : w.text;
      prev.text = prev.text ? `${prev.text} ${piece}`.trim() : piece;
      prev.end = end;
    } else {
      blocks.push({
        speaker,
        start,
        end,
        text: w.type === 'audio_event' ? `[${w.text}]` : w.text,
      });
    }
  }

  // Last-ditch: full transcript single block.
  if (blocks.length === 0 && root.text) {
    blocks.push({ speaker: 0, start: 0, end: 0, text: root.text.trim() });
  }

  const speakerNumbers = new Set(blocks.map((b) => b.speaker));
  const speakers = speakerNumbers.size || (blocks.length > 0 ? 1 : 0);
  const duration =
    blocks.length > 0 ? Math.max(...blocks.map((b) => b.end)) : 0;

  const front = [
    '---',
    `file: ${filename}`,
    `duration: ${toTimestamp(duration)}`,
    `speakers: ${speakers}`,
    '---',
    '',
  ].join('\n');

  const body = blocks
    .map(
      (b) =>
        `[${toTimestamp(b.start)}] Speaker ${b.speaker + 1}: ${b.text.trim()}`,
    )
    .join('\n');

  return {
    markdown: `${front}\n${body}\n`,
    duration,
    speakers,
  };
}

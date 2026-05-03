type DeepgramWord = {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  speaker?: number;
};

type DeepgramAlternative = {
  transcript: string;
  words?: DeepgramWord[];
  paragraphs?: {
    paragraphs?: {
      sentences?: { text: string; start: number; end: number }[];
      speaker?: number;
      start?: number;
      end?: number;
    }[];
  };
};

type DeepgramChannel = { alternatives?: DeepgramAlternative[] };

export type DeepgramResult = {
  metadata?: {
    duration?: number;
    request_id?: string;
  };
  results?: {
    channels?: DeepgramChannel[];
    utterances?: {
      speaker: number;
      start: number;
      end: number;
      transcript: string;
    }[];
  };
};

function toTimestamp(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return '00:00:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Convert a Deepgram prerecorded result into our transcript markdown.
 * Format:
 *   ---
 *   file: ...
 *   duration: 01:22:14
 *   speakers: 2
 *   ---
 *
 *   [00:00:03] Speaker 1: ...
 *   [00:00:08] Speaker 2: ...
 */
export function deepgramToMarkdown(
  result: DeepgramResult,
  filename: string,
): { markdown: string; duration: number; speakers: number } {
  const duration = result.metadata?.duration ?? 0;

  type Block = { speaker: number; start: number; text: string };
  const blocks: Block[] = [];

  // Prefer utterances when present (cleaner sentence boundaries)
  const utterances = result.results?.utterances;
  if (utterances && utterances.length > 0) {
    for (const u of utterances) {
      blocks.push({
        speaker: u.speaker ?? 0,
        start: u.start,
        text: (u.transcript ?? '').trim(),
      });
    }
  } else {
    // Fall back to paragraph buckets
    const alt = result.results?.channels?.[0]?.alternatives?.[0];
    const paragraphs = alt?.paragraphs?.paragraphs ?? [];
    for (const p of paragraphs) {
      const text = (p.sentences ?? [])
        .map((s) => s.text)
        .join(' ')
        .trim();
      if (!text) continue;
      blocks.push({
        speaker: p.speaker ?? 0,
        start: p.start ?? 0,
        text,
      });
    }
  }

  // Last-ditch: dump the full transcript as one block
  if (blocks.length === 0) {
    const alt = result.results?.channels?.[0]?.alternatives?.[0];
    if (alt?.transcript) {
      blocks.push({ speaker: 0, start: 0, text: alt.transcript.trim() });
    }
  }

  // Merge adjacent blocks from the same speaker. Deepgram's utterance
  // segmentation can split a single turn into many short rows; collapsing them
  // gives the reader one timestamped line per speaker turn.
  const merged: Block[] = [];
  for (const b of blocks) {
    const prev = merged[merged.length - 1];
    if (prev && prev.speaker === b.speaker) {
      prev.text = prev.text ? `${prev.text} ${b.text}`.trim() : b.text;
    } else {
      merged.push({ ...b });
    }
  }

  const speakerNumbers = new Set(merged.map((b) => b.speaker));
  const speakers = speakerNumbers.size;

  const front = [
    '---',
    `file: ${filename}`,
    `duration: ${toTimestamp(duration)}`,
    `speakers: ${speakers}`,
    '---',
    '',
  ].join('\n');

  const body = merged
    .map(
      (b) =>
        `[${toTimestamp(b.start)}] Speaker ${b.speaker + 1}: ${b.text}`,
    )
    .join('\n');

  return {
    markdown: `${front}\n${body}\n`,
    duration,
    speakers,
  };
}

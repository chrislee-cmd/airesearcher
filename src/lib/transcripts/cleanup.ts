import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { ZERO_RETENTION } from '../llm/config';
import { CLEANUP_SYSTEM, cleanupSchema } from './cleanup-schema';
import type { ElevenLabsWord } from './elevenlabs';

// Per-turn cleanup pass for Korean transcripts. Disfluencies / fillers /
// obvious mishears are removed. Original markdown is never overwritten —
// the caller saves the cleaned version to a separate column and the UI
// can show / fall back as it chooses.
//
// Strategy:
//  - Build turns (speaker-grouped blocks) from the already speaker-merged words.
//  - Chunk into CHUNK_SIZE turns, send each chunk with ±2 turn context.
//  - Per-chunk concurrency limit so the function fits in maxDuration.
//  - Per-turn length-drift guard rejects suspicious rewrites; the chunk's
//    other slots still apply.
//  - On total failure / no work / no key → return null markdown, caller
//    leaves clean_markdown NULL and UI falls back to original.

const CHUNK_SIZE = 20;
const CONCURRENCY = 5;
const LENGTH_DRIFT = 0.25;
const MIN_TURNS = 5;

function normalizeSpeaker(s: string | number | null | undefined): number {
  if (s === null || s === undefined) return 0;
  if (typeof s === 'number') return s;
  const m = /([0-9]+)$/.exec(s);
  return m ? Number(m[1]) : 0;
}

function toTimestamp(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return '00:00:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

type Turn = { speaker: number; start: number; end: number; text: string };

function buildTurns(words: ElevenLabsWord[]): Turn[] {
  const turns: Turn[] = [];
  for (const w of words) {
    if (w.type === 'spacing' || typeof w.text !== 'string') continue;
    const speaker = normalizeSpeaker(w.speaker_id);
    const start = typeof w.start === 'number' ? w.start : 0;
    const end = typeof w.end === 'number' ? w.end : start;
    const piece = w.type === 'audio_event' ? `[${w.text}]` : w.text;
    const prev = turns[turns.length - 1];
    if (prev && prev.speaker === speaker) {
      prev.text = prev.text ? `${prev.text} ${piece}`.trim() : piece;
      prev.end = end;
    } else {
      turns.push({ speaker, start, end, text: piece });
    }
  }
  return turns;
}

function formatContext(label: 'before' | 'after', turns: Turn[]): string {
  if (turns.length === 0) return '(없음)';
  return turns
    .map((t, i) => `[${label}-${i + 1}] Speaker ${t.speaker + 1}: ${t.text}`)
    .join('\n');
}

async function cleanChunk(
  apiKey: string,
  chunkTurns: Turn[],
  before: Turn[],
  after: Turn[],
): Promise<string[]> {
  const anthropic = createAnthropic({ apiKey });
  const target = chunkTurns
    .map((t, i) => `[${i + 1}] Speaker ${t.speaker + 1}: ${t.text}`)
    .join('\n');

  const prompt = `[컨텍스트 — 직전]
${formatContext('before', before)}

[정제 대상 — ${chunkTurns.length}개 turn]
${target}

[컨텍스트 — 직후]
${formatContext('after', after)}

각 [n] 라인의 발화 내용을 정제해서 cleaned 배열로 반환. 길이·순서 입력과 동일.`;

  const result = await generateObject({
    model: anthropic('claude-haiku-4-5-20251001'),
    schema: cleanupSchema,
    system: CLEANUP_SYSTEM,
    prompt,
    temperature: 0.1,
    maxOutputTokens: 4096,
    providerOptions: ZERO_RETENTION,
  });
  return result.object.cleaned;
}

export type CleanupAudit = {
  skipped: boolean;
  chunks: number;
  chunks_applied: number;
  chunks_failed: number;
  turns_total: number;
  turns_touched: number;
  turns_rejected: number;
};

export type CleanupResult = {
  cleanMarkdown: string | null;
  audit: CleanupAudit;
};

const emptyAudit = (turnsTotal = 0): CleanupAudit => ({
  skipped: true,
  chunks: 0,
  chunks_applied: 0,
  chunks_failed: 0,
  turns_total: turnsTotal,
  turns_touched: 0,
  turns_rejected: 0,
});

/**
 * Run the cleanup pass over already speaker-merged words. Returns clean
 * markdown (same template as `elevenlabsToMarkdown`) plus an audit object
 * that gets stored in `raw_result._cleanup` for review.
 */
export async function cleanupTranscript(
  words: ElevenLabsWord[],
  filename: string,
  duration: number,
  speakers: number,
): Promise<CleanupResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { cleanMarkdown: null, audit: emptyAudit() };
  // Hoist into a local so TS preserves the narrow across the worker closure.
  const key = apiKey;

  const turns = buildTurns(words);
  if (turns.length < MIN_TURNS) {
    return { cleanMarkdown: null, audit: emptyAudit(turns.length) };
  }

  type Chunk = { idx: number; turns: Turn[]; before: Turn[]; after: Turn[] };
  const chunks: Chunk[] = [];
  for (let i = 0; i < turns.length; i += CHUNK_SIZE) {
    chunks.push({
      idx: chunks.length,
      turns: turns.slice(i, i + CHUNK_SIZE),
      before: turns.slice(Math.max(0, i - 2), i),
      after: turns.slice(i + CHUNK_SIZE, i + CHUNK_SIZE + 2),
    });
  }

  // Each chunk's cleaned slots default to original text (passthrough on
  // failure / rejection).
  const cleanedByChunk: string[][] = chunks.map((c) => c.turns.map((t) => t.text));

  const audit: CleanupAudit = {
    skipped: false,
    chunks: chunks.length,
    chunks_applied: 0,
    chunks_failed: 0,
    turns_total: turns.length,
    turns_touched: 0,
    turns_rejected: 0,
  };

  const queue = [...chunks];
  async function worker() {
    while (true) {
      const c = queue.shift();
      if (!c) return;
      try {
        const cleaned = await cleanChunk(key, c.turns, c.before, c.after);
        if (cleaned.length !== c.turns.length) {
          audit.chunks_failed += 1;
          continue;
        }
        for (let j = 0; j < c.turns.length; j += 1) {
          const orig = c.turns[j].text;
          const candidate = (cleaned[j] ?? '').trim();
          if (!candidate || candidate === orig) continue;
          const drift = Math.abs(candidate.length - orig.length) / Math.max(orig.length, 1);
          if (drift > LENGTH_DRIFT) {
            audit.turns_rejected += 1;
            continue;
          }
          cleanedByChunk[c.idx][j] = candidate;
          audit.turns_touched += 1;
        }
        audit.chunks_applied += 1;
      } catch (e) {
        console.warn('[transcripts/cleanup] chunk', c.idx, 'failed', e);
        audit.chunks_failed += 1;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, () => worker()),
  );

  if (audit.chunks_applied === 0) {
    return { cleanMarkdown: null, audit };
  }

  const front = [
    '---',
    `file: ${filename}`,
    `duration: ${toTimestamp(duration)}`,
    `speakers: ${speakers}`,
    '---',
    '',
  ].join('\n');
  const body: string[] = [];
  for (const c of chunks) {
    for (let j = 0; j < c.turns.length; j += 1) {
      const t = c.turns[j];
      const text = cleanedByChunk[c.idx][j];
      body.push(`[${toTimestamp(t.start)}] Speaker ${t.speaker + 1}: ${text.trim()}`);
    }
  }
  return { cleanMarkdown: `${front}\n${body.join('\n')}\n`, audit };
}

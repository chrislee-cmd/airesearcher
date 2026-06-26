import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { env } from '@/env';
import { ZERO_RETENTION } from '../llm/config';
import {
  SPEAKER_MERGE_SYSTEM,
  speakerMergeSchema,
  type SpeakerMergeDecision,
} from './speaker-merge-schema';
import type { ElevenLabsWord } from './elevenlabs';

// Same mapping as elevenlabsToMarkdown — "speaker_0" → 0, number → number.
function normalizeSpeaker(s: string | number | null | undefined): number {
  if (s === null || s === undefined) return 0;
  if (typeof s === 'number') return s;
  const m = /([0-9]+)$/.exec(s);
  return m ? Number(m[1]) : 0;
}

type Turn = { speaker: number; text: string };

function buildTurns(words: ElevenLabsWord[]): Turn[] {
  const turns: Turn[] = [];
  for (const w of words) {
    if (w.type === 'spacing' || typeof w.text !== 'string') continue;
    const speaker = normalizeSpeaker(w.speaker_id);
    const prev = turns[turns.length - 1];
    if (prev && prev.speaker === speaker) {
      prev.text = `${prev.text} ${w.text}`.trim();
    } else {
      turns.push({ speaker, text: w.text });
    }
  }
  return turns;
}

// First 30 turns (intro + early flow) + last 5 (closing patterns).
function sampleTurns(turns: Turn[]): Turn[] {
  if (turns.length <= 40) return turns;
  return [...turns.slice(0, 30), ...turns.slice(-5)];
}

type SpeakerStats = {
  count: number;
  avgLen: number;
  sampleTexts: string[];
};

function speakerStats(turns: Turn[]): Record<number, SpeakerStats> {
  const buckets = new Map<number, { count: number; lens: number[]; sampleTexts: string[] }>();
  for (const t of turns) {
    let b = buckets.get(t.speaker);
    if (!b) {
      b = { count: 0, lens: [], sampleTexts: [] };
      buckets.set(t.speaker, b);
    }
    b.count += 1;
    b.lens.push(t.text.length);
    if (b.sampleTexts.length < 3) b.sampleTexts.push(t.text.slice(0, 80));
  }
  const out: Record<number, SpeakerStats> = {};
  for (const [id, b] of buckets) {
    const avg = b.lens.reduce((a, c) => a + c, 0) / b.lens.length;
    out[id] = { count: b.count, avgLen: Math.round(avg), sampleTexts: b.sampleTexts };
  }
  return out;
}

/**
 * Detect and merge over-split speakers from ElevenLabs Scribe v2 using an LLM
 * pass. Returns a new words array with `speaker_id` rewritten per the merge
 * decision. Safe fallback: LLM failure / low confidence / no key → original
 * words unchanged, decision=null.
 */
export async function mergeSpeakers(
  words: ElevenLabsWord[],
  filename: string,
): Promise<{ words: ElevenLabsWord[]; decision: SpeakerMergeDecision | null }> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return { words, decision: null };

  const turns = buildTurns(words);
  if (turns.length === 0) return { words, decision: null };

  const distinct = new Set(turns.map((t) => t.speaker));
  // No work to do when ≤2 speakers; over-split is the only failure mode.
  if (distinct.size <= 2) return { words, decision: null };

  const sample = sampleTurns(turns).map((t) => ({
    speaker: t.speaker + 1, // 1-indexed for LLM friendliness
    text: t.text.slice(0, 200),
  }));
  const stats = speakerStats(turns);
  const statsLines = Object.entries(stats)
    .map(([id, s]) => {
      const samples = s.sampleTexts.map((t) => `"${t}"`).join(' / ');
      return `- Speaker ${Number(id) + 1}: ${s.count} turns, avg ${s.avgLen} chars, samples: ${samples}`;
    })
    .join('\n');

  const prompt = `파일: ${filename}
인식된 화자 수: ${distinct.size}
총 turn: ${turns.length}

[화자별 통계]
${statsLines}

[Sample turns (도입 30 + 마지막 5)]
${sample.map((s) => `Speaker ${s.speaker}: ${s.text}`).join('\n')}`;

  let decision: SpeakerMergeDecision;
  try {
    const anthropic = createAnthropic({ apiKey });
    const result = await generateObject({
      model: anthropic('claude-haiku-4-5-20251001'),
      schema: speakerMergeSchema,
      system: SPEAKER_MERGE_SYSTEM,
      prompt,
      temperature: 0.1,
      maxOutputTokens: 1024,
      providerOptions: ZERO_RETENTION,
    });
    decision = result.object;
  } catch (e) {
    console.warn('[transcripts/speaker-merge] LLM call failed', e);
    return { words, decision: null };
  }

  if (decision.confidence === 'low' || decision.merge_groups.length === 0) {
    return { words, decision };
  }

  // Build 1-indexed remap (group → group_min). Anything not in a group is a
  // no-op passthrough.
  const remap = new Map<number, number>();
  for (const group of decision.merge_groups) {
    const min = Math.min(...group);
    for (const id of group) {
      if (id !== min) remap.set(id, min);
    }
  }
  if (remap.size === 0) return { words, decision };

  const remappedWords: ElevenLabsWord[] = words.map((w) => {
    const oneIndexed = normalizeSpeaker(w.speaker_id) + 1;
    const mappedOne = remap.get(oneIndexed) ?? oneIndexed;
    // Round-trip back to Scribe's `speaker_N` string shape.
    return { ...w, speaker_id: `speaker_${mappedOne - 1}` };
  });

  return { words: remappedWords, decision };
}

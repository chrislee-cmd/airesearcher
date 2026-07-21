// Structured transcript turns — the result fullview (좌 전사록 turn 스트림) and
// the .srt export both need the transcript as an ordered list of speaker turns
// with timestamps, not the flat markdown/HTML the preview route ships. Both
// providers emit the same body shape after labeling:
//
//   ---
//   file: ...
//   duration: 01:22:14
//   speakers: 2
//   ---
//
//   [00:00:03] 질문자 1: ...
//   [00:00:08] 응답자 1: ...
//
// so we parse `[HH:MM:SS] <label>: <text>` lines into turns here, shared by the
// /turns endpoint and the srt download branch (single source of truth). Labels
// arrive already localized (applySpeakerLabels / applyInferredSpeakerLabels), so
// the role is inferred from the label prefix — 질문자/Interviewer → host,
// 응답자/Interviewee → guest, otherwise a stable per-speaker fallback so a
// 2-speaker generic transcript still renders two distinct avatar colours.

export type TranscriptTurnRole = 'host' | 'guest' | 'neutral';

export type TranscriptTurn = {
  index: number;
  /** `HH:MM:SS` — the turn start, as emitted in the markdown. */
  timestamp: string;
  /** Start offset in whole seconds (parsed from `timestamp`). */
  seconds: number;
  /** Display speaker label, e.g. `질문자 1` / `Interviewer 1` / `화자 2`. */
  speaker: string;
  role: TranscriptTurnRole;
  text: string;
};

const HOST_RE = /^(질문자|사회자|진행자|Interviewer|Host|Moderator)\b/i;
const GUEST_RE = /^(응답자|참가자|Interviewee|Guest|Participant)\b/i;
// `[HH:MM:SS] <label>: <text>` — label is non-greedy up to the first `: `.
const TURN_RE = /^\[(\d{1,2}):(\d{2}):(\d{2})\]\s*(.+?):\s*(.*)$/;

function stripFrontMatter(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return lines;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return lines.slice(i + 1);
  }
  return lines;
}

/**
 * Parse labeled transcript markdown into ordered speaker turns. Continuation
 * lines (no leading timestamp) are folded into the previous turn's text so
 * multi-line utterances stay whole. Roles are assigned from the label; unknown
 * labels fall back to a stable host/guest alternation by first appearance.
 */
export function parseTranscriptTurns(markdown: string): TranscriptTurn[] {
  const lines = stripFrontMatter(markdown);
  const turns: TranscriptTurn[] = [];
  // Stable fallback colour per distinct un-roled speaker label — first seen
  // → host(sky), second → guest(pink), then cycle so >2 speakers still split.
  const fallbackRole = new Map<string, TranscriptTurnRole>();
  let fallbackNext = 0;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const m = line.match(TURN_RE);
    if (!m) {
      const trimmed = line.trim();
      if (trimmed && turns.length > 0) {
        turns[turns.length - 1].text += `\n${trimmed}`;
      }
      continue;
    }
    const [, hh, mm, ss, label, text] = m;
    const seconds = Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
    const speaker = label.trim();
    let role: TranscriptTurnRole;
    if (HOST_RE.test(speaker)) role = 'host';
    else if (GUEST_RE.test(speaker)) role = 'guest';
    else {
      const existing = fallbackRole.get(speaker);
      if (existing) role = existing;
      else {
        role = fallbackNext % 2 === 0 ? 'host' : 'guest';
        fallbackRole.set(speaker, role);
        fallbackNext += 1;
      }
    }
    turns.push({
      index: turns.length,
      timestamp: `${hh.padStart(2, '0')}:${mm}:${ss}`,
      seconds,
      speaker,
      role,
      text: text.trim(),
    });
  }
  return turns;
}

function srtTimecode(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p2 = (n: number) => String(n).padStart(2, '0');
  // Millisecond field is always ,000 — the markdown only carries second
  // resolution (the batch STT output stores start-of-turn, not word offsets).
  return `${p2(h)}:${p2(m)}:${p2(sec)},000`;
}

/**
 * Render turns as SubRip (.srt) subtitles. Each turn is one cue; its end is the
 * next turn's start (min 1s), and the final cue runs a fixed tail. Conservative
 * by design — see the millisecond note above.
 */
export function turnsToSrt(turns: TranscriptTurn[]): string {
  const TAIL_SECONDS = 4;
  const blocks = turns.map((turn, i) => {
    const next = turns[i + 1];
    const endSeconds =
      next && next.seconds > turn.seconds
        ? next.seconds
        : turn.seconds + TAIL_SECONDS;
    const body = `${turn.speaker}: ${turn.text}`.replace(/\n+/g, ' ').trim();
    return `${i + 1}\n${srtTimecode(turn.seconds)} --> ${srtTimecode(endSeconds)}\n${body}`;
  });
  return blocks.join('\n\n') + (blocks.length ? '\n' : '');
}

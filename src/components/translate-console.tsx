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
import { useLocale, useTranslations } from 'next-intl';
import { Room, LocalAudioTrack } from 'livekit-client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { env } from '@/env';
import { createClient as createBrowserSupabase } from '@/lib/supabase/client';
import { ChromeButton } from './ui/chrome-button';
import { ChromeInput } from './ui/chrome-input';
import { IconButton } from './ui/icon-button';
import { ChipInput } from './ui/chip-input';
import { Checkbox } from './ui/checkbox';
import { Modal } from './ui/modal';
import { FileDropZone } from './ui/file-drop-zone';
import { Field } from './canvas/shell/field';
import { WidgetSubHeader } from './canvas/shell/widget-subheader';
import { isHangulFusionBoundary, joinDelta } from '@/lib/translate-stream-join';
import {
  useRealtimeTranscriptLiveBinding,
  useRealtimeTranscriptPublisher,
} from './realtime-transcript-provider';
import {
  FIDELITY_LOSS_THRESHOLD,
  countReplacementChars,
  decodeDataChannelMessage,
  looksJapaneseFallback,
  lossRatio,
  summarizeFidelity,
} from '@/lib/translate-fidelity';
import { useCreditDeduction } from './credit-deduction-provider';
import { FEATURE_COSTS } from '@/lib/features';

// Dev-mode trace gate. Enabled in non-prod builds so a designer running
// `pnpm dev` can step through the pipeline and confirm Korean / Thai /
// Chinese deltas land intact at every stage (datachannel → state →
// /messages POST → DB). Disabled in production so a 30 min session
// doesn't flood the browser console.
const TRACE_ENCODING =
  typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';

type Status = 'idle' | 'starting' | 'live' | 'ending' | 'ended' | 'error';

// All paths that tear the session down. Logged via `console.info` so
// stray reconnect cycles in production can be traced back to a
// specific caller without re-deploying with extra instrumentation.
type CleanupCaller =
  | 'start_error_session'
  | 'start_error_mic'
  | 'start_error_livekit'
  | 'start_error_webrtc'
  | 'start_reentry_guard'
  | 'stop'
  | 'unmount';

// Recording lifecycle, mirrored from supabase/migrations/0023.
// `null` = no row yet (host opted out, or session hasn't reached the
// finalize step yet).
type RecordingRow = {
  id: string;
  status: 'recording' | 'uploaded' | 'unlocked' | 'failed';
  size_bytes: number | null;
  duration_sec: number | null;
  credits_spent: number;
  unlocked_at: string | null;
  created_at: string;
};

const RECORDING_CHUNK_MS = 5000; // 5s timeslice — modest memory use, good resilience

// PR-T3: post-hoc batch re-translation cost. Surfaced in the
// "재번역" CTA so the host knows the LLM charge before clicking. Must
// match REVISE_CREDITS in /api/translate/sessions/[id]/revise/route.ts;
// the server is the actual gate, this is just for display.
const REVISE_CREDITS = 10;

// Poll cadence while a revision job is `pending` server-side. Sonnet
// chunks finish in ~5s each; 4s keeps the spinner feeling responsive
// without flooding the API for long sessions.
const REVISE_POLL_MS = 4000;

// Layer D: post-process 보정 cost. Surfaced on the trigger CTA so the
// host knows the LLM charge before clicking. Must match POSTPROCESS_CREDITS
// in /api/translate/sessions/[id]/postprocess/route.ts; the server is the
// actual gate, this is just for display.
const POSTPROCESS_CREDITS = 10;

type CaptionLine = {
  id: string;
  text: string;
  final: boolean;
  // Wall-clock ms when this line was last touched. Used by the prompter
  // view to keep only the last 30 seconds of content on screen — older
  // lines fade out at the top edge but remain in state so PR-B can
  // download the full transcript.
  ts: number;
  // Speaker is captured per line at commit time. With dual-source
  // capture each slot's pipeline tags its own lines (mic → host,
  // tab → guest); single-source modes tag uniformly. Null only for
  // legacy state from before this field existed.
  speaker?: 'host' | 'guest' | null;
};

// Display-only rolling window. Older lines are still in state (and on
// the DB via /messages) but the prompter pane only shows the most
// recent N seconds. 30s reads naturally for a teleprompter — long
// enough that a slow speaker still has context, short enough that the
// active line stays in the visual center.
const PROMPTER_WINDOW_MS = 30_000;

// Drop a freshly-finalized caption line if its punctuation/whitespace-
// normalized form matches a final line committed within this window.
// In production we've seen the pipeline restart mid-session (root cause
// still under investigation — see [translate] cleanup logs), which spins
// up a second OpenAI session that retranscribes the same audio with
// slightly different tokenization (e.g. comma added/removed). The
// dedup window keeps those copies off the prompter without blocking
// genuine repeats spoken minutes apart.
const DEDUP_WINDOW_MS = 60_000;

// Strip whitespace + Unicode punctuation/symbols so different
// tokenizations of the same utterance collide on the dedup key.
function normalizeForDedup(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
}

// Approximate same-utterance match. Catches OpenAI refinement passes
// that PR #223's exact-match dedup misses — e.g. "이걸" → "그걸",
// "5천 엔" → "오천 엔", or Korean numeral/synonym substitutions where
// only 1-2 characters differ across passes. Tunables:
//
// - FUZZY_LENGTH_TOLERANCE: skip the (expensive) edit distance step
//   if lengths differ by more than 30% — guards against false positives
//   on legitimately different short utterances ("네." vs "아니요.").
// - FUZZY_RATIO_THRESHOLD: 0.2 means "≤ 20% of characters different".
//   Tested against captured prod variants where 1-2 char substitution
//   should match but full word changes (different utterance) should not.
// - LEVENSHTEIN_CAP: defensive bail on pathological lengths. Real
//   normalized keys land well under this.
const FUZZY_LENGTH_TOLERANCE = 0.3;
const FUZZY_RATIO_THRESHOLD = 0.2;
const LEVENSHTEIN_CAP = 400;

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  if (al > LEVENSHTEIN_CAP || bl > LEVENSHTEIN_CAP) {
    // Unlikely; bail with max distance so the caller treats as not-a-dup.
    return Math.max(al, bl);
  }
  const prev = new Array<number>(bl + 1);
  const curr = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      curr[j] = del < ins ? (del < sub ? del : sub) : ins < sub ? ins : sub;
    }
    for (let j = 0; j <= bl; j++) prev[j] = curr[j];
  }
  return prev[bl];
}

function isFuzzyDup(candidate: string, prior: string): boolean {
  if (candidate === prior) return true;
  const cl = candidate.length;
  const pl = prior.length;
  if (cl === 0 || pl === 0) return false;
  const lengthDiff = Math.abs(cl - pl) / Math.max(cl, pl);
  if (lengthDiff > FUZZY_LENGTH_TOLERANCE) return false;
  const dist = levenshtein(candidate, prior);
  return dist / Math.max(cl, pl) <= FUZZY_RATIO_THRESHOLD;
}

// Containment dedup. OpenAI re-emits the same utterance with different
// chunking — once as a flurry of comma-separated short segments, once
// as a single concatenated long line. Length diff is too large for the
// fuzzy check (it short-circuits at 30%), but one is a substring of
// the other. Minimum length guard so short common phrases like "네." or
// "그래서" don't false-match against any longer line that happens to
// contain them.
// Script-aware containment minimum. CJK (Hangul / Hiragana / Katakana
// / CJK Unified) packs 2-3x the semantic weight per character vs
// Latin, so a 5-char CJK fragment ("잠깐 시간이", "바로 효과") is a
// phrase while a 5-char Latin substring ("after", "basic") shows up
// in unrelated sentences. Production trace showed Latin output
// dedup'ing legitimately distinct utterances ("So after building the
// basic system", "The decision I agonized over") because they share
// short Latin runs — text would briefly appear in the prompter and
// then vanish as the dedup orphan-filter pulled the partial. Use 5
// for CJK content, 15 for Latin so common phrases like "the basic"
// don't trigger false positives.
const CONTAINMENT_MIN_LEN_CJK = 5;
const CONTAINMENT_MIN_LEN_LATIN = 15;

function hasCJK(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0xAC00 && code <= 0xD7A3) || // Hangul syllables
      (code >= 0x4E00 && code <= 0x9FFF) || // CJK Unified Ideographs
      (code >= 0x3040 && code <= 0x309F) || // Hiragana
      (code >= 0x30A0 && code <= 0x30FF)    // Katakana
    ) {
      return true;
    }
  }
  return false;
}

function isContainmentDup(candidate: string, prior: string): boolean {
  const cl = candidate.length;
  const pl = prior.length;
  if (cl === 0 || pl === 0) return false;
  const shorter = cl < pl ? candidate : prior;
  const longer = cl < pl ? prior : candidate;
  // Pick the script-appropriate threshold based on the SHORTER side
  // since it's the one constrained against false matches. Mixed scripts
  // (e.g. Korean caption with a Latin brand name) default to the CJK
  // threshold since they're more likely meaningful phrases.
  const minLen = hasCJK(shorter) ? CONTAINMENT_MIN_LEN_CJK : CONTAINMENT_MIN_LEN_LATIN;
  if (shorter.length < minLen) return false;
  return longer.includes(shorter);
}

// Longest-common-substring dedup. Containment requires one full string
// to be inside the other, but the OpenAI model also emits paraphrased
// refinements where the prefix changes ("구체적인 계기는 역시 피부
// 트러블이었고, 출산 이후의 고민, 피부 고민이었죠." vs "예를 들면,
// 출산 이후의 고민, 피부 고민이었죠.") — neither contains the other,
// but they share a long contiguous tail. Catching this requires
// inspecting the longest contiguous run of matching characters between
// the two normalized keys.
//
// Script-aware LCS minimum. 10 chars in Korean is roughly a 5-syllable
// phrase ("출산 이후의 고민") that two genuinely different utterances
// rarely share verbatim. The same 10 chars in English is "the basic"
// or "I want to" — common across countless unrelated sentences. The
// production failure mode was clearest here: distinct English commits
// kept matching each other on LCS, the orphan filter wiped them, and
// users watched their translated lines vanish mid-typing. Latin needs
// a much higher bar.
const LCS_MIN_LEN_CJK = 10;
const LCS_MIN_LEN_LATIN = 28;

function longestCommonSubstring(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0 || bl === 0) return 0;
  if (al > LEVENSHTEIN_CAP || bl > LEVENSHTEIN_CAP) return 0;
  let max = 0;
  let prev = new Array<number>(bl + 1).fill(0);
  let curr = new Array<number>(bl + 1).fill(0);
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      if (a.charCodeAt(i - 1) === b.charCodeAt(j - 1)) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > max) max = curr[j];
      } else {
        curr[j] = 0;
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return max;
}

function isLcsChunkDup(candidate: string, prior: string): boolean {
  // Use the looser CJK threshold if either side is CJK; require both
  // sides clear it. For pure Latin pairs, use the stricter Latin
  // threshold so common phrasing doesn't generate false dedups.
  const minLen =
    hasCJK(candidate) || hasCJK(prior) ? LCS_MIN_LEN_CJK : LCS_MIN_LEN_LATIN;
  if (candidate.length < minLen || prior.length < minLen) return false;
  return longestCommonSubstring(candidate, prior) >= minLen;
}

// 🚨 truncation investigation (pr-translate-truncation-investigation).
// Attribute a dedup match to the specific rule that fired, scanning the
// recent-finals bucket in the same fuzzy → containment → lcs precedence
// the live `.some(... || ... || ...)` check used. Returns the first match
// (rule + the prior key it collided with) or null. The DROP DECISION IS
// UNCHANGED — a line is dropped iff some rule matches some entry, exactly
// as before; this only surfaces WHICH heuristic dropped it (and against
// what) so a single live session shows whether dedup over-application is
// eating real, distinct speech (candidate 1).
type DedupRule = 'fuzzy' | 'containment' | 'lcs';

function matchDedupRule(
  candidate: string,
  fresh: ReadonlyArray<{ key: string; ts: number }>,
): { rule: DedupRule; matched: string } | null {
  for (const e of fresh) {
    if (isFuzzyDup(candidate, e.key)) return { rule: 'fuzzy', matched: e.key };
    if (isContainmentDup(candidate, e.key))
      return { rule: 'containment', matched: e.key };
    if (isLcsChunkDup(candidate, e.key)) return { rule: 'lcs', matched: e.key };
  }
  return null;
}

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

// Capture mode chosen by the host before Start.
//   'both'      — mic (host) + tab (guest) captured in parallel via two
//                 OpenAI Realtime sessions. Each side's transcript carries
//                 the corresponding speaker label so the prompter and the
//                 download zip render both voices time-interleaved.
//   'mic-only'  — host's mic only. Single OpenAI session. No speaker
//                 label disambiguation possible (mic carries whoever is
//                 in the room), so lines tag as 'host'.
//   'tab-only'  — tab audio only. Single OpenAI session. Lines tag as
//                 'guest' (the captured tab is assumed to be the
//                 interviewee on the call).
type CaptureMode = 'both' | 'mic-only' | 'tab-only';

// The two source slots a session can run. The slot name doubles as the
// kind of capture (mic vs tab) AND the speaker role (host vs guest) —
// see `slotSpeaker` below.
type SourceSlot = 'mic' | 'tab';

const SLOT_SPEAKER: Record<SourceSlot, 'host' | 'guest'> = {
  mic: 'host',
  tab: 'guest',
};

function activeSlots(mode: CaptureMode): SourceSlot[] {
  if (mode === 'both') return ['mic', 'tab'];
  if (mode === 'mic-only') return ['mic'];
  return ['tab'];
}

// Empty-record factories. Keeping this as a function (not a const) so
// every consumer gets its own object — Records are mutable refs and we
// don't want two refs to alias the same instance.
function emptySlotRecord<T>(value: T): Record<SourceSlot, T> {
  return { mic: value, tab: value };
}

const LANGS: { value: string; label: string }[] = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'th', label: 'ไทย' },
  { value: 'zh', label: '中文' },
  { value: 'es', label: 'Español' },
];

// Heuristic sentence boundary used to split the translations-API
// continuous delta stream into committable caption lines. The
// translations endpoint emits no `.completed` event, so we commit on
// punctuation and treat everything between boundaries as the rolling
// in-flight line.
const SENTENCE_END = /([.!?。！？]+|[。…?])(\s+|$)/;

// 🚨 truncation investigation. A committed turn whose tail is NOT sentence-
// final punctuation is a *mid-sentence early commit* — the turn-silence
// timer fired during a word-search pause and chopped one utterance in two.
// Counting these (vs. all turn-silence commits) is the primary signal for
// candidate 2 (TURN_SILENCE_MS too low): a high mid/total ratio means the
// 1400 ms gate is splitting real sentences. Tail-anchored, allows a closing
// quote/bracket after the punctuation.
const SENTENCE_TAIL = /[.!?。！？…]+["')\]」』]?\s*$/u;

// PR-T2 turn detection. The translations API has no `speech_started` /
// `speech_stopped` events (see src/lib/openai-realtime.ts) — to spot a
// turn boundary we watch the gap between successive deltas of the same
// kind. A silence longer than this means the speaker actually stopped
// talking and the next delta begins a fresh turn.
//
// 🚨 truncation investigation (2026-06-30): raised 1400 → 2400 on REAL
// prod transcript evidence. A live ko session came back chopped into
// sub-phrase fragments — most committed lines carried NO sentence-ending
// punctuation ("일단 저희가 그 속성을", "그 포들", "기본적으로 저희가"),
// meaning the 1400 ms gate was firing on mid-sentence word-search pauses
// and word-final fillers ("어떤…", "그…") that pervade conversational
// Korean. 2400 ms requires a genuine ~2.4 s stop before a turn commits,
// keeping a single utterance intact across natural thinking pauses.
//
// Tradeoff (kept from the original 1400 tuning note): a longer gate can
// merge a short acknowledgement ("네.", "맞아요.") spoken <2.4 s after the
// prior turn into that turn's line. We accept this — the current failure
// (over-fragmentation) is the louder one, and the sentence-boundary commit
// still splits acks that carry their own punctuation. If ack-merging
// resurfaces, 1800 is the conservative fallback. The `midSentenceCommits`
// counter (this PR) measures the effect: it should drop sharply at 2400.
const TURN_SILENCE_MS = 2400;

// Chunk/word-boundary join (Layer A) now lives in
// src/lib/translate-stream-join.ts so the heuristics are unit-testable
// in isolation and reusable by the persist / export path. `joinDelta` is
// imported at the top of this file.

// Per-channel fidelity counters (one bag for `input`, one for `output`),
// reset on every Start. Factored out of the ref init + the start() reset so
// the two stay in lockstep when fields are added — the 🚨 truncation
// investigation appended six diagnostic fields and a drifted literal in
// either place would silently zero them.
type FidelityChannelCounters = {
  deltaChars: number;
  commitChars: number;
  persistOk: number;
  persistFail: number;
  droppedFffd: number;
  fuzzyDrops: number;
  containmentDrops: number;
  lcsDrops: number;
  droppedChars: number;
  turnSilenceCommits: number;
  midSentenceCommits: number;
};

function freshFidelityCounters(): Record<'input' | 'output', FidelityChannelCounters> {
  const channel = (): FidelityChannelCounters => ({
    deltaChars: 0,
    commitChars: 0,
    persistOk: 0,
    persistFail: 0,
    droppedFffd: 0,
    fuzzyDrops: 0,
    containmentDrops: 0,
    lcsDrops: 0,
    droppedChars: 0,
    turnSilenceCommits: 0,
    midSentenceCommits: 0,
  });
  return { input: channel(), output: channel() };
}

// 🚨 Phase 1 diagnostic helper. Returns a compact per-m=audio-section
// direction summary like "sendrecv" or "sendrecv,recvonly" so the console
// shows the negotiated audio lanes inline. An answer that lacks a recv lane
// (sendonly / no audio section) explains why pc.ontrack never fires while
// translated TEXT still streams over the data channel.
function summarizeAudioMlines(sdp: string): string {
  const sections = sdp.match(/m=audio[\s\S]*?(?=\r?\nm=|$)/g) ?? [];
  if (sections.length === 0) return 'no-audio-mline';
  return sections
    .map(
      (sec) =>
        sec.match(/a=(sendrecv|sendonly|recvonly|inactive)/)?.[1] ??
        'unspecified',
    )
    .join(',');
}

function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function TranslateConsole() {
  const { notify: notifyDeduction } = useCreditDeduction();
  const t = useTranslations('TranslateConsole');
  const locale = useLocale();

  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sourceLang, setSourceLang] = useState('ko');
  const [targetLang, setTargetLang] = useState('en');
  // Glossary (Layer B) — host-entered canonical spellings of names /
  // proper nouns / acronyms, captured before the session starts. Sent to
  // the create route and stored on the session; the realtime translations
  // endpoint can't take a hint (openai-realtime.ts), so glossary only
  // feeds the post-process (Layer D) and revise (Layer C) LLM passes.
  const [glossary, setGlossary] = useState<string[]>([]);
  // Capture mode picker. Default 'both' — the common online-interview
  // shape (host on mic + interviewee on tab). 'mic-only' is the
  // face-to-face fallback when no tab audio is involved. 'tab-only'
  // keeps the legacy single-source tab path for solo-listening flows.
  // Both 'both' and 'tab-only' rely on getDisplayMedia which requires
  // a user gesture, so the picker only writes state until Start fires.
  const [captureMode, setCaptureMode] = useState<CaptureMode>('both');
  // Per-slot live indicator. Flips true once the slot's RTCPeerConnection
  // reaches `connected` (or the slot's recorder starts, whichever first)
  // so the topbar can show "🎤 진행자 · 📺 응답자" with active dots.
  // Stays false for inactive slots so single-mode sessions render only
  // the engaged badge.
  const [slotActive, setSlotActive] = useState<Record<SourceSlot, boolean>>(
    () => emptySlotRecord(false),
  );
  // Per-slot non-fatal error (one slot failed but the other is still
  // alive — graceful degradation). Cleared on each Start. Surfaced as a
  // single inline notice; the main `error` state stays reserved for
  // fatal failures that tear the whole session down.
  const [slotError, setSlotError] = useState<Record<SourceSlot, string | null>>(
    () => emptySlotRecord(null),
  );

  const [inputLines, setInputLines] = useState<CaptionLine[]>([]);
  const [outputLines, setOutputLines] = useState<CaptionLine[]>([]);
  const [elapsed, setElapsed] = useState(0);
  // Host can mute the local translation playback without dropping the
  // LiveKit publish — viewers still hear the translated TTS, the host
  // just doesn't get the echo into their own room. Default ON because
  // the host typically wants to verify the translation in real time.
  const [outputAudible, setOutputAudible] = useState(true);
  // Layer A: autoplay-reject guard. Browsers block `<audio>.play()` unless
  // it follows a user gesture (incognito / fresh tab is the common trip),
  // and the monitor's silent `.play().catch(() => {})` swallowed it — the
  // host heard nothing with no signal. When the monitor's play() rejects we
  // flip this so the widget surfaces a "음성 켜기" CTA that retries play()
  // from a real click. It's a local-monitor concern only; viewers still get
  // the LiveKit publish regardless.
  const [ttsBlocked, setTtsBlocked] = useState(false);
  // `now` ticks once per second while live so the 30-second prompter
  // window slides forward continuously even when the OpenAI deltas
  // pause (e.g. the speaker takes a breath). Without this the screen
  // would freeze on stale text.
  const [now, setNow] = useState(() => Date.now());

  const [shareToken, setShareToken] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  // Recording state — null until POST /recording succeeds. Recording is
  // always on now (default save), so after stop() `recording.status`
  // flips to `uploaded` and the download buttons appear immediately —
  // there's no separate unlock charge (the 통역 시작 75-credit lump
  // already covers save + download). Old `unlocked` status is still
  // accepted for backward compat with rows charged under the old scheme.
  const [recording, setRecording] = useState<RecordingRow | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  // Server-supplied root-cause string for the recording error banner
  // (e.g. the storage / row-insert failure detail from POST /recording).
  // Surfaced beside the localized headline so a host can report the
  // actual cause instead of a generic "잠시 후 다시 시도" message.
  const [recordingErrorDetail, setRecordingErrorDetail] = useState<string | null>(null);
  // Translation-only deliverables: the translated audio track + two
  // transcript zips (realtime translation "통역본" and post-hoc batch
  // re-translation "재번역", each bundling .txt + .docx). They become
  // available once the recording row reaches `uploaded` — the revised
  // zip needs a separate /revise trigger (handled below) before it can
  // be downloaded.
  //
  // Source-side artifacts (원문 audio + 원문 transcript) are intentionally
  // NOT offered: the source ASR (gpt-4o-transcribe via the translations
  // endpoint, no Korean language hint possible — see openai-realtime.ts)
  // produces unreliable Korean (replacement chars, foreign-script
  // intrusions, dropped syllables), so surfacing it as a "기록물" misleads.
  // Deliverables are the translation; the source rows still persist for
  // the live caption / probing / revise paths.
  const [downloadingFormat, setDownloadingFormat] = useState<
    | 'm4a-output'
    | 'zip-output'
    | 'zip-revised'
    | null
  >(null);

  // PR-T3 post-hoc batch re-translation state. `revisionStatus` mirrors
  // the server-side `translate_sessions.revision_status` enum so the
  // panel can render the right CTA / spinner / download button. We
  // start at null instead of 'idle' so the panel doesn't flash a
  // "재번역" button before we know the actual state — the first poll
  // (kicked off on `session ended`) hydrates this.
  type RevisionStatus = 'idle' | 'pending' | 'done' | 'failed';
  const [revisionStatus, setRevisionStatus] = useState<RevisionStatus | null>(
    null,
  );
  const [revisionError, setRevisionError] = useState<string | null>(null);
  // Local pressed flag — true while the POST is in flight, before the
  // first GET poll comes back. Without it, two rapid clicks on the
  // revise button each fire a POST before the server status flips.
  const [revisionTriggering, setRevisionTriggering] = useState(false);
  // Whether the MediaRecorder is actively capturing. Driven from the
  // recorder's onstart/onstop events so the indicator pill renders
  // without needing to read the ref during render.
  const [recorderActive, setRecorderActive] = useState(false);

  // Mutable refs held only for the duration of a live session.
  //
  // Per-slot refs (Record<SourceSlot, …>): each captured source — mic
  // and/or tab — runs an independent pipeline (its own OpenAI Realtime
  // session, RTCPeerConnection, dataChannel, source MediaStream). Slots
  // that aren't active for the chosen captureMode stay null and the
  // cleanup loops just skip them.
  const pcRef = useRef<Record<SourceSlot, RTCPeerConnection | null>>(
    emptySlotRecord<RTCPeerConnection | null>(null),
  );
  const dcRef = useRef<Record<SourceSlot, RTCDataChannel | null>>(
    emptySlotRecord<RTCDataChannel | null>(null),
  );
  // Raw captured stream per slot. `mic` slot = getUserMedia,
  // `tab` slot = getDisplayMedia audio. Cleanup stops the tracks (which
  // also dismisses Chrome's "Sharing this tab's audio" banner).
  const srcStreamRef = useRef<Record<SourceSlot, MediaStream | null>>(
    emptySlotRecord<MediaStream | null>(null),
  );
  // Stream actually handed to the RTCPeerConnection. For mic this is the
  // raw capture; for tab this is the 24 kHz mono WebAudio resample.
  const publishStreamRef = useRef<Record<SourceSlot, MediaStream | null>>(
    emptySlotRecord<MediaStream | null>(null),
  );
  // Per-slot TTS stream emitted by OpenAI.
  const ttsStreamRef = useRef<Record<SourceSlot, MediaStream | null>>(
    emptySlotRecord<MediaStream | null>(null),
  );
  // Single LiveKit `output` publish covers both slots — once one slot's
  // ontrack lands and we wire its TTS into the shared output mixer,
  // we publish the mixer destination's track. Later slots just add into
  // the same mixer. Guarded so we publish exactly once per session.
  const outputPublishedRef = useRef(false);
  // Single LiveKit `input` publish — same idea but for the (possibly
  // mixed) source audio. The 'input' track in `both` mode carries
  // mic+tab mixed via WebAudio; in single-mode it's the slot's own
  // publishStream. Guarded so multi-slot wiring publishes once.
  const inputPublishedRef = useRef(false);
  // Shared output mixer: ONE AudioContext + ONE MediaStreamAudioDestination
  // that both slots' TTS sources feed into. We re-emit the mixed
  // destination as a local MediaStreamTrack so LiveKit can publish it
  // (browsers refuse to republish a remote PeerConnection track
  // directly).
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<Record<SourceSlot, MediaStreamAudioSourceNode | null>>(
    emptySlotRecord<MediaStreamAudioSourceNode | null>(null),
  );
  const audioDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  // Mirror for the input publish path. Created in the shared
  // `audioCtxRef` so source + dest live on the same graph.
  const inputMixDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const inputMixSrcRef = useRef<Record<SourceSlot, MediaStreamAudioSourceNode | null>>(
    emptySlotRecord<MediaStreamAudioSourceNode | null>(null),
  );
  const roomRef = useRef<Room | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  // Per-slot monitor <audio> elements. We attach each slot's RAW remote TTS
  // stream directly (the OpenAI guide pattern) instead of routing the
  // monitor through the WebAudio mixer: a remote WebRTC track fed ONLY into
  // a WebAudio MediaStreamAudioSourceNode plays silent on Chrome (the
  // long-standing crbug/121673), and the mixer's AudioContext can also land
  // suspended — both made the monitor "play" while emitting no sound.
  // Attaching the raw stream to a media element sidesteps the AudioContext
  // entirely AND "pumps" the remote track so the mixer (still used for the
  // LiveKit publish + recording) actually receives audio. Two elements so
  // `both` mode plays host + guest simultaneously.
  const monitorAudioRefs = useRef<Record<SourceSlot, HTMLAudioElement | null>>(
    emptySlotRecord<HTMLAudioElement | null>(null),
  );
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tab-audio mode only: periodic silence injection. Continuous tab
  // audio (YouTube, Meet, etc.) has no natural pauses, so the realtime
  // STT VAD never declares end-of-speech and the model keeps re-
  // translating the same rolling buffer — both OpenAI Realtime and
  // Gemini Live exhibit this. We toggle the captured audio track's
  // `enabled` flag off briefly on a 3 s cadence, which emits silence
  // frames the server VAD treats as the speaker stopping, lets it
  // commit the current turn, and breaks the otherwise-infinite loop.
  // Mic mode doesn't need this — speakers pause naturally. Tracked only
  // for the tab slot.
  const tabSilenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const TAB_SILENCE_INTERVAL_MS = 3000;
  const TAB_SILENCE_DURATION_MS = 400;

  // Tab-mode only: a dedicated AudioContext that "lifts" the
  // getDisplayMedia track through WebAudio so the track we hand to
  // RTCPeerConnection/LiveKit is a fresh, normalised one. PR #393's
  // sampleRate hint on getDisplayMedia is silently ignored by Chrome,
  // so we force a 24 kHz mono path here — that's the canonical rate
  // for the OpenAI Realtime translations model and removes one of the
  // two known stall hypotheses (the other being ICE; see below).
  // Kept separate from `audioCtxRef` (which is created lazily in
  // pc.ontrack for the OUTPUT re-emit) so input cleanup doesn't fight
  // output cleanup.
  const tabResampleCtxRef = useRef<AudioContext | null>(null);

  // Watchdog: if start() doesn't reach setStatus('live') within
  // CONNECT_TIMEOUT_MS we surface `translate_timeout` and tear down.
  // Pre-PR-394 a hang in room.connect / publishTrack / fetch(openai SDP)
  // would leave the UI on "연결 중" forever with no signal. The diagnostic
  // logs added in PR #393 give us the WHERE; this watchdog gives the
  // user a way OUT.
  const connectWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const CONNECT_TIMEOUT_MS = 10_000;

  // Rolling buffer for the currently-streaming caption line per side
  // PER SLOT. Each OpenAI Realtime session has its own delta stream
  // that finalizes independently, so a single shared partial would
  // smash host + guest text together. Outer map keyed by slot, inner
  // value is the slot's current rolling partial.
  const partialInputRef = useRef<Record<SourceSlot, { id: string; text: string } | null>>(
    emptySlotRecord<{ id: string; text: string } | null>(null),
  );
  const partialOutputRef = useRef<Record<SourceSlot, { id: string; text: string } | null>>(
    emptySlotRecord<{ id: string; text: string } | null>(null),
  );

  // PR-T2: wall-clock of the most recent delta per kind PER SLOT. A gap
  // larger than TURN_SILENCE_MS between two deltas of the same (slot,
  // kind) is treated as a turn boundary — we commit the current partial
  // before appending the new delta. Keyed per-slot so the host pausing
  // doesn't force-commit the guest's mid-sentence pause.
  const lastDeltaAtRef = useRef<
    Record<SourceSlot, Record<'input' | 'output', number | null>>
  >({
    mic: { input: null, output: null },
    tab: { input: null, output: null },
  });

  // Shared transcript publisher — provider 가 mount 되어 있을 때 (예: /canvas)
  // 다른 위젯이 input transcript 를 구독할 수 있게 함. /live 페이지처럼
  // provider 없는 곳에서는 hook 이 no-op publisher 를 반환.
  const transcriptPublisher = useRealtimeTranscriptPublisher();
  // input line id → started_at(ms). publish 시 segment 의 started_at 으로 사용.
  const inputLineStartedAtRef = useRef<Map<string, number>>(new Map());
  // 라이브 상태를 provider 로 전달 — probing 같은 위젯이 isLive 로 헤더
  // 표시/대기 placeholder 를 판단. unmount 시 자동 false 처리.
  useRealtimeTranscriptLiveBinding(status === 'live');

  // Synchronous re-entry guard for start(). The status closure in start()
  // can be stale across rapid invocations (the captured `status` was
  // 'idle' even after setStatus('starting') was queued but not yet
  // applied). This ref is read+written in the same microtask so a second
  // start() entering before the first awaits cannot get past it.
  const startInFlightRef = useRef(false);

  // Dedup keys for finalized lines per kind PER SLOT. Sliding window —
  // entries older than DEDUP_WINDOW_MS are dropped on each insert so the
  // map never grows unbounded across a long session. Keyed per-slot so
  // the guest saying "네." doesn't suppress the host's later "네." (and
  // vice versa) just because both normalize to the same dedup key.
  const recentFinalsRef = useRef<
    Record<SourceSlot, Record<'input' | 'output', Array<{ key: string; ts: number }>>>
  >({
    mic: { input: [], output: [] },
    tab: { input: [], output: [] },
  });

  // PR #223 caught the prompter duplication symptom but the prod logs
  // showed `kind: 'input'` getting deduped 5+ times per utterance —
  // meaning the OpenAI translations API itself is re-emitting the same
  // content. We don't yet know whether the deltas are incremental,
  // cumulative, or interim refinements. This ref samples the first N
  // events of each `type` per session and logs the full payload so the
  // next live run on production tells us the actual protocol shape
  // without flooding the console for long sessions.
  const sampleCountRef = useRef<Map<string, number>>(new Map());
  const EVENT_SAMPLE_CAP = 8;

  // Bounded sampler for the Korean word-fusion investigation (audit #3).
  // Korean has no case transitions, so the Latin-only join heuristics can't
  // insert a space between two Hangul tokens — if OpenAI drops the
  // inter-word space the boundary fuses ("소재들을분석하고"). We log a few
  // samples per (slot,kind) per session recording whether the incoming
  // delta carried any leading/trailing whitespace, so prod logs can settle
  // whether the space was sent-and-dropped (a join bug we can fix) or never
  // sent (needs the post-process LLM, not a stream-time fix). Runs in prod
  // (not gated on TRACE_ENCODING) but capped so it can't flood the console.
  const fusionSampleRef = useRef<Map<string, number>>(new Map());
  const FUSION_SAMPLE_CAP = 6;

  // Fidelity counters — chars surfaced by the data-channel deltas vs chars
  // that actually reached the /messages POST. Drift means dedup or
  // sentence-boundary slicing dropped real content; we surface it on
  // stop() and (server-side) audit it when the loss crosses the
  // FIDELITY_LOSS_THRESHOLD. Counters are aggregated across both slots
  // per-kind — the loss report is for the session as a whole and the
  // server-side audit doesn't need per-speaker breakdowns yet.
  // `droppedFffd` counts U+FFFD replacement chars discarded by the
  // byte-split mojibake collapse in joinDelta (see translate-stream-join).
  // It's a lossy-but-intended cleanup, surfaced in the stop() report so a
  // spike is visible without masking it as silent drift.
  //
  // 🚨 truncation investigation fields (`*Drops` / `*Commits` /
  // `droppedChars`): per-reason dedup-drop attribution + turn-silence
  // early-commit signals. They let one live session distinguish the two
  // truncation candidates — dedup over-application (high `droppedChars` +
  // `fuzzy/containment/lcsDrops`) vs. turn-silence mid-sentence chopping
  // (high `midSentenceCommits` / `turnSilenceCommits`).
  const fidelityCountersRef = useRef<
    Record<'input' | 'output', FidelityChannelCounters>
  >(freshFidelityCounters());

  // Recording graph — TWO dedicated MediaStreamDestinationNodes, one for
  // the host's source stream (mic/tab — mixed when `both` mode) and one
  // for the translated TTS (mixed across both slots when `both` mode).
  // We do NOT reuse `audioDestRef` (which feeds LiveKit publish):
  // MediaRecorder reading the same destination as a simultaneous
  // LiveKit publish has produced silent/glitchy webm files in testing.
  //
  // Wiring:
  //   slot.src (mic+tab)   → recordInputSrcRef[slot] → recordInputDest → MediaRecorder(input)
  //   slot.tts (translated) → recordOutputSrcRef[slot] → recordOutputDest → MediaRecorder(output)
  //
  // In `both` mode, both slots' source nodes connect to the same
  // recordInputDest (mixing them into a single mic+tab input.webm), and
  // both slots' TTS nodes connect to the same recordOutputDest. The input
  // track is still recorded (it backs the translation pipeline) but is no
  // longer offered as a download — only the translated audio + transcript
  // ship as deliverables (see the downloadingFormat comment).
  const recordInputDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const recordOutputDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const recordInputSrcRef = useRef<Record<SourceSlot, MediaStreamAudioSourceNode | null>>(
    emptySlotRecord<MediaStreamAudioSourceNode | null>(null),
  );
  const recordOutputSrcRef = useRef<Record<SourceSlot, MediaStreamAudioSourceNode | null>>(
    emptySlotRecord<MediaStreamAudioSourceNode | null>(null),
  );
  const mediaRecorderInputRef = useRef<MediaRecorder | null>(null);
  const mediaRecorderOutputRef = useRef<MediaRecorder | null>(null);
  const recordedInputChunksRef = useRef<Blob[]>([]);
  const recordedOutputChunksRef = useRef<Blob[]>([]);
  // One DB row owns BOTH tracks. The first POST creates it, the second
  // POST attaches the other kind to the same row.
  const recordingIdRef = useRef<string | null>(null);
  const recordingInputUploadUrlRef = useRef<string | null>(null);
  const recordingOutputUploadUrlRef = useRef<string | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);

  // Heartbeat ticker for elapsed display.
  useEffect(() => {
    if (status !== 'live') {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      return;
    }
    tickRef.current = setInterval(() => {
      const wall = Date.now();
      if (startedAtRef.current) {
        setElapsed(wall - startedAtRef.current);
      }
      // Keep the prompter window honest even when deltas pause.
      setNow(wall);
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [status]);

  // Monitor audio routing. `outputAudible` is the host's local mute
  // toggle: when OFF, the host's own <audio> element is muted but the
  // translated TTS keeps flowing through LiveKit so viewers still hear
  // it. We do NOT stop the publish — the gain node / track on the
  // outbound side stays untouched.
  useEffect(() => {
    for (const slot of ['mic', 'tab'] as const) {
      const el = monitorAudioRefs.current[slot];
      if (el) el.muted = !outputAudible;
    }
  }, [outputAudible]);

  // Layer D: monitor <audio> lifecycle diagnostics. The element is mounted
  // for the component's whole life, so a `[]`-dep effect binds the
  // listeners once. They make a "no sound" report attributable to a
  // concrete play / pause / error event instead of guesswork — paired with
  // the pc.ontrack diagnostic below, the two pin the failure to either the
  // server (no track) or the client (track present but element never plays).
  useEffect(() => {
    const cleanups: Array<() => void> = [];
    for (const slot of ['mic', 'tab'] as const) {
      const el = monitorAudioRefs.current[slot];
      if (!el) continue;
      const onPlay = () =>
        console.info(`[translate:${slot}] TTS monitor playing`);
      const onPause = () =>
        console.info(`[translate:${slot}] TTS monitor paused`);
      const onError = () =>
        console.error(`[translate:${slot}] TTS monitor error`, el.error);
      el.addEventListener('play', onPlay);
      el.addEventListener('pause', onPause);
      el.addEventListener('error', onError);
      cleanups.push(() => {
        el.removeEventListener('play', onPlay);
        el.removeEventListener('pause', onPause);
        el.removeEventListener('error', onError);
      });
    }
    return () => cleanups.forEach((fn) => fn());
  }, []);

  // `caller` is purely diagnostic — surfaces in the production log so we
  // can match a stray `disconnect from room` cycle back to whichever
  // path tore the session down (start error vs stop vs unmount vs
  // re-entry guard). No behaviour difference between values.
  const cleanup = useCallback((caller: CleanupCaller) => {
    console.info('[translate] cleanup', {
      caller,
      sessionId: sessionIdRef.current,
      hasRoom: !!roomRef.current,
      hasPc: !!(pcRef.current.mic || pcRef.current.tab),
    });
    try {
      channelRef.current?.unsubscribe();
    } catch {}
    channelRef.current = null;
    for (const slot of ['mic', 'tab'] as const) {
      try {
        dcRef.current[slot]?.close();
      } catch {}
      dcRef.current[slot] = null;
      try {
        pcRef.current[slot]?.close();
      } catch {}
      pcRef.current[slot] = null;
      srcStreamRef.current[slot]?.getTracks().forEach((tr) => tr.stop());
      srcStreamRef.current[slot] = null;
      publishStreamRef.current[slot] = null;
      ttsStreamRef.current[slot] = null;
      try {
        audioSourceRef.current[slot]?.disconnect();
      } catch {}
      audioSourceRef.current[slot] = null;
      try {
        inputMixSrcRef.current[slot]?.disconnect();
      } catch {}
      inputMixSrcRef.current[slot] = null;
      try {
        recordInputSrcRef.current[slot]?.disconnect();
      } catch {}
      recordInputSrcRef.current[slot] = null;
      try {
        recordOutputSrcRef.current[slot]?.disconnect();
      } catch {}
      recordOutputSrcRef.current[slot] = null;
      partialInputRef.current[slot] = null;
      partialOutputRef.current[slot] = null;
      lastDeltaAtRef.current[slot] = { input: null, output: null };
    }
    if (tabSilenceTimerRef.current) {
      clearInterval(tabSilenceTimerRef.current);
      tabSilenceTimerRef.current = null;
    }
    if (connectWatchdogRef.current) {
      clearTimeout(connectWatchdogRef.current);
      connectWatchdogRef.current = null;
    }
    try {
      void tabResampleCtxRef.current?.close();
    } catch {}
    tabResampleCtxRef.current = null;
    outputPublishedRef.current = false;
    inputPublishedRef.current = false;
    audioDestRef.current = null;
    inputMixDestRef.current = null;
    recordInputDestRef.current = null;
    recordOutputDestRef.current = null;
    try {
      void audioCtxRef.current?.close();
    } catch {}
    audioCtxRef.current = null;
    try {
      const recIn = mediaRecorderInputRef.current;
      if (recIn && recIn.state !== 'inactive') recIn.stop();
    } catch {}
    try {
      const recOut = mediaRecorderOutputRef.current;
      if (recOut && recOut.state !== 'inactive') recOut.stop();
    } catch {}
    mediaRecorderInputRef.current = null;
    mediaRecorderOutputRef.current = null;
    recordedInputChunksRef.current = [];
    recordedOutputChunksRef.current = [];
    recordingIdRef.current = null;
    recordingInputUploadUrlRef.current = null;
    recordingOutputUploadUrlRef.current = null;
    recordingStartedAtRef.current = null;
    setRecorderActive(false);
    setSlotActive(emptySlotRecord(false));
    if (roomRef.current) {
      void roomRef.current.disconnect();
      roomRef.current = null;
    }
    for (const slot of ['mic', 'tab'] as const) {
      const el = monitorAudioRefs.current[slot];
      if (el) el.srcObject = null;
    }
  }, []);

  // Layer A: retry monitor playback from a real user gesture. The autoplay
  // policy only grants playback after a click/tap, so the "음성 켜기" CTA
  // routes here. Re-pins srcObject to the live mixer (it may have been
  // cleared) and respects the current mute toggle before playing; success
  // clears the blocked banner.
  const enableTtsPlayback = useCallback(async () => {
    try {
      // Best-effort resume of the mixer's AudioContext so the LiveKit
      // publish / recording graph runs. The host monitor itself plays the
      // RAW stream (below) and does NOT depend on the context, so this is
      // only for the viewer/recording path.
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state === 'suspended') await ctx.resume();
      console.info('[translate] enableTtsPlayback', {
        ctxState: audioCtxRef.current?.state ?? null,
      });
      // Replay each slot's monitor element from its raw TTS stream, inside
      // this button's user gesture (so the autoplay policy lets play()
      // succeed). Covers both single-slot and `both` mode.
      let played = false;
      for (const slot of ['mic', 'tab'] as const) {
        const el = monitorAudioRefs.current[slot];
        const raw = ttsStreamRef.current[slot];
        if (!el || !raw) continue;
        if (el.srcObject !== raw) el.srcObject = raw;
        el.muted = !outputAudible;
        await el.play();
        played = true;
      }
      if (played) setTtsBlocked(false);
    } catch (err) {
      console.warn('[translate] TTS manual play failed', err);
      setTtsBlocked(true);
    }
  }, [outputAudible]);

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
      // The viewer prompter only renders translated output, so input
      // captions don't need to traverse the broadcast channel — saves
      // bandwidth on long sessions. They're still persisted via
      // /messages below so PR-B can offer a bilingual download.
      if (kind === 'input') return;
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
    async (
      kind: 'input' | 'output',
      text: string,
      lang: string,
      // PR-T2: 'host' (interviewer on mic) or 'guest' (interviewee via
      // the captured tab). Output rows inherit the same speaker since
      // they translate the same person's utterance. Omit when the host
      // hasn't picked a source (idle state) — column persists NULL and
      // the renderer falls back to "unknown".
      speaker: 'host' | 'guest' | null,
    ) => {
      const id = sessionIdRef.current;
      if (!id) return;
      const counters = fidelityCountersRef.current[kind];
      counters.commitChars += text.length;
      if (TRACE_ENCODING) {
        console.info('[translate] persist →', {
          kind,
          speaker,
          ...summarizeFidelity(text),
          preview: text.slice(0, 24),
        });
      }
      try {
        // Omit `speaker` when null. The server schema is
        // `z.enum(['host','guest']).optional()` — zod's .optional() permits
        // `undefined` but NOT `null`, so sending `{"speaker":null}` over
        // the wire fails parse with 400 invalid_input and the row is lost.
        // Tab-mode sessions used to silently drop every line until we
        // caught this (HOTFIX post-#491). The "unknown speaker" semantic
        // is preserved by the DB column being nullable + the insert path
        // coercing missing → NULL.
        const body: Record<string, unknown> = { kind, text, lang };
        if (speaker) body.speaker = speaker;
        const res = await fetch(`/api/translate/sessions/${id}/messages`, {
          method: 'POST',
          // charset=utf-8 explicit — some intermediaries default to
          // latin-1 when no charset is set, mangling multi-byte CJK on
          // re-encode. The request body is always UTF-8 (JSON.stringify
          // on a JS string), so we just have to declare it.
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(body),
        });
        if (res.ok) counters.persistOk++;
        else counters.persistFail++;
      } catch {
        counters.persistFail++;
        // Best-effort. Caption is already on the broadcast channel.
      }
    },
    [],
  );

  // Speaker mapping is now slot-driven (mic → host, tab → guest). For
  // single-mode sessions the slot is fixed by captureMode; for `both`
  // mode each delta routes through the slot that emitted it. The
  // mapping is a pure lookup (`SLOT_SPEAKER[slot]`) so each callback
  // can derive its speaker from the slot it's bound to without
  // capturing a stale closure value.

  const appendStreaming = useCallback(
    (slot: SourceSlot, kind: 'input' | 'output', delta: string, lang: string) => {
      if (!delta) return;
      const speaker = SLOT_SPEAKER[slot];
      const partialBag = kind === 'input' ? partialInputRef : partialOutputRef;
      const wall = Date.now();

      // PR-T2 silence-based turn detection (per slot). If a long enough
      // gap has elapsed since the previous delta of the same (slot,
      // kind), the prior partial line represents a finished turn —
      // commit it (and start a fresh partial for the new delta) BEFORE
      // appending. Without this the "Yes." acknowledgement gets
      // stitched onto the end of the prior speaker's sentence with no
      // punctuation between them, producing the "... for that person,
      // Yes." line in the user's report. Tracked per-slot so the host
      // pausing doesn't force-commit the guest's mid-sentence pause.
      const lastAt = lastDeltaAtRef.current[slot][kind];
      lastDeltaAtRef.current[slot][kind] = wall;
      const existing = partialBag.current[slot];
      if (
        existing &&
        existing.text.trim() &&
        lastAt !== null &&
        wall - lastAt >= TURN_SILENCE_MS
      ) {
        const turnText = existing.text.trim();
        const turnKey = normalizeForDedup(turnText);
        const bucket = recentFinalsRef.current[slot][kind];
        const fresh = bucket.filter((e) => wall - e.ts <= DEDUP_WINDOW_MS);
        const ctr = fidelityCountersRef.current[kind];
        const dup = turnKey.length > 0 ? matchDedupRule(turnKey, fresh) : null;
        if (dup) {
          // 🚨 truncation investigation: attribute the drop + log the FULL
          // text that was dropped (not a 40-char preview) so the host can
          // diff it against the audio. A turn-silence commit that then gets
          // deduped is the highest-risk path — the partial was already a
          // full turn when the timer fired.
          if (dup.rule === 'fuzzy') ctr.fuzzyDrops++;
          else if (dup.rule === 'containment') ctr.containmentDrops++;
          else ctr.lcsDrops++;
          ctr.droppedChars += turnText.length;
          console.info('[translate] dedup (turn-silence)', {
            slot,
            kind,
            rule: dup.rule,
            dropped: turnText,
            matched: dup.matched,
          });
          const setter = kind === 'input' ? setInputLines : setOutputLines;
          setter((prev) => prev.filter((l) => l.id !== existing.id));
        } else {
          // Kept commit triggered by the turn-silence gate. If it doesn't
          // end on sentence punctuation it's a mid-sentence early commit —
          // candidate 2's smoking gun.
          ctr.turnSilenceCommits++;
          if (!SENTENCE_TAIL.test(turnText)) {
            ctr.midSentenceCommits++;
            console.info('[translate] turn-silence mid-sentence commit', {
              slot,
              kind,
              text: turnText,
            });
          }
          fresh.push({ key: turnKey, ts: wall });
          recentFinalsRef.current[slot][kind] = fresh;
          const finalLine: CaptionLine = {
            id: existing.id,
            text: turnText,
            final: true,
            ts: wall,
            speaker,
          };
          pushLine(kind, finalLine);
          broadcastCaption(kind, finalLine, lang);
          void persistMessage(kind, turnText, lang, speaker);
          if (kind === 'input') {
            const startedAt =
              inputLineStartedAtRef.current.get(existing.id) ?? wall;
            transcriptPublisher.publishSegment({
              id: existing.id,
              text: turnText,
              started_at: startedAt,
              ended_at: wall,
              locale: lang,
            });
          }
        }
        partialBag.current[slot] = null;
      }

      // Reuse a single rolling line id per (slot, kind), replaced when
      // a sentence boundary commits. Slot is encoded in the id so the
      // partial/finalized lines from the two slots never collide.
      const current = partialBag.current[slot] ?? { id: `${slot}-${kind}-${wall}`, text: '' };
      // Korean word-fusion diagnostic (audit #3) — sample whether the
      // upstream delta carried a space the join could preserve. Logged
      // BEFORE joinDelta so we see the raw boundary. See fusionSampleRef.
      if (isHangulFusionBoundary(current.text, delta)) {
        const fusionKey = `${slot}:${kind}`;
        const fusionSeen = fusionSampleRef.current.get(fusionKey) ?? 0;
        if (fusionSeen < FUSION_SAMPLE_CAP) {
          fusionSampleRef.current.set(fusionKey, fusionSeen + 1);
          console.info('[translate] hangul-fusion boundary', {
            n: fusionSeen + 1,
            slot,
            kind,
            prevTail: current.text.slice(-12),
            deltaHead: delta.slice(0, 12),
            deltaLeadsSpace: /^\s/.test(delta),
            prevTrailsSpace: /\s$/.test(current.text),
          });
        }
      }
      // PR-T2 chunk-boundary join — see joinDelta comment. Plain `+`
      // produced the "alsoOnce" / "serviceWe" word-fusion the user
      // reported. joinDelta also collapses byte-split mojibake `��` pairs
      // straddling the boundary; count the dropped U+FFFD so the fidelity
      // report reflects the lossy cleanup instead of hiding it.
      const next = joinDelta(current.text, delta);
      const fffdDropped =
        countReplacementChars(current.text) +
        countReplacementChars(delta) -
        countReplacementChars(next);
      if (fffdDropped > 0) {
        fidelityCountersRef.current[kind].droppedFffd += fffdDropped;
        console.warn('[translate] mojibake collapse', {
          slot,
          kind,
          dropped: fffdDropped,
          preview: next.slice(-16),
        });
      }
      // Shared transcript publisher 는 input (source) 만 노출 — probing
      // 같은 위젯은 인터뷰이의 발화 (= mic input) 만 보면 된다. publishInput
      // 헬퍼 안에서 started_at lookup/seed + provider 호출 처리.
      const publishInput = (
        text: string,
        endedAt: number | undefined,
      ): void => {
        if (kind !== 'input') return;
        let startedAt = inputLineStartedAtRef.current.get(current.id);
        if (startedAt === undefined) {
          startedAt = wall;
          inputLineStartedAtRef.current.set(current.id, startedAt);
        }
        transcriptPublisher.publishSegment({
          id: current.id,
          text,
          started_at: startedAt,
          ended_at: endedAt,
          locale: lang,
        });
      };
      const match = next.match(SENTENCE_END);
      if (match && match.index !== undefined) {
        const cut = match.index + match[1].length;
        const finalText = next.slice(0, cut).trim();
        const remainder = next.slice(cut).trim();
        if (finalText) {
          // Dedup against recent finals (see DEDUP_WINDOW_MS comment).
          // We normalize punctuation+whitespace because successive OpenAI
          // sessions tokenize the same utterance slightly differently
          // (a comma appearing or vanishing between runs is the typical
          // diff). The DISPLAY text stays original — only the lookup key
          // is normalized.
          const dedupKey = normalizeForDedup(finalText);
          const bucket = recentFinalsRef.current[slot][kind];
          const fresh = bucket.filter((e) => wall - e.ts <= DEDUP_WINDOW_MS);
          // PR #224 dedup stack — applied in order:
          //   1. Fuzzy (Levenshtein ratio ≤ 20%) — catches single-char
          //      substitutions like "이걸" → "그걸".
          //   2. Containment — catches the case where OpenAI emits the
          //      same utterance once as N short comma-separated commits
          //      and again as one long concatenated commit. The shorter
          //      side must clear CONTAINMENT_MIN_LEN to avoid common
          //      short phrases ("네.") wrongly matching against any
          //      longer line that contains them.
          const dup =
            dedupKey.length > 0 ? matchDedupRule(dedupKey, fresh) : null;
          if (dup) {
            // 🚨 truncation investigation: per-reason attribution + full
            // dropped text so a live session quantifies how much real
            // speech each heuristic eats (candidate 1).
            const ctr = fidelityCountersRef.current[kind];
            if (dup.rule === 'fuzzy') ctr.fuzzyDrops++;
            else if (dup.rule === 'containment') ctr.containmentDrops++;
            else ctr.lcsDrops++;
            ctr.droppedChars += finalText.length;
            console.info('[translate] dedup', {
              slot,
              kind,
              rule: dup.rule,
              dropped: finalText,
              matched: dup.matched,
            });
            // The partial that was about to be finalized lives in
            // {input,output}Lines as a non-final preview row (rendered
            // with the trailing "…"). Skipping the commit also means
            // skipping the pushLine that would have replaced it with
            // final=true — without this cleanup it stays as an
            // orphaned partial row forever, and the prompter slowly
            // fills with greyed "…" copies of every deduped utterance.
            // Drop it now so the prompter only shows what we actually
            // commit.
            const setter = kind === 'input' ? setInputLines : setOutputLines;
            setter((prev) => prev.filter((l) => l.id !== current.id));
          } else {
            fresh.push({ key: dedupKey, ts: wall });
            recentFinalsRef.current[slot][kind] = fresh;
            const finalLine: CaptionLine = {
              id: current.id,
              text: finalText,
              final: true,
              ts: wall,
              speaker,
            };
            pushLine(kind, finalLine);
            broadcastCaption(kind, finalLine, lang);
            void persistMessage(kind, finalText, lang, speaker);
            publishInput(finalText, wall);
          }
        }
        if (remainder) {
          const nextId = `${slot}-${kind}-${wall}`;
          partialBag.current[slot] = { id: nextId, text: remainder };
          const partialLine: CaptionLine = {
            id: nextId,
            text: remainder,
            final: false,
            ts: wall,
            speaker,
          };
          pushLine(kind, partialLine);
          broadcastCaption(kind, partialLine, lang);
          if (kind === 'input') {
            // 새 line — 별도 started_at 으로 등록 후 publish.
            inputLineStartedAtRef.current.set(nextId, wall);
            transcriptPublisher.publishSegment({
              id: nextId,
              text: remainder,
              started_at: wall,
              ended_at: undefined,
              locale: lang,
            });
          }
        } else {
          partialBag.current[slot] = null;
        }
      } else {
        partialBag.current[slot] = { id: current.id, text: next };
        const partialLine: CaptionLine = {
          id: current.id,
          text: next,
          final: false,
          ts: wall,
          speaker,
        };
        pushLine(kind, partialLine);
        broadcastCaption(kind, partialLine, lang);
        publishInput(next, undefined);
      }
    },
    [broadcastCaption, persistMessage, pushLine, transcriptPublisher],
  );

  const handleOaiEvent = useCallback(
    (slot: SourceSlot, raw: string) => {
      let msg: { type?: string; [k: string]: unknown };
      try {
        msg = JSON.parse(raw) as { type?: string };
      } catch {
        return;
      }
      const type = msg.type ?? '';

      // Diagnostic sampler — see sampleCountRef comment. Bounded so a
      // 30-min session emits at most ~8 × (# distinct event types) log
      // lines. We log the whole payload because the field we need
      // (whether `delta` is incremental or cumulative, whether a
      // `completed` carries the canonical final text, etc.) may not
      // be `delta` itself. Per-slot sampling key so each session's
      // protocol shape is captured independently.
      const sampleKey = `${slot}:${type || '<no-type>'}`;
      const seen = sampleCountRef.current.get(sampleKey) ?? 0;
      if (seen < EVENT_SAMPLE_CAP) {
        sampleCountRef.current.set(sampleKey, seen + 1);
        console.info('[translate] oai-event', {
          n: seen + 1,
          slot,
          type,
          payload: msg,
        });
      }

      // Source-language transcript — emitted by gpt-realtime-translate
      // when `audio.input.transcription` is enabled at session-create.
      if (type === 'session.input_transcript.delta') {
        const delta = String(msg.delta ?? '');
        // Script-guard (audit #1) — last-resort drop for the Japanese
        // fallback. A ko-source session should never produce a kana-only
        // fragment; gpt-4o-transcribe makes it rare but not impossible,
        // so we drop the fragment here before it pollutes the caption /
        // transcript instead of relying on the model alone. Counted as
        // delta chars first so the fidelity loss ratio reflects the drop
        // rather than silently masking it. Only ko sessions are guarded —
        // a ja-source session legitimately emits kana.
        if (sourceLang === 'ko' && looksJapaneseFallback(delta)) {
          fidelityCountersRef.current.input.deltaChars += delta.length;
          console.warn('[translate] japanese-fallback drop (ko source)', {
            slot,
            preview: delta.slice(0, 32),
          });
          return;
        }
        fidelityCountersRef.current.input.deltaChars += delta.length;
        if (TRACE_ENCODING && delta) {
          const summary = summarizeFidelity(delta);
          if (summary.replacementChars > 0 || summary.mojibake) {
            console.warn('[translate] delta encoding suspect (input)', {
              slot,
              ...summary,
              preview: delta.slice(0, 32),
            });
          }
        }
        appendStreaming(slot, 'input', delta, sourceLang);
        return;
      }
      // Translated text — streams continuously.
      if (type === 'session.output_transcript.delta') {
        const delta = String(msg.delta ?? '');
        fidelityCountersRef.current.output.deltaChars += delta.length;
        if (TRACE_ENCODING && delta) {
          const summary = summarizeFidelity(delta);
          if (summary.replacementChars > 0 || summary.mojibake) {
            console.warn('[translate] delta encoding suspect (output)', {
              slot,
              ...summary,
              preview: delta.slice(0, 32),
            });
          }
        }
        appendStreaming(slot, 'output', delta, targetLang);
        return;
      }
      // Note: `session.output_audio.delta` is delivered via the WebRTC
      // media track, not the data channel — we don't need to handle it
      // here.
    },
    [appendStreaming, sourceLang, targetLang],
  );

  const start = useCallback(async () => {
    // Two-layer guard: (1) the status closure may be stale across rapid
    // invocations (React batches the setStatus('starting') below so a
    // second click within the same microtask still sees 'idle'); (2) the
    // ref check is synchronous and survives any closure staleness, so it
    // is the actual stopgap against concurrent start() calls.
    if (startInFlightRef.current) {
      console.info('[translate] start re-entry blocked (in-flight)');
      return;
    }
    if (status === 'live' || status === 'starting') return;
    startInFlightRef.current = true;
    // RESET dedup memory on every Start (per-slot per-kind buckets).
    // Cross-session dedup proved too brittle — see the original PR
    // comment kept below for context.
    recentFinalsRef.current = {
      mic: { input: [], output: [] },
      tab: { input: [], output: [] },
    };
    inputLineStartedAtRef.current.clear();
    // PR-T2: fresh silence tracker each session — a stale `lastAt`
    // from a prior session would force-commit the first delta of the
    // new one as a turn boundary against empty state.
    lastDeltaAtRef.current = {
      mic: { input: null, output: null },
      tab: { input: null, output: null },
    };
    partialInputRef.current = emptySlotRecord(null);
    partialOutputRef.current = emptySlotRecord(null);
    // Shared transcript provider — 새 세션이 시작되면 이전 세그먼트는 무효.
    // provider 가 없는 컨텍스트 (/live) 에서는 no-op.
    transcriptPublisher.clear();
    // Reset event sampler too — each session gets a fresh budget so we
    // see the protocol shape from t=0 of every recording.
    sampleCountRef.current.clear();
    // Reset fidelity counters — same rationale as the dedup memory reset
    // above, plus the loss-ratio comparison wants per-session totals.
    fidelityCountersRef.current = freshFidelityCounters();
    fusionSampleRef.current.clear();
    setError(null);
    setSlotError(emptySlotRecord(null));
    setSlotActive(emptySlotRecord(false));
    setTtsBlocked(false);
    setInputLines([]);
    setOutputLines([]);
    setElapsed(0);
    setShareToken(null);
    setShareCopied(false);
    // Reset recording UI for the new session — last session's download
    // panel should disappear the moment the host hits Start.
    setRecording(null);
    setRecordingError(null);
    setRecordingErrorDetail(null);
    setDownloadingFormat(null);
    // Same for the post-hoc revision UI — last session's "done" pill
    // shouldn't carry over and tempt the host into a stale download.
    setRevisionStatus(null);
    setRevisionError(null);
    setRevisionTriggering(false);
    setStatus('starting');

    const slotsToStart = activeSlots(captureMode);
    const captureModeAtStart = captureMode;

    // Arm the connect watchdog. Any path that succeeds clears it (live
    // reached). Any path that fails has already called cleanup(), which
    // also clears it. The fallback fires only when start() makes no
    // forward progress for CONNECT_TIMEOUT_MS — typically a silent
    // hang in room.connect / publishTrack / openai SDP fetch / ICE
    // gathering. We log the last-known PC/DC state so the diagnostic
    // window points at the right stage.
    if (connectWatchdogRef.current) clearTimeout(connectWatchdogRef.current);
    connectWatchdogRef.current = setTimeout(() => {
      connectWatchdogRef.current = null;
      console.warn('[translate] connect timeout', {
        mic: {
          pc: pcRef.current.mic?.connectionState ?? null,
          ice: pcRef.current.mic?.iceConnectionState ?? null,
          dc: dcRef.current.mic?.readyState ?? null,
        },
        tab: {
          pc: pcRef.current.tab?.connectionState ?? null,
          ice: pcRef.current.tab?.iceConnectionState ?? null,
          dc: dcRef.current.tab?.readyState ?? null,
        },
        hasRoom: !!roomRef.current,
      });
      setError('translate_timeout');
      setStatus('error');
      cleanup('start_error_webrtc');
      startInFlightRef.current = false;
    }, CONNECT_TIMEOUT_MS);

    // 1) Create the translate_sessions row + grab the first OpenAI
    //    ephemeral + LiveKit token bundle in one call.
    let bundle: SessionBundle;
    try {
      const res = await fetch('/api/translate/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_lang: sourceLang,
          target_lang: targetLang,
          // Recording is always on (default save). The host no longer
          // chooses — the 75-credit start lump already pays for it.
          record_enabled: true,
          // Layer B — canonical spellings for the post-process / revise
          // passes. Empty array is the default (old behaviour).
          glossary,
        }),
      });
      const json = (await res.json()) as SessionBundle | { error: string };
      if (!res.ok || 'error' in json) {
        throw new Error((json as { error: string }).error ?? 'session_failed');
      }
      bundle = json;
      // 차감 broadcast — 세션 시작 시 lump 50 credit. 위젯 헤더 -N + topbar pulse.
      notifyDeduction('translate', FEATURE_COSTS.translate);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'session_failed');
      setStatus('error');
      if (connectWatchdogRef.current) {
        clearTimeout(connectWatchdogRef.current);
        connectWatchdogRef.current = null;
      }
      startInFlightRef.current = false;
      return;
    }

    sessionIdRef.current = bundle.session.id;
    console.info('[translate] session ok — acquiring sources', {
      captureMode: captureModeAtStart,
      sessionId: bundle.session.id,
      slots: slotsToStart,
    });

    // 2) Acquire media per slot. Tab-mode slots run getDisplayMedia +
    //    24 kHz mono WebAudio resample (see prior comment block). Mic
    //    slots run getUserMedia. In `both` mode both prompts fire in
    //    sequence within the original Start gesture — Chrome will pop
    //    them one after the other.
    type WebkitWindow = Window &
      typeof globalThis & {
        webkitAudioContext?: typeof AudioContext;
      };
    const w = window as WebkitWindow;
    const AudioCtx = w.AudioContext ?? w.webkitAudioContext;

    const acquireMicSlot = async (): Promise<boolean> => {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        srcStreamRef.current.mic = mic;
        publishStreamRef.current.mic = mic;
        return true;
      } catch (e) {
        const name = e instanceof DOMException ? e.name : '';
        console.warn('[translate] mic capture failed', { name, error: e });
        return false;
      }
    };

    const acquireTabSlot = async (): Promise<boolean> => {
      try {
        console.info('[translate] requesting getDisplayMedia');
        const display = await navigator.mediaDevices.getDisplayMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: { ideal: 1 },
            sampleRate: { ideal: 48000 },
          },
          video: { displaySurface: 'browser' },
        });
        display.getVideoTracks().forEach((tr) => tr.stop());
        const audioTracks = display.getAudioTracks();
        console.info('[translate] getDisplayMedia ok', {
          audioTracks: audioTracks.length,
          settings: audioTracks.map((tr) => tr.getSettings()),
        });
        if (audioTracks.length === 0) {
          display.getTracks().forEach((tr) => tr.stop());
          throw new DOMException('tab_audio_unavailable', 'NoAudioError');
        }
        const tabStream = new MediaStream(audioTracks);
        srcStreamRef.current.tab = tabStream;
        // Resample to 24 kHz mono — see prior comment block for the
        // three reasons (Chrome ignores constraints, OpenAI expects
        // 24 kHz mono, WebAudio clock normalisation).
        try {
          if (!AudioCtx) throw new Error('no AudioContext');
          const ctx = new AudioCtx({ sampleRate: 24000 });
          tabResampleCtxRef.current = ctx;
          if (ctx.state === 'suspended') {
            void ctx.resume().catch((err) => {
              console.warn('[translate] tab resample ctx.resume failed', err);
            });
          }
          const src = ctx.createMediaStreamSource(tabStream);
          const dst = ctx.createMediaStreamDestination();
          src.connect(dst);
          publishStreamRef.current.tab = dst.stream;
          console.info('[translate] tab resample graph wired', {
            ctxSampleRate: ctx.sampleRate,
            publishTracks: dst.stream.getAudioTracks().length,
          });
        } catch (err) {
          console.warn('[translate] tab resample failed, passing raw stream', err);
          publishStreamRef.current.tab = tabStream;
        }

        // Silence pulse — same rationale as before (tab audio has no
        // natural pauses; force VAD to commit turns).
        const track = tabStream.getAudioTracks()[0];
        if (track) {
          tabSilenceTimerRef.current = setInterval(() => {
            if (track.readyState !== 'live') return;
            track.enabled = false;
            setTimeout(() => {
              if (track.readyState === 'live') track.enabled = true;
            }, TAB_SILENCE_DURATION_MS);
          }, TAB_SILENCE_INTERVAL_MS);
        }
        return true;
      } catch (e) {
        const name = e instanceof DOMException ? e.name : '';
        console.warn('[translate] tab capture failed', { name, error: e });
        if (name === 'NoAudioError') {
          setSlotError((prev) => ({ ...prev, tab: 'tab_audio_unavailable' }));
        } else if (name === 'NotAllowedError') {
          setSlotError((prev) => ({ ...prev, tab: 'tab_audio_denied' }));
        } else {
          setSlotError((prev) => ({ ...prev, tab: 'tab_audio_failed' }));
        }
        return false;
      }
    };

    // Order: tab first so the picker pops before any silent
    // mic permission prompt the browser may queue. For `both` mode
    // both prompts must succeed (one auto-grant + one tab picker).
    let micAcquired = false;
    let tabAcquired = false;
    if (slotsToStart.includes('tab')) {
      tabAcquired = await acquireTabSlot();
    }
    if (slotsToStart.includes('mic')) {
      micAcquired = await acquireMicSlot();
    }

    // Determine which slots actually have audio. If ALL acquisitions
    // failed we abort with the most useful error per requested mode;
    // partial failure in `both` mode degrades gracefully to whichever
    // side succeeded.
    const liveSlots: SourceSlot[] = [];
    if (slotsToStart.includes('mic') && micAcquired) liveSlots.push('mic');
    if (slotsToStart.includes('tab') && tabAcquired) liveSlots.push('tab');
    if (liveSlots.length === 0) {
      if (captureModeAtStart === 'tab-only') {
        // setSlotError already pinned the precise failure; promote the
        // tab slot's error to the top-level error so the user sees it.
        setError('tab_audio_failed');
      } else if (captureModeAtStart === 'mic-only') {
        setError('microphone_denied');
      } else {
        setError('microphone_denied');
      }
      setStatus('error');
      cleanup('start_error_mic');
      startInFlightRef.current = false;
      return;
    }

    // 3) Shared output AudioContext (a single context for both slots'
    //    output mixing + the recording graph). Created up front so the
    //    LiveKit publish + recorder wiring can happen before either
    //    OpenAI session lands its first TTS track.
    let ctx: AudioContext | null = null;
    try {
      if (!AudioCtx) throw new Error('no AudioContext');
      ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      if (ctx.state === 'suspended') {
        void ctx.resume().catch((err) => {
          console.warn('[translate] audioCtx.resume failed', err);
        });
      }
    } catch (err) {
      console.warn('[translate] audioCtx construction failed', err);
      setError('webrtc_failed');
      setStatus('error');
      cleanup('start_error_webrtc');
      startInFlightRef.current = false;
      return;
    }

    // 4) Build the shared OUTPUT mixer destination (LiveKit publish)
    //    and the recording destinations. Both slots' TTS sources will
    //    plug in here as their ontrack events fire.
    audioDestRef.current = ctx.createMediaStreamDestination();
    inputMixDestRef.current = ctx.createMediaStreamDestination();

    // Recording is always on now (default save), so the only gate is
    // MediaRecorder support + a usable mime type.
    let mimeType: string | null = null;
    if (typeof MediaRecorder !== 'undefined') {
      mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = null;
    }
    if (mimeType) {
      try {
        recordInputDestRef.current = ctx.createMediaStreamDestination();
        recordOutputDestRef.current = ctx.createMediaStreamDestination();

        // Wire each live slot's source into the input mixer + the
        // input recorder destination.
        for (const slot of liveSlots) {
          const slotSrc = srcStreamRef.current[slot];
          if (!slotSrc) continue;
          const mixNode = ctx.createMediaStreamSource(slotSrc);
          inputMixSrcRef.current[slot] = mixNode;
          mixNode.connect(inputMixDestRef.current);
          const recNode = ctx.createMediaStreamSource(slotSrc);
          recordInputSrcRef.current[slot] = recNode;
          recNode.connect(recordInputDestRef.current);
        }

        const recIn = new MediaRecorder(recordInputDestRef.current.stream, { mimeType });
        const recOut = new MediaRecorder(recordOutputDestRef.current.stream, { mimeType });
        mediaRecorderInputRef.current = recIn;
        mediaRecorderOutputRef.current = recOut;
        recordedInputChunksRef.current = [];
        recordedOutputChunksRef.current = [];

        recIn.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) {
            recordedInputChunksRef.current.push(ev.data);
          }
        };
        recOut.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) {
            recordedOutputChunksRef.current.push(ev.data);
          }
        };
        const fail = () => {
          setRecordingError('recorder_failed');
          setRecorderActive(false);
        };
        recIn.onerror = fail;
        recOut.onerror = fail;
        recIn.onstart = () => setRecorderActive(true);
        recOut.onstart = () => setRecorderActive(true);
        const maybeIdle = () => {
          const a = mediaRecorderInputRef.current;
          const b = mediaRecorderOutputRef.current;
          if ((!a || a.state === 'inactive') && (!b || b.state === 'inactive')) {
            setRecorderActive(false);
          }
        };
        recIn.onstop = maybeIdle;
        recOut.onstop = maybeIdle;
        recIn.start(RECORDING_CHUNK_MS);
        recOut.start(RECORDING_CHUNK_MS);
        recordingStartedAtRef.current = Date.now();

        const sid = sessionIdRef.current;
        if (sid) {
          (async () => {
            // Pull the server's explicit error code + root-cause detail
            // out of a failed reserve so the banner can name the actual
            // cause (storage_unavailable / recording_create_failed / …)
            // instead of the generic "잠시 후 다시 시도" headline.
            const reserve = async (kind: 'output' | 'input') => {
              const res = await fetch(
                `/api/translate/sessions/${sid}/recording`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ kind }),
                },
              );
              if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as {
                  error?: string;
                  detail?: string;
                };
                setRecordingError('reserve_failed');
                setRecordingErrorDetail(
                  [body.error, body.detail].filter(Boolean).join(': ') || null,
                );
                throw new Error(body.error ?? 'reserve_failed');
              }
              return (await res.json()) as {
                recording_id: string;
                upload_url: string;
              };
            };
            try {
              const j1 = await reserve('output');
              recordingIdRef.current = j1.recording_id;
              recordingOutputUploadUrlRef.current = j1.upload_url;

              const j2 = await reserve('input');
              recordingIdRef.current = j2.recording_id;
              recordingInputUploadUrlRef.current = j2.upload_url;
            } catch {
              // Banner state already set inside reserve() on a non-OK
              // response. A network throw (fetch rejected) lands here with
              // no server detail — fall back to the generic headline.
              setRecordingError((prev) => prev ?? 'reserve_failed');
            }
          })();
        }
      } catch {
        setRecordingError('recorder_failed');
      }
    }

    // 5) LiveKit connect + publish ONE 'input' track (mixed across
    //    live slots). The translated 'output' publish lands later when
    //    the first slot's ontrack fires — same as the legacy single
    //    pipeline, just gated against the shared mixer.
    outputPublishedRef.current = false;
    inputPublishedRef.current = false;
    console.info('[translate] connecting livekit');
    try {
      const room = new Room({ adaptiveStream: true, dynacast: true });
      await room.connect(bundle.livekit.url, bundle.livekit.token);
      roomRef.current = room;
      const inputDest = inputMixDestRef.current;
      // In single-mode the input mixer has the one slot wired below by
      // the per-slot setup loop. We may have already wired the recorder
      // graph; the LiveKit publish mirror happens here.
      if (inputDest) {
        for (const slot of liveSlots) {
          // Avoid duplicate mixer wiring: if the recorder loop already
          // attached an inputMixSrc for this slot we skip; otherwise
          // (e.g. recording off) attach now.
          if (inputMixSrcRef.current[slot]) continue;
          const slotSrc = srcStreamRef.current[slot];
          if (!slotSrc) continue;
          const node = ctx.createMediaStreamSource(slotSrc);
          inputMixSrcRef.current[slot] = node;
          node.connect(inputDest);
        }
        const mixedInputTrack = inputDest.stream.getAudioTracks()[0];
        if (mixedInputTrack) {
          const lkTrack = new LocalAudioTrack(mixedInputTrack);
          await room.localParticipant.publishTrack(lkTrack, { name: 'input' });
          inputPublishedRef.current = true;
          console.info('[translate] livekit input published (mixed)', {
            liveSlots,
          });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'livekit_failed');
      setStatus('error');
      cleanup('start_error_livekit');
      startInFlightRef.current = false;
      return;
    }

    // 6) Per-slot OpenAI Realtime pipeline. Each slot gets its own
    //    RTCPeerConnection + data channel + ephemeral client_secret.
    //    The FIRST slot reuses `bundle.openai.client_secret`; the
    //    SECOND (in `both` mode) hits POST /sessions/[id]/ephemeral to
    //    issue a fresh one.
    const startSlot = async (
      slot: SourceSlot,
      clientSecret: string,
    ): Promise<boolean> => {
      const publishStream = publishStreamRef.current[slot];
      if (!publishStream) return false;
      try {
        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
          ],
        });
        pc.onsignalingstatechange = () => {
          console.info(`[translate:${slot}] pc.signalingState`, pc.signalingState);
        };
        pc.onconnectionstatechange = () => {
          console.info(
            `[translate:${slot}] pc.connectionState`,
            pc.connectionState,
            'at',
            Math.round(performance.now()),
          );
          if (pc.connectionState === 'connected') {
            setSlotActive((prev) => ({ ...prev, [slot]: true }));
          } else if (
            pc.connectionState === 'failed' ||
            pc.connectionState === 'disconnected' ||
            pc.connectionState === 'closed'
          ) {
            setSlotActive((prev) => ({ ...prev, [slot]: false }));
          }
        };
        pc.oniceconnectionstatechange = () => {
          console.info(`[translate:${slot}] pc.iceConnectionState`, pc.iceConnectionState);
        };
        pc.onicegatheringstatechange = () => {
          console.info(`[translate:${slot}] pc.iceGatheringState`, pc.iceGatheringState);
        };
        pc.onicecandidate = (e) => {
          console.info(`[translate:${slot}] ice-candidate`, {
            type: e.candidate?.type ?? 'end-of-candidates',
            protocol: e.candidate?.protocol ?? null,
          });
        };
        pcRef.current[slot] = pc;
        publishStream.getAudioTracks().forEach((tr) => pc.addTrack(tr, publishStream));
        // 🚨 Phase 1 diagnostic (pr-translate-tts-playback-hardening):
        // confirm whether OpenAI publishes a TTS audio track at all. This is
        // a SEPARATE listener that coexists with the `pc.ontrack =` handler
        // below — both fire. If this never logs, the server isn't sending a
        // track (SDP / session-config issue, not fixable client-side); if it
        // logs `kind: 'audio'` but the host still hears nothing, the failure
        // is client-side attach / autoplay (Layers A / C).
        let trackEverFired = false;
        pc.addEventListener('track', (e) => {
          trackEverFired = true;
          // Inline string (not an object) so it's readable in the console
          // without expanding — the collapsed Object logs hid this.
          console.info(
            `[translate:${slot}] pc.ontrack fired — kind=${e.track?.kind} stream=${e.streams[0]?.id ?? 'none'} readyState=${e.track?.readyState}`,
          );
        });
        // 🚨 Phase 1 diagnostic: 5 s after setup, dump each transceiver's
        // negotiated direction as an INLINE STRING + an explicit "no track"
        // warning. `pc.ontrack` never firing combined with a 'sendonly' /
        // 'inactive' currentDirection means OpenAI negotiated no receive
        // path server-side (translation TEXT still flows over the data
        // channel) — distinguishing that from a client-side attach bug.
        setTimeout(() => {
          if (pcRef.current[slot] !== pc) return;
          const dirs = pc
            .getTransceivers()
            .map(
              (tr, i) =>
                `[${i}] dir=${tr.direction} cur=${tr.currentDirection ?? 'null'} recv=${tr.receiver?.track?.kind ?? 'none'}`,
            )
            .join(' | ');
          console.info(`[translate:${slot}] transceivers @5s: ${dirs || 'none'}`);
          if (!trackEverFired) {
            console.warn(
              `[translate:${slot}] ⚠ NO TTS track after 5s — OpenAI returned no return-audio. Translation TEXT works (datachannel) but no audio m-line was negotiated for translated speech.`,
            );
          }
        }, 5000);
        pc.ontrack = (e) => {
          const stream = e.streams[0];
          if (!stream) return;
          ttsStreamRef.current[slot] = stream;
          // First slot to deliver a TTS stream attaches it to the
          // local monitor; later slots also mix into the monitor via
          // the shared audioDest (which both feed). Keeping the
          // monitor's <audio> srcObject pinned to the LATEST TTS is
          // fine — the audible mix users hear comes from the
          // monitor's audio sink, which is driven by the shared
          // output mixer below.
          // Attach the RAW remote TTS stream to THIS slot's monitor element
          // (the OpenAI guide pattern: `audioEl.srcObject = e.streams[0]`).
          // It plays through the browser's native pipeline regardless of
          // AudioContext state — fixing the "monitor playing but silent"
          // case. Pumping the remote track via a media element is ALSO what
          // makes the WebAudio mixer below (LiveKit publish + recording)
          // carry audio on Chrome: a remote track fed only into
          // createMediaStreamSource yields silence (crbug/121673).
          // Re-attach on every arrival (renegotiation / re-entry safe).
          const el = monitorAudioRefs.current[slot];
          if (el) {
            if (el.srcObject !== stream) el.srcObject = stream;
            el.muted = !outputAudible;
            // Layer A: surface autoplay rejection instead of swallowing it.
            el.play()
              .then(() => setTtsBlocked(false))
              .catch((err) => {
                console.warn(`[translate:${slot}] TTS autoplay rejected`, err);
                setTtsBlocked(true);
              });
          }
          // Wire the slot's TTS into the shared mixers (output publish
          // dest + recording dest). Guard against double-wiring on
          // renegotiation.
          if (!ctx) return;
          const mix = audioDestRef.current;
          if (mix && !audioSourceRef.current[slot]) {
            try {
              const node = ctx.createMediaStreamSource(stream);
              audioSourceRef.current[slot] = node;
              node.connect(mix);
            } catch (err) {
              console.warn(`[translate:${slot}] output mix wire failed`, err);
            }
          }
          const recOutDest = recordOutputDestRef.current;
          if (recOutDest && !recordOutputSrcRef.current[slot]) {
            try {
              const node = ctx.createMediaStreamSource(stream);
              recordOutputSrcRef.current[slot] = node;
              node.connect(recOutDest);
            } catch (err) {
              console.warn(`[translate:${slot}] output rec wire failed`, err);
            }
          }
          // First successful TTS publishes the LiveKit 'output' track.
          if (outputPublishedRef.current) return;
          const room = roomRef.current;
          const mixedTrack = mix?.stream.getAudioTracks()[0];
          if (!room || !mixedTrack) return;
          try {
            outputPublishedRef.current = true;
            const outputTrack = new LocalAudioTrack(mixedTrack);
            console.info(`[translate:${slot}] publishing mixed output`, {
              ctxState: ctx.state,
              trackEnabled: mixedTrack.enabled,
              trackReadyState: mixedTrack.readyState,
              trackMuted: mixedTrack.muted,
            });
            room.localParticipant
              .publishTrack(outputTrack, { name: 'output' })
              .then(() => {
                console.info(`[translate:${slot}] mixed output PUBLISHED`);
              })
              .catch((err) => {
                console.warn(`[translate:${slot}] output publish FAILED`, err);
                outputPublishedRef.current = false;
              });
          } catch {
            outputPublishedRef.current = false;
          }
        };
        const dc = pc.createDataChannel('oai-events');
        dcRef.current[slot] = dc;
        dc.onmessage = (ev) => {
          const text = decodeDataChannelMessage(ev.data);
          if (text === null) {
            console.warn(`[translate:${slot}] dc payload dropped — unsupported type`);
            return;
          }
          handleOaiEvent(slot, text);
        };
        dc.onopen = () => console.info(`[translate:${slot}] dc open`);
        dc.onclose = () => console.info(`[translate:${slot}] dc close`);
        dc.onerror = (ev) => console.warn(`[translate:${slot}] dc error`, ev);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.info(`[translate:${slot}] sdp offer ready, posting to openai`);
        const sdpRes = await fetch(
          'https://api.openai.com/v1/realtime/translations/calls',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${clientSecret}`,
              'Content-Type': 'application/sdp',
            },
            body: offer.sdp ?? '',
          },
        );
        console.info(`[translate:${slot}] sdp response`, { status: sdpRes.status });
        if (!sdpRes.ok) {
          const body = await sdpRes.text().catch(() => '');
          console.warn(`[translate:${slot}] sdp error body`, body.slice(0, 500));
          throw new Error(`openai_sdp_${sdpRes.status}`);
        }
        const answerSdp = await sdpRes.text();
        // 🚨 Phase 1 diagnostic: summarize the negotiated audio direction(s)
        // inline. `summarizeAudioMlines` extracts each m=audio section's
        // a=sendrecv/sendonly/recvonly/inactive. If the OFFER has a recv
        // lane (sendrecv) but the ANSWER comes back sendonly / has no second
        // audio m-line, OpenAI declined to return translated speech — the
        // root cause of "발화 0" with working captions.
        console.info(
          `[translate:${slot}] sdp audio dirs — offer=[${summarizeAudioMlines(offer.sdp ?? '')}] answer=[${summarizeAudioMlines(answerSdp)}]`,
        );
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
        console.info(`[translate:${slot}] sdp answer applied`);
        return true;
      } catch (e) {
        console.warn(`[translate:${slot}] slot start failed`, e);
        setSlotError((prev) => ({
          ...prev,
          [slot]: e instanceof Error ? e.message : 'slot_failed',
        }));
        // Best-effort tear down for just this slot.
        try {
          dcRef.current[slot]?.close();
        } catch {}
        dcRef.current[slot] = null;
        try {
          pcRef.current[slot]?.close();
        } catch {}
        pcRef.current[slot] = null;
        return false;
      }
    };

    // Hand out the ephemerals. liveSlots[0] reuses the bundle's
    // ephemeral; liveSlots[1] (if present) issues a fresh one via the
    // re-issue endpoint.
    const ephemeralForSlot: Record<SourceSlot, string | null> = emptySlotRecord(null);
    ephemeralForSlot[liveSlots[0]] = bundle.openai.client_secret.value;
    if (liveSlots.length > 1) {
      try {
        const second = await fetch(
          `/api/translate/sessions/${bundle.session.id}/ephemeral`,
          { method: 'POST' },
        );
        if (!second.ok) throw new Error('ephemeral_failed');
        const sj = (await second.json()) as {
          openai: { client_secret: { value: string } };
        };
        ephemeralForSlot[liveSlots[1]] = sj.openai.client_secret.value;
      } catch (e) {
        console.warn('[translate] second ephemeral failed — degrading to single slot', e);
        setSlotError((prev) => ({
          ...prev,
          [liveSlots[1]]: 'ephemeral_failed',
        }));
      }
    }

    // Fire per-slot pipelines in parallel. Each Promise resolves a
    // boolean (true = up, false = failed). At least one must succeed
    // for the session to flip to 'live'.
    const slotResults = await Promise.all(
      liveSlots.map(async (slot) => {
        const cs = ephemeralForSlot[slot];
        if (!cs) return false;
        return startSlot(slot, cs);
      }),
    );
    const anySlotUp = slotResults.some((ok) => ok);
    if (!anySlotUp) {
      setError('webrtc_failed');
      setStatus('error');
      cleanup('start_error_webrtc');
      startInFlightRef.current = false;
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

    // Connect succeeded — disarm the watchdog before flipping live.
    if (connectWatchdogRef.current) {
      clearTimeout(connectWatchdogRef.current);
      connectWatchdogRef.current = null;
    }
    startedAtRef.current = Date.now();
    setStatus('live');
    startInFlightRef.current = false;
  }, [
    captureMode,
    cleanup,
    handleOaiEvent,
    outputAudible,
    sourceLang,
    targetLang,
    glossary,
    status,
    transcriptPublisher,
    notifyDeduction,
  ]);

  // Stop one MediaRecorder cleanly and wait for the final dataavailable
  // tick. Returns the assembled Blob, or null if no chunks were recorded.
  const finalizeOneRecorder = useCallback(
    async (
      rec: MediaRecorder | null,
      chunks: Blob[],
    ): Promise<{ blob: Blob; durationSec: number } | null> => {
      if (!rec) return null;
      if (rec.state === 'inactive') {
        if (chunks.length === 0) return null;
      } else {
        await new Promise<void>((resolve) => {
          const done = () => {
            rec.removeEventListener('stop', done);
            resolve();
          };
          rec.addEventListener('stop', done);
          try {
            rec.stop();
          } catch {
            resolve();
          }
        });
      }
      if (chunks.length === 0) return null;
      const mimeType = chunks[0]?.type || 'audio/webm';
      const blob = new Blob(chunks, { type: mimeType });
      const start = recordingStartedAtRef.current ?? Date.now();
      const durationSec = Math.max(0, Math.round((Date.now() - start) / 1000));
      return { blob, durationSec };
    },
    [],
  );

  const uploadAndFinalizeRecording = useCallback(
    async (sessionId: string) => {
      // Stop and finalize both recorders in parallel — they share a
      // common start timestamp and the AudioContext is about to be
      // closed in cleanup(), so any delay here would clip the tail.
      const [inputFinal, outputFinal] = await Promise.all([
        finalizeOneRecorder(
          mediaRecorderInputRef.current,
          recordedInputChunksRef.current,
        ),
        finalizeOneRecorder(
          mediaRecorderOutputRef.current,
          recordedOutputChunksRef.current,
        ),
      ]);
      if (!inputFinal && !outputFinal) return;

      const recordingId = recordingIdRef.current;
      if (!recordingId) {
        setRecordingError('reserve_failed');
        return;
      }

      // Upload each track to its own signed URL, then PATCH (one PATCH
      // per track — server-side merges sizes and keeps the longer of
      // the two durations). Either side missing → recorder for that
      // side never ran; just skip it. The row still ends up
      // status='uploaded' so the unlock CTA appears.
      const tracks: Array<{
        label: 'input' | 'output';
        uploadUrl: string | null;
        finalized: { blob: Blob; durationSec: number } | null;
      }> = [
        {
          label: 'input',
          uploadUrl: recordingInputUploadUrlRef.current,
          finalized: inputFinal,
        },
        {
          label: 'output',
          uploadUrl: recordingOutputUploadUrlRef.current,
          finalized: outputFinal,
        },
      ];

      for (const t of tracks) {
        if (!t.finalized) continue;
        if (!t.uploadUrl) {
          setRecordingError('reserve_failed');
          continue;
        }
        try {
          const put = await fetch(t.uploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': t.finalized.blob.type || 'audio/webm',
            },
            body: t.finalized.blob,
          });
          if (!put.ok) {
            setRecordingError('upload_failed');
            continue;
          }
        } catch {
          setRecordingError('upload_failed');
          continue;
        }
        try {
          const patch = await fetch(
            `/api/translate/sessions/${sessionId}/recording`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                recording_id: recordingId,
                size_bytes: t.finalized.blob.size,
                duration_sec: t.finalized.durationSec,
              }),
            },
          );
          if (!patch.ok) {
            setRecordingError('finalize_failed');
          }
        } catch {
          setRecordingError('finalize_failed');
        }
      }

      try {
        // Re-read the row so the post-session CTA renders with the
        // canonical server state (status='uploaded').
        const get = await fetch(
          `/api/translate/sessions/${sessionId}/recording`,
        );
        if (get.ok) {
          const json = (await get.json()) as { recording: RecordingRow | null };
          setRecording(json.recording ?? null);
        }
      } catch {
        // The recording row exists; the CTA reload-from-mount path will
        // pick it up next time. No need to surface a separate error.
      }
    },
    [finalizeOneRecorder],
  );

  const stop = useCallback(async () => {
    if (status === 'idle' || status === 'ended') return;
    setStatus('ending');

    // Flush any in-flight rolling chunks so the recorded transcript
    // doesn't lose the tail of the conversation. Flush per slot —
    // each side carries its own partial.
    for (const slot of ['mic', 'tab'] as const) {
      const speaker = SLOT_SPEAKER[slot];
      for (const [kind, bag, lang] of [
        ['input', partialInputRef, sourceLang] as const,
        ['output', partialOutputRef, targetLang] as const,
      ]) {
        const current = bag.current[slot];
        if (current && current.text.trim()) {
          const finalLine: CaptionLine = {
            id: current.id,
            text: current.text.trim(),
            final: true,
            ts: Date.now(),
            speaker,
          };
          pushLine(kind, finalLine);
          broadcastCaption(kind, finalLine, lang);
          void persistMessage(kind, current.text.trim(), lang, speaker);
        }
      }
    }

    // Ask each OpenAI session to close the translation gracefully.
    for (const slot of ['mic', 'tab'] as const) {
      try {
        dcRef.current[slot]?.send(JSON.stringify({ type: 'session.close' }));
      } catch {}
    }

    const id = sessionIdRef.current;

    // Finalize the recorder BEFORE cleanup — cleanup nukes the chunk
    // buffer and the MediaRecorder ref.
    if (id) {
      try {
        await uploadAndFinalizeRecording(id);
      } catch {
        // The function already surfaces errors via setRecordingError.
      }
    }

    cleanup('stop');
    sessionIdRef.current = null;
    startedAtRef.current = null;
    if (id) {
      try {
        await fetch(`/api/translate/sessions/${id}/end`, { method: 'POST' });
      } catch {}
    }

    // Fidelity report. Compare delta chars surfaced by the data channel
    // against the chars we POSTed to /messages. A drift above the
    // threshold means dedup or sentence-boundary slicing dropped real
    // content — the host's transcript will be missing words. We always
    // log a one-line summary so prod sessions leave a paper trail, and
    // POST a `__loss_report__` payload to the same /messages endpoint so
    // the server can audit the loss without a second route.
    for (const channel of ['input', 'output'] as const) {
      const c = fidelityCountersRef.current[channel];
      const ratio = lossRatio(c.deltaChars, c.commitChars);
      const summary = {
        channel,
        deltaChars: c.deltaChars,
        commitChars: c.commitChars,
        persistOk: c.persistOk,
        persistFail: c.persistFail,
        droppedFffd: c.droppedFffd,
        // 🚨 truncation investigation — per-reason drop attribution +
        // turn-silence early-commit signals. Stored in the loss report so
        // root cause can be read off audit_log without a live console.
        fuzzyDrops: c.fuzzyDrops,
        containmentDrops: c.containmentDrops,
        lcsDrops: c.lcsDrops,
        droppedChars: c.droppedChars,
        turnSilenceCommits: c.turnSilenceCommits,
        midSentenceCommits: c.midSentenceCommits,
        lossRatio: ratio,
      };
      // Report on any diagnostic signal, not just threshold breach — a
      // session under the 5% loss bar can still reveal which heuristic is
      // dropping content or whether turn-silence is chopping sentences.
      const hasDiagnosticSignal =
        c.droppedChars > 0 || c.midSentenceCommits > 0;
      if (
        ratio > FIDELITY_LOSS_THRESHOLD ||
        c.persistFail > 0 ||
        c.droppedFffd > 0 ||
        hasDiagnosticSignal
      ) {
        console.warn('[translate] fidelity loss', summary);
        if (id) {
          void fetch(`/api/translate/sessions/${id}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ kind: '__loss_report__', ...summary }),
          }).catch(() => {});
        }
      } else if (TRACE_ENCODING) {
        console.info('[translate] fidelity ok', summary);
      }
    }

    setShareToken(null);
    setShareCopied(false);
    setStatus('ended');
  }, [
    broadcastCaption,
    cleanup,
    persistMessage,
    pushLine,
    sourceLang,
    status,
    targetLang,
    uploadAndFinalizeRecording,
  ]);

  // Stop on unmount.
  useEffect(() => {
    return () => {
      cleanup('unmount');
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

  // Trigger a download for one of the five formats. All stream directly
  // from the API route — m4a-output is transcoded on demand from the
  // persisted webm; zip-output/zip-revised bundle a kind-filtered
  // transcript (.txt + .docx) rendered from translate_messages. Source
  // formats (m4a-input/zip-input) are no longer offered (see the
  // downloadingFormat comment) so they're absent from this union.
  const downloadFormat = useCallback(
    async (
      format:
        | 'm4a-output'
        | 'zip-output'
        | 'zip-revised',
    ) => {
      if (!recording || downloadingFormat) return;
      // Downloadable once the recording is finalized. 'uploaded' is the
      // normal terminal state under default-save (no separate unlock);
      // 'unlocked' is still accepted for rows from the old paid scheme.
      if (recording.status !== 'uploaded' && recording.status !== 'unlocked')
        return;
      setDownloadingFormat(format);
      try {
        const res = await fetch(
          `/api/translate/recordings/${recording.id}/download?format=${format}`,
          {
            headers: {
              // Locale hint for the transcript renderers — the route
              // handler reads `x-app-locale` and falls back to ko.
              'x-app-locale': locale,
            },
          },
        );
        if (!res.ok) {
          // Surface the specific server-side error code so the panel
          // can render `input_audio_unavailable` distinctly from a
          // generic network failure (legacy rows have no input track).
          // When the body is HTML (e.g. a platform-level 404 page from
          // a misrouted CDN edge) we fall back to a status-derived
          // code so the toast still localizes to a useful sentence.
          let code: string | null = null;
          try {
            const j = (await res.json()) as { error?: string };
            if (j.error) code = j.error;
          } catch {}
          if (!code) {
            if (res.status === 402) code = 'locked';
            else if (res.status === 403) code = 'forbidden';
            else if (res.status === 404) code = 'not_found';
            else if (res.status === 410) code = 'object_missing';
            else code = 'download_failed';
          }
          setRecordingError(code);
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download =
          format === 'm4a-output'
            ? `translate-${recording.id}-output.m4a`
            : format === 'zip-output'
              ? `translate-${recording.id}-output.zip`
              : `translate-${recording.id}-revised.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch {
        setRecordingError('download_failed');
      } finally {
        setDownloadingFormat(null);
      }
    },
    [downloadingFormat, locale, recording],
  );

  // PR-T3 — trigger a post-hoc batch re-translation of the source
  // transcript. Server charges REVISE_CREDITS and flips the session's
  // revision_status to 'pending'; we then poll the GET endpoint until
  // it reaches 'done' or 'failed'. The button is hidden until the
  // session has 'ended' AND the host enabled recording (no input rows
  // exist otherwise).
  const triggerRevision = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id || revisionTriggering) return;
    if (revisionStatus === 'pending' || revisionStatus === 'done') return;
    setRevisionTriggering(true);
    setRevisionError(null);
    try {
      const res = await fetch(`/api/translate/sessions/${id}/revise`, {
        method: 'POST',
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        already_revised?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setRevisionError(json.error ?? 'revision_trigger_failed');
        return;
      }
      // The POST is synchronous server-side (blocks until 'done' or
      // 'failed'), so we can flip the local status straight to the
      // final state. The polling effect still picks up failed runs
      // because we set 'pending' below as a defense-in-depth — if the
      // POST surface ever becomes async, the panel keeps working.
      if (json.already_revised) {
        setRevisionStatus('done');
      } else {
        setRevisionStatus('done');
      }
    } catch {
      setRevisionError('revision_trigger_failed');
    } finally {
      setRevisionTriggering(false);
    }
  }, [revisionStatus, revisionTriggering]);

  // Hydrate revision status from the server once the session ends. This
  // covers the rare race where /revise was triggered by another tab /
  // request and the local state didn't see it. Also picks up the
  // server-side 'failed' status if the LLM call errors out after we
  // set 'pending' optimistically.
  useEffect(() => {
    if (status !== 'ended') return;
    const id = sessionIdRef.current;
    if (!id) return;
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/translate/sessions/${id}/revise`);
        if (!res.ok) return;
        const j = (await res.json()) as {
          revision_status: RevisionStatus;
          revision_error: string | null;
        };
        if (cancelled) return;
        setRevisionStatus(j.revision_status);
        if (j.revision_error) setRevisionError(j.revision_error);
      } catch {
        // best-effort — the button still works
      }
    };
    void fetchStatus();
    return () => {
      cancelled = true;
    };
  }, [status]);

  // While the server reports 'pending', re-poll on a short cadence so
  // the spinner flips to "done" within REVISE_POLL_MS of the LLM
  // finishing. We only poll in this narrow window — once 'done' or
  // 'failed', the status is terminal.
  useEffect(() => {
    if (revisionStatus !== 'pending') return;
    const id = sessionIdRef.current;
    if (!id) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/translate/sessions/${id}/revise`);
        if (!res.ok) return;
        const j = (await res.json()) as {
          revision_status: RevisionStatus;
          revision_error: string | null;
        };
        if (cancelled) return;
        setRevisionStatus(j.revision_status);
        if (j.revision_error) setRevisionError(j.revision_error);
      } catch {
        // best-effort
      }
    };
    const handle = setInterval(() => void tick(), REVISE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [revisionStatus]);

  // Build the viewer URL the host shows / copies. When a viewer subdomain
  // is configured (e.g. `live.research-canvas.io`) we use it; otherwise we
  // fall back to the same origin with a `/live/<token>` path.
  const shareUrl = useMemo(() => {
    if (!shareToken) return null;
    if (typeof window === 'undefined') return null;
    const subdomain = env.NEXT_PUBLIC_TRANSLATE_VIEWER_HOST;
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
  // Display-only rolling window. We keep every line in `outputLines`
  // state for the eventual "download full transcript" feature (PR-B),
  // but only render the last 30 seconds on the prompter so the screen
  // stays light and the active line stays in the visual center.
  const promptedLines = useMemo(
    () =>
      outputLines
        .filter((l) => now - l.ts <= PROMPTER_WINDOW_MS)
        // Both source slots push to the same outputLines array, but
        // async commit order can scramble two near-simultaneous turns
        // (host(ts=1500) lands before guest(ts=1000) just because
        // host's pipeline raced first). Sort by ts so the prompter
        // reads in actual wall-clock speaking order in `both` mode.
        // A tie-breaker on id keeps the order deterministic within
        // the same millisecond.
        .slice()
        .sort((a, b) => (a.ts === b.ts ? a.id.localeCompare(b.id) : a.ts - b.ts)),
    [outputLines, now],
  );

  return (
    <div className="space-y-4">
      {/* WidgetSubHeader — settings (captureMode / sourceLang / targetLang)
          / actions (timer / live indicators / monitor mute / share /
          start-stop CTA). 저장은 항상 ON (default save) 이라 options 슬롯
          (옛 저장 체크박스) 없음. 3 위젯 공통 primitive. */}
      <WidgetSubHeader
        className="-mx-5 -mt-5"
        inputs={
          /* 2 컬럼 grid: 좌 = captureMode(위) + sourceLang/targetLang(아래
             수평) stack, 우 = glossary chips. 사용자 요청 (2026-06-30) 으로
             캡처방식/원어/번역언어 라벨·안내문 전부 제거 — visual label 0,
             a11y 는 select 의 aria-label 로 보장. glossary 라벨만 유지. */
          <div className="grid w-full grid-cols-1 gap-3 md:grid-cols-2">
            {/* 좌측 컬럼: captureMode → sourceLang/targetLang */}
            <div className="flex min-w-0 flex-col gap-3">
              {/* 1번 = 입력 소스 (captureMode). 라벨/안내문 제거. */}
              <select
                value={captureMode}
                onChange={(e) => setCaptureMode(e.target.value as CaptureMode)}
                disabled={live || busy}
                aria-label={t('captureMode.label')}
                className="h-8 w-fit rounded-xs border border-line bg-paper px-2 text-md text-ink"
              >
                <option value="both">{t('captureMode.both')}</option>
                <option value="mic-only">{t('captureMode.micOnly')}</option>
                <option value="tab-only">{t('captureMode.tabOnly')}</option>
              </select>
              {/* 2번 = 언어 (translate 전용). source / target 수평 stack. */}
              <div className="flex flex-wrap gap-3">
                <select
                  value={sourceLang}
                  onChange={(e) => setSourceLang(e.target.value)}
                  disabled={live || busy}
                  aria-label={t('sourceLang')}
                  className="h-8 rounded-xs border border-line bg-paper px-2 text-md text-ink"
                >
                  {langOptions.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <select
                  value={targetLang}
                  onChange={(e) => setTargetLang(e.target.value)}
                  disabled={live || busy}
                  aria-label={t('targetLang')}
                  className="h-8 rounded-xs border border-line bg-paper px-2 text-md text-ink"
                >
                  {langOptions.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 우측 컬럼: glossary (Layer B). 세션 시작 전에만 입력 —
                live/busy 시 잠금. 라벨 "고유 용어/맥락 주입" 만 노출, hint
                제거. 인명/도구명/약어의 정규 표기를 Enter 로 chip 추가. */}
            <div className="flex min-w-0 flex-col">
              <Field label={t('glossary.label')}>
                <GlossaryField
                  values={glossary}
                  onChange={setGlossary}
                  disabled={live || busy}
                  placeholderEmpty={t('glossary.placeholderEmpty')}
                  placeholderAdd={t('glossary.placeholderAdd')}
                  removeAria={t('glossary.removeAria')}
                />
              </Field>
            </div>
          </div>
        }
        actions={
          <div className="flex flex-col items-end gap-2">
            {/* Row 1: elapsed clock + share + start/stop. The status /
                slot-indicator / recording pills were removed here as visual
                noise — the underlying live/status/slotActive/recorderActive
                state still drives behavior, just no longer rendered inline. */}
            <div className="flex items-center gap-2">
              <span className="text-md tabular-nums text-mute">
                {live ? formatElapsed(elapsed) : '00:00'}
              </span>
              {live ? (
                <>
                  {!shareToken ? (
                    <ChromeButton
                      size="lg"
                      onClick={() => void generateShare()}
                      disabled={sharing}
                    >
                      {sharing ? t('share.creating') : t('share.create')}
                    </ChromeButton>
                  ) : null}
                  <ChromeButton
                    size="lg"
                    onClick={() => void stop()}
                  >
                    {t('stop')}
                  </ChromeButton>
                </>
              ) : (
                <ChromeButton
                  variant="primary"
                  size="lg"
                  onClick={() => void start()}
                  disabled={busy}
                >
                  {busy ? t('starting') : t('start')}
                </ChromeButton>
              )}
            </div>
            {/* Row 2: voice on/off, moved below the start/stop button.
                Layer B: explicit ON/OFF label, not an icon alone — the
                icon-only toggle gave no hint that OFF was a click away from
                restoring sound, so a host who'd toggled it off read the
                silence as the TTS being broken. */}
            <ChromeButton
              size="lg"
              onClick={() => setOutputAudible((v) => !v)}
              aria-pressed={outputAudible}
              leftIcon={outputAudible ? <SpeakerOnIcon /> : <SpeakerOffIcon />}
              aria-label={outputAudible ? t('monitorMute.muteAria') : t('monitorMute.unmuteAria')}
              title={outputAudible ? t('monitorMute.muteAria') : t('monitorMute.unmuteAria')}
            >
              {outputAudible ? t('monitorMute.on') : t('monitorMute.off')}
            </ChromeButton>
          </div>
        }
      />

      {/* Layer A: autoplay-blocked banner. Placed at the top of the widget
          (most visible spot) so the host immediately sees why the monitor
          is silent and can restore it with one click. Viewers are
          unaffected — this is the host's local monitor only. */}
      {ttsBlocked ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xs border border-amore bg-paper px-3 py-2 text-md text-ink">
          <span className="text-amore">{t('ttsBlocked.notice')}</span>
          <ChromeButton
            variant="primary"
            size="md"
            onClick={() => void enableTtsPlayback()}
          >
            {t('ttsBlocked.enable')}
          </ChromeButton>
        </div>
      ) : null}

      {shareToken && shareUrl ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xs border border-line bg-paper px-3 py-2 text-md text-ink">
          <span className="text-mute-soft">{t('share.label')}</span>
          <ChromeInput
            readOnly
            value={shareUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-[260px] flex-1 !border-line-soft !text-ink font-mono"
          />
          <ChromeButton
            size="md"
            onClick={() => void copyShareUrl()}
          >
            {shareCopied ? t('share.copied') : t('share.copy')}
          </ChromeButton>
          <ChromeButton
            variant="mute"
            size="md"
            onClick={() => void revokeShare()}
            disabled={sharing}
          >
            {t('share.revoke')}
          </ChromeButton>
          <span className="text-sm text-mute-soft">{t('share.expiresIn4h')}</span>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xs border border-line bg-paper px-3 py-2 text-md text-mute">
          {t('errorPrefix')} {t.has(`errors.${error}`) ? t(`errors.${error}`) : error}
        </div>
      ) : null}

      {live && (slotError.mic || slotError.tab) ? (
        <div className="rounded-xs border border-line bg-paper px-3 py-2 text-sm text-mute">
          {slotError.mic ? (
            <div>
              {t('slotIndicator.degradedHost')} {' '}
              {t.has(`errors.${slotError.mic}`)
                ? t(`errors.${slotError.mic}`)
                : slotError.mic}
            </div>
          ) : null}
          {slotError.tab ? (
            <div>
              {t('slotIndicator.degradedGuest')} {' '}
              {t.has(`errors.${slotError.tab}`)
                ? t(`errors.${slotError.tab}`)
                : slotError.tab}
            </div>
          ) : null}
        </div>
      ) : null}

      <PrompterPane lines={promptedLines} empty={t('prompter.empty')} />

      {status === 'ended' || (recording && status !== 'live') ? (
        <RecordingDownloadPanel
          sessionId={sessionIdRef.current}
          recording={recording}
          recordingError={recordingError}
          recordingErrorDetail={recordingErrorDetail}
          downloadingFormat={downloadingFormat}
          onDownload={(f) => void downloadFormat(f)}
          revisionStatus={revisionStatus}
          revisionError={revisionError}
          revisionTriggering={revisionTriggering}
          onRevise={() => void triggerRevision()}
        />
      ) : null}

      {/* Per-slot monitor sinks — each slot's raw TTS stream is attached
          directly (see monitorAudioRefs). Hidden; audible unless the host
          mutes via the toggle. Two elements so `both` mode plays host +
          guest at once. */}
      <audio
        ref={(el) => {
          monitorAudioRefs.current.mic = el;
        }}
        autoPlay
        playsInline
        className="hidden"
      />
      <audio
        ref={(el) => {
          monitorAudioRefs.current.tab = el;
        }}
        autoPlay
        playsInline
        className="hidden"
      />
    </div>
  );
}

function RecordingDownloadPanel({
  sessionId,
  recording,
  recordingError,
  recordingErrorDetail,
  downloadingFormat,
  onDownload,
  revisionStatus,
  revisionError,
  revisionTriggering,
  onRevise,
}: {
  sessionId: string | null;
  recording: RecordingRow | null;
  recordingError: string | null;
  recordingErrorDetail: string | null;
  downloadingFormat:
    | 'm4a-output'
    | 'zip-output'
    | 'zip-revised'
    | null;
  onDownload: (
    f:
      | 'm4a-output'
      | 'zip-output'
      | 'zip-revised',
  ) => void;
  revisionStatus: 'idle' | 'pending' | 'done' | 'failed' | null;
  revisionError: string | null;
  revisionTriggering: boolean;
  onRevise: () => void;
}) {
  const t = useTranslations('TranslateConsole');
  // While the recording is still finalizing (upload in-flight) the row
  // status is 'recording'. Treat as "preparing" rather than rendering a
  // half-broken panel. Once 'uploaded' the deliverables are downloadable
  // for free (the 75-credit start lump already paid for save+download);
  // 'unlocked' is still accepted for rows charged under the old scheme.
  const ready =
    recording && (recording.status === 'uploaded' || recording.status === 'unlocked');
  // PR-T3 — revise button visibility. The post-hoc batch translation
  // needs the source transcript (kind='input' rows), which are only
  // persisted when the host enabled recording for the session. The
  // panel only mounts after `status === 'ended'`, so as soon as we
  // have a recording row at all, /revise can be triggered. Hide the
  // section entirely while the first hydration poll is still in
  // flight so a stale "재번역" CTA doesn't flicker.
  const showRevise = recording !== null && revisionStatus !== null;
  const revisionPending = revisionStatus === 'pending' || revisionTriggering;
  const revisionDone = revisionStatus === 'done';

  return (
    <section className="rounded-xs border border-line bg-paper p-4 text-md text-ink">
      <div className="mb-2 text-sm uppercase tracking-[0.08em] text-mute-soft">
        {t('download.eyebrow')}
      </div>
      {recordingError ? (
        <div className="mb-3 rounded-xs border border-line-soft px-3 py-2 text-md text-mute">
          {t.has(`download.errors.${recordingError}`)
            ? t(`download.errors.${recordingError}`)
            : recordingError}
          {/* Server root-cause detail (storage_unavailable / row insert
              failure / …). Only the reserve path carries one; rendered in
              a muted monospace tail so a host can copy it into a report. */}
          {recordingError === 'reserve_failed' && recordingErrorDetail ? (
            <span className="ml-1 break-all font-mono text-sm text-mute-soft">
              ({recordingErrorDetail})
            </span>
          ) : null}
        </div>
      ) : null}
      {!recording ? (
        <p className="text-md text-mute">{t('download.notAvailable')}</p>
      ) : !ready ? (
        <p className="text-md text-mute">{t('download.preparing')}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <ChromeButton
            size="lg"
            onClick={() => onDownload('m4a-output')}
            disabled={downloadingFormat !== null}
          >
            {downloadingFormat === 'm4a-output'
              ? t('download.preparingFile')
              : t('download.audioOutput')}
          </ChromeButton>
          <ChromeButton
            size="lg"
            onClick={() => onDownload('zip-output')}
            disabled={downloadingFormat !== null}
          >
            {downloadingFormat === 'zip-output'
              ? t('download.preparingFile')
              : t('download.zipOutput')}
          </ChromeButton>
          {revisionDone ? (
            <ChromeButton
              size="lg"
              onClick={() => onDownload('zip-revised')}
              disabled={downloadingFormat !== null}
            >
              {downloadingFormat === 'zip-revised'
                ? t('download.preparingFile')
                : t('download.zipRevised')}
            </ChromeButton>
          ) : null}
        </div>
      )}

      {showRevise ? (
        <div className="mt-4 border-t border-line-soft pt-4">
          <div className="mb-2 text-sm uppercase tracking-[0.08em] text-mute-soft">
            {t('revise.eyebrow')}
          </div>
          {revisionError ? (
            <div className="mb-3 rounded-xs border border-line-soft px-3 py-2 text-md text-mute">
              {t.has(`revise.errors.${revisionError}`)
                ? t(`revise.errors.${revisionError}`)
                : revisionError}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px]">
              <div className="text-lg text-ink">{t('revise.title')}</div>
              <div className="mt-1 text-md text-mute">
                {revisionDone
                  ? t('revise.doneHint')
                  : t('revise.hint', { credits: REVISE_CREDITS })}
              </div>
            </div>
            {revisionDone ? (
              <span className="rounded-xs border border-amore px-2 py-0.5 text-sm text-amore">
                {t('revise.donePill')}
              </span>
            ) : (
              <ChromeButton
                variant="primary"
                size="lg"
                onClick={onRevise}
                disabled={revisionPending || !ready}
              >
                {revisionPending
                  ? t('revise.running')
                  : t('revise.trigger', { credits: REVISE_CREDITS })}
              </ChromeButton>
            )}
          </div>
        </div>
      ) : null}

      {/* Layer D — 사후 LLM 보정. revise 와 별개 pass: 실시간 OUTPUT
          전사록 전체를 한 번에 검토해 단어 융합 / 인명 표기 / soundalike /
          의미 압축을 교정하고 불확실 구간은 플래그(⟦?⟧)로 남긴다. */}
      {recording !== null && sessionId ? (
        <PostProcessPanel sessionId={sessionId} ready={!!ready} />
      ) : null}
    </section>
  );
}

// ── Layer B: glossary chip editor ──
// Bare chip container + ChipInput extender (research-context.tsx 패턴).
// Enter / blur 로 chip 추가, Backspace (빈 draft) 로 마지막 chip 제거.
function GlossaryField({
  values,
  onChange,
  disabled,
  placeholderEmpty,
  placeholderAdd,
  removeAria,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholderEmpty: string;
  placeholderAdd: string;
  removeAria: string;
}) {
  const [draft, setDraft] = useState('');
  const MAX_TERMS = 200;
  const MAX_LEN = 200;

  function commitDraft() {
    const trimmed = draft.trim();
    setDraft('');
    if (!trimmed) return;
    if (values.length >= MAX_TERMS) return;
    if (values.includes(trimmed)) return;
    onChange([...values, trimmed.slice(0, MAX_LEN)]);
  }

  return (
    <div
      className={`flex min-h-8 flex-wrap items-center gap-1.5 rounded-xs border border-line bg-paper px-2 py-1 focus-within:border-amore ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      {values.map((v, idx) => (
        <span
          key={`${idx}-${v}`}
          className="inline-flex items-center gap-1 rounded-full border border-amore bg-paper px-2 py-0.5 text-sm text-amore"
        >
          {v}
          <IconButton
            variant="ghost-brand"
            onClick={() => onChange(values.filter((_, i) => i !== idx))}
            aria-label={`${removeAria}: ${v}`}
            disabled={disabled}
          >
            ×
          </IconButton>
        </span>
      ))}
      <ChipInput
        className="min-w-[120px] flex-1 text-md"
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, MAX_LEN))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitDraft();
          } else if (
            e.key === 'Backspace' &&
            draft.length === 0 &&
            values.length > 0
          ) {
            e.preventDefault();
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={() => {
          if (draft.trim()) commitDraft();
        }}
        disabled={disabled || values.length >= MAX_TERMS}
        placeholder={values.length === 0 ? placeholderEmpty : placeholderAdd}
      />
    </div>
  );
}

// ── Layer D: post-process panel ──
// Self-contained: hydrates + polls /postprocess status, owns the options
// modal (smooth / canonical_name / reference), triggers the LLM pass, and
// downloads the corrected markdown artifact. Kept out of the parent so
// the big console component doesn't grow another 6 state hooks.
type PostProcessStatus = 'idle' | 'pending' | 'done' | 'failed';

function PostProcessPanel({
  sessionId,
  ready,
}: {
  sessionId: string;
  ready: boolean;
}) {
  const t = useTranslations('TranslateConsole');
  const [ppStatus, setPpStatus] = useState<PostProcessStatus | null>(null);
  const [ppError, setPpError] = useState<string | null>(null);
  const [ppFlags, setPpFlags] = useState<number | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [smooth, setSmooth] = useState(false);
  const [canonicalName, setCanonicalName] = useState('');
  const [reference, setReference] = useState('');
  const [referenceName, setReferenceName] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const pending = ppStatus === 'pending' || triggering;
  const done = ppStatus === 'done';

  // Hydrate once the panel mounts (session has ended). Picks up a run
  // triggered from another tab + the server-side terminal state.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/translate/sessions/${sessionId}/postprocess`);
        if (!res.ok) {
          if (!cancelled) setPpStatus('idle');
          return;
        }
        const j = (await res.json()) as {
          post_process_status: PostProcessStatus;
          post_process_error: string | null;
          post_process_flags: number | null;
        };
        if (cancelled) return;
        setPpStatus(j.post_process_status);
        setPpFlags(j.post_process_flags);
        if (j.post_process_error) setPpError(j.post_process_error);
      } catch {
        if (!cancelled) setPpStatus('idle');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Poll while pending so the spinner flips to done/failed promptly.
  useEffect(() => {
    if (ppStatus !== 'pending') return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/translate/sessions/${sessionId}/postprocess`);
        if (!res.ok) return;
        const j = (await res.json()) as {
          post_process_status: PostProcessStatus;
          post_process_error: string | null;
          post_process_flags: number | null;
        };
        if (cancelled) return;
        setPpStatus(j.post_process_status);
        setPpFlags(j.post_process_flags);
        if (j.post_process_error) setPpError(j.post_process_error);
      } catch {
        // best-effort
      }
    };
    const handle = setInterval(() => void tick(), 4000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [ppStatus, sessionId]);

  const runPostProcess = useCallback(async () => {
    if (triggering || pending || done) return;
    setTriggering(true);
    setPpError(null);
    try {
      const res = await fetch(`/api/translate/sessions/${sessionId}/postprocess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smooth: smooth ? 'on' : 'off',
          canonical_name: canonicalName.trim() || undefined,
          reference: reference.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        flags_count?: number;
        error?: string;
      };
      if (!res.ok) {
        setPpError(json.error ?? 'postprocess_trigger_failed');
        setPpStatus((s) => (s === 'pending' ? 'failed' : s));
        return;
      }
      setPpStatus('done');
      if (typeof json.flags_count === 'number') setPpFlags(json.flags_count);
      setModalOpen(false);
    } catch {
      setPpError('postprocess_trigger_failed');
    } finally {
      setTriggering(false);
    }
  }, [
    triggering,
    pending,
    done,
    sessionId,
    smooth,
    canonicalName,
    reference,
  ]);

  const downloadCorrected = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/translate/sessions/${sessionId}/postprocess`);
      if (!res.ok) return;
      const j = (await res.json()) as { post_process_md: string | null };
      if (!j.post_process_md) return;
      // BOM keeps Korean / CJK legible in editors that guess the codec.
      const blob = new Blob(['﻿', j.post_process_md], {
        type: 'text/markdown;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `translate-${sessionId}-corrected.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // best-effort
    } finally {
      setDownloading(false);
    }
  }, [downloading, sessionId]);

  // Hide entirely until the first hydration poll resolves so a stale CTA
  // doesn't flicker.
  if (ppStatus === null) return null;

  return (
    <div className="mt-4 border-t border-line-soft pt-4">
      <div className="mb-2 text-sm uppercase tracking-[0.08em] text-mute-soft">
        {t('postProcess.eyebrow')}
      </div>
      {ppError ? (
        <div className="mb-3 rounded-xs border border-line-soft px-3 py-2 text-md text-mute">
          {t.has(`postProcess.errors.${ppError}`)
            ? t(`postProcess.errors.${ppError}`)
            : ppError}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[220px] flex-1">
          <div className="text-lg text-ink">{t('postProcess.title')}</div>
          <div className="mt-1 text-md text-mute">
            {done
              ? t('postProcess.doneHint', { flags: ppFlags ?? 0 })
              : t('postProcess.hint', { credits: POSTPROCESS_CREDITS })}
          </div>
        </div>
        {done ? (
          <div className="flex items-center gap-2">
            <span className="rounded-xs border border-amore px-2 py-0.5 text-sm text-amore">
              {t('postProcess.donePill')}
            </span>
            <ChromeButton
              size="lg"
              onClick={() => void downloadCorrected()}
              disabled={downloading}
            >
              {downloading
                ? t('postProcess.downloading')
                : t('postProcess.download')}
            </ChromeButton>
          </div>
        ) : (
          <ChromeButton
            variant="primary"
            size="lg"
            onClick={() => setModalOpen(true)}
            disabled={pending || !ready}
          >
            {pending
              ? t('postProcess.running')
              : t('postProcess.trigger', { credits: POSTPROCESS_CREDITS })}
          </ChromeButton>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => {
          if (!pending) setModalOpen(false);
        }}
        title={t('postProcess.modal.title')}
      >
        <div className="space-y-4">
          <Field
            label={t('postProcess.modal.smoothLabel')}
            description={t('postProcess.modal.smoothHint')}
          >
            <label className="flex cursor-pointer items-center gap-2 text-md text-ink">
              <Checkbox
                checked={smooth}
                onChange={(e) => setSmooth(e.target.checked)}
                disabled={pending}
              />
              {t('postProcess.modal.smoothOn')}
            </label>
          </Field>

          <Field
            label={t('postProcess.modal.canonicalLabel')}
            description={t('postProcess.modal.canonicalHint')}
          >
            <ChromeInput
              value={canonicalName}
              onChange={(e) => setCanonicalName(e.target.value.slice(0, 200))}
              placeholder={t('postProcess.modal.canonicalPlaceholder')}
              disabled={pending}
            />
          </Field>

          <Field
            label={t('postProcess.modal.referenceLabel')}
            description={t('postProcess.modal.referenceHint')}
          >
            {referenceName ? (
              <div className="flex items-center gap-2 text-md text-ink">
                <span className="truncate">{referenceName}</span>
                <IconButton
                  variant="ghost-brand"
                  onClick={() => {
                    setReference('');
                    setReferenceName(null);
                  }}
                  aria-label={t('postProcess.modal.referenceRemove')}
                  disabled={pending}
                >
                  ×
                </IconButton>
              </div>
            ) : (
              <FileDropZone
                accept=".txt,.md,.markdown"
                onFiles={(files) => {
                  const f = files[0];
                  if (!f) return;
                  void f.text().then((txt) => {
                    setReference(txt.slice(0, 100_000));
                    setReferenceName(f.name);
                  });
                }}
              />
            )}
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <ChromeButton
              variant="mute"
              size="lg"
              onClick={() => setModalOpen(false)}
              disabled={pending}
            >
              {t('postProcess.modal.cancel')}
            </ChromeButton>
            <ChromeButton
              variant="primary"
              size="lg"
              onClick={() => void runPostProcess()}
              disabled={pending}
            >
              {pending
                ? t('postProcess.running')
                : t('postProcess.modal.run')}
            </ChromeButton>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function SpeakerOnIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

function SpeakerOffIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}

// Prompter pane — a single centred column that auto-scrolls as new
// translated lines arrive. PR-D15: Memphis container (3px black border
// + 6px radius + offset shadow + white bg + Outfit body) — 옛 borderless
// 흐름을 pop 톤 카드로 승격. A soft mask at the top edge fades older
// lines as they age out of the 30-second window; mask 는 텍스트 컨텐츠
// 만 fade 하고 chrome 은 그대로 유지된다.
function PrompterPane({ lines, empty }: { lines: CaptionLine[]; empty: string }) {
  const t = useTranslations('TranslateConsole');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Pin to bottom on every new line so the latest text stays in the
  // active reading position.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);
  const outfitStack = 'var(--font-outfit), var(--font-sans)';
  const speakerLabel = (s: 'host' | 'guest') =>
    s === 'host' ? t('speaker.host') : t('speaker.guest');
  return (
    <div
      className="relative min-h-[360px] bg-paper"
      style={{
        border: '3px solid var(--canvas-card-border)',
        borderRadius: 'var(--sidebar-nav-radius)',
        boxShadow: 'var(--memphis-shadow-sm)',
      }}
    >
      <div
        ref={scrollRef}
        className="mx-auto flex max-h-[60vh] min-h-[360px] w-full max-w-[760px] flex-col gap-3 overflow-y-auto px-4 py-8 text-2xl leading-[1.7] tracking-[-0.005em] text-ink"
        style={{
          fontFamily: outfitStack,
          fontWeight: 600,
          WebkitMaskImage:
            'linear-gradient(180deg, transparent 0%, #000 18%, #000 100%)',
          maskImage:
            'linear-gradient(180deg, transparent 0%, #000 18%, #000 100%)',
        }}
      >
        {lines.length === 0 ? (
          <div
            className="m-auto text-center text-xl text-mute"
            style={{ fontFamily: outfitStack, fontWeight: 500 }}
          >
            {empty}
          </div>
        ) : (
          lines.map((l) => (
            <p
              key={l.id}
              className={l.final ? 'text-center text-ink' : 'text-center text-mute'}
            >
              {l.speaker ? (
                <span
                  className={`mr-2 align-middle text-xs font-semibold uppercase tracking-[0.18em] ${
                    l.speaker === 'host' ? 'text-ink' : 'text-amore'
                  }`}
                >
                  {speakerLabel(l.speaker)}
                </span>
              ) : null}
              {l.text}
              {l.final ? '' : '…'}
            </p>
          ))
        )}
      </div>
    </div>
  );
}


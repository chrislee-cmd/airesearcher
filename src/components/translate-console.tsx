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
import * as Sentry from '@sentry/nextjs';
import { useLocale, useTranslations } from 'next-intl';
import { Room, LocalAudioTrack } from 'livekit-client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { env } from '@/env';
import { createTtsQueue, type TtsQueue } from '@/lib/translate-tts';
import { createClient as createBrowserSupabase } from '@/lib/supabase/client';
import { ChromeButton } from './ui/chrome-button';
import { Button } from './ui/button';
import { WidgetPrimaryCta } from './canvas/shell/widget-primary-cta';
import { ChromeInput } from './ui/chrome-input';
import { IconButton } from './ui/icon-button';
import { Textarea } from './ui/textarea';
import { Checkbox } from './ui/checkbox';
import { Modal } from './ui/modal';
import {
  ShareGuidePopup,
  isShareGuideSuppressed,
} from './share-guide-popup';
import { FileDropZone } from './ui/file-drop-zone';
import {
  CaptureUseCaseCards,
  type CaptureUseCaseOption,
} from './ui/capture-usecase-cards';
import { Field } from './canvas/shell/field';
import { ControlBoardPanel } from './canvas/shell/control-board-panel';
import {
  WidgetAccordion,
  useWidgetAccordion,
  type AccordionStepConfig,
} from './canvas/shell/widget-accordion';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';
import { WidgetOutputRegion } from './canvas/shell/widget-output-region';
import { ListenerPanel } from './translate/listener-panel';
import { EchoOnboarding } from './translate/echo-onboarding';
import { LangDualDropdown } from './translate/lang-dual-dropdown';
import { ProjectPicker } from '@/components/project-picker';
import { useProjectSelection } from '@/components/project-selection-provider';
import { useProjectWidgetSettings } from '@/hooks/use-project-widget-settings';
import { useTranslateSessionPublisher } from './translate/translate-session-context';
import {
  listenersFromPresence,
  type Listener,
  type ListenerPresence,
} from '@/hooks/use-translate-listeners';
import {
  isHangulFusionBoundary,
  joinDelta,
  reSpaceKoreanLine,
} from '@/lib/translate-stream-join';
import {
  useRealtimeTranscriptLiveBinding,
  useRealtimeTranscriptPublisher,
} from './realtime-transcript-provider';
import {
  FIDELITY_LOSS_THRESHOLD,
  countReplacementChars,
  decodeDataChannelMessage,
  looksJapaneseFallback,
  looksSilenceHallucination,
  lossRatio,
  summarizeFidelity,
} from '@/lib/translate-fidelity';
import { useCreditDeduction } from './credit-deduction-provider';
import { useWidgetGate } from '@/components/widget-gate-provider';
import {
  TRANSLATE_METERING,
  TRANSLATE_START_LUMP_CREDITS,
  TRANSLATE_MAX_BILLABLE_TICK,
} from '@/lib/features';
import { track as trackEvent } from '@/lib/analytics/events';

// Dev-mode trace gate. Enabled in non-prod builds so a designer running
// `pnpm dev` can step through the pipeline and confirm Korean / Thai /
// Chinese deltas land intact at every stage (datachannel → state →
// /messages POST → DB). Disabled in production so a long session (sessions
// can now span 90+ min via auto renewal — see SESSION_MAX_MS / renewSession)
// doesn't flood the browser console.
const TRACE_ENCODING =
  typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';

// 🔊 Custom fixed-voice TTS. When enabled (default), we DROP the realtime
// model's dynamic-voice audio track and re-synthesize the translated text
// through OpenAI TTS pinned to one voice (src/lib/translate-tts.ts). The
// `off` kill-switch reverts to the model's native audio path (the pre-fix
// behaviour) with zero other changes. Module-level so it's a stable
// reference across renders and closures.
const CUSTOM_TTS_ENABLED = env.NEXT_PUBLIC_TRANSLATE_CUSTOM_TTS !== 'off';

type Status = 'idle' | 'starting' | 'live' | 'ending' | 'ended' | 'error';

// All paths that tear the session down. Logged via `console.info` so
// stray reconnect cycles in production can be traced back to a
// specific caller without re-deploying with extra instrumentation.
type CleanupCaller =
  | 'start_error_session'
  | 'start_error_mic'
  | 'start_error_livekit'
  | 'start_error_webrtc'
  | 'start_error_credits'
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

export type CaptionLine = {
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
// still under investigation — see [translate] session_restart logs), which
// spins up a second OpenAI session that retranscribes the same audio with
// slightly different tokenization (e.g. comma added/removed). The
// dedup window keeps those copies off the prompter without blocking
// genuine repeats spoken minutes apart.
//
// 🚨 session-restart-loop diagnosis (pr-translate-session-restart-loop-
// diagnosis): raised 60_000 → 300_000 as a temporary mitigation for the
// rapid-fire regression. A mid-session restart (unexpected ICE/connection
// drop, or the ~2 s auto-renewal overlap where old + new OpenAI sessions
// briefly both transcribe the shared source track) can re-emit an
// utterance well over a minute after its original commit — the old 60 s
// window let those slip through. 300 s covers the realistic restart gap.
// Tradeoff (accepted, per spec): a GENUINE repeat of the same phrase
// spoken <5 min apart is now suppressed — but the fuzzy/containment/lcs
// heuristics already require substantial similarity AND clear script-aware
// min-length guards, so short acks ("네.", "맞아요.") are unaffected. The
// real fix (root-cause restart elimination) lands in follow-up specs once
// the session_restart telemetry below pins the trigger.
const DEDUP_WINDOW_MS = 300_000;

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

// 🚨 Cross-channel echo gate (pr-translate-cross-channel-echo-gate).
//
// The dedup stack above only compares WITHIN one channel (input↔input,
// output↔output). The production "rapid fire" loop is a CROSS-channel echo:
// the translated TTS (output, target-lang) leaves the speaker, gets
// re-picked-up by the mic/tab (tab capture runs with echoCancellation:false
// and the TTS is on no AEC reference signal, so acoustic cancellation is
// impossible), and re-enters as an INPUT transcription in the TARGET
// language — which is then re-translated into another TTS, amplifying the
// loop. Same-channel dedup structurally cannot see this (the copy crosses
// output→input). A text-level gate is the only fix: when an input final
// matches a recent OUTPUT final, it's our own voice echoing back.
//
// Buffer window is short (20s): a real echo re-enters within a couple
// seconds of the TTS, so 20s covers restart/renewal jitter without risking
// a genuine later utterance colliding with a minutes-old output.
const ECHO_WINDOW_MS = 20_000;

// Minimum normalized length before the echo gate will fire. Short
// code-switching tokens ("OK", "Notion", brand names) legitimately appear in
// both the source speech and the translation, so gating them would suppress
// real input. CJK packs more meaning per char (same rationale as the
// containment thresholds above), so it clears at a lower bar.
const ECHO_MIN_LEN_CJK = 6;
const ECHO_MIN_LEN_LATIN = 14;

// Containment coverage floor for the echo gate. isContainmentDup alone would
// flag an input that is any substring of a longer output — too loose for the
// "whole sentence" match the spec requires (부분 단어 X). Require the shorter
// side to cover most of the longer so we only gate near-complete
// re-transcriptions, never partial words.
const ECHO_CONTAINMENT_COVERAGE = 0.7;

function echoMinLen(key: string): number {
  return hasCJK(key) ? ECHO_MIN_LEN_CJK : ECHO_MIN_LEN_LATIN;
}

// Whole-sentence cross-channel match. Deliberately STRICTER than
// matchDedupRule: fuzzy whole-string (lengths within 30%, ≤20% edits) OR
// near-total containment. No LCS — a shared substring is exactly the
// "partial word" false-positive the spec's guard forbids.
function isCrossChannelEcho(inputKey: string, outputKey: string): boolean {
  if (inputKey.length < echoMinLen(inputKey)) return false;
  if (isFuzzyDup(inputKey, outputKey)) return true;
  const shorter = Math.min(inputKey.length, outputKey.length);
  const longer = Math.max(inputKey.length, outputKey.length);
  return (
    longer > 0 &&
    shorter / longer >= ECHO_CONTAINMENT_COVERAGE &&
    isContainmentDup(inputKey, outputKey)
  );
}

// Scan the recent-output echo buffer for a cross-channel match. Returns the
// matched output key (for the diagnostic log) or null.
function matchEcho(
  inputKey: string,
  outputs: ReadonlyArray<{ key: string; ts: number }>,
): string | null {
  for (const e of outputs) {
    if (isCrossChannelEcho(inputKey, e.key)) return e.key;
  }
  return null;
}

// 🚨 Echo-loop breaker (Fix 2). Two self-echoes inside 30s = a live feedback
// loop (a single stray echo can happen from an accidental unmute). On the
// Nth we surface a headphone-nudge banner and temporarily mute the LOCAL
// monitor <audio> to break the acoustic re-amplification path. We NEVER mute
// the mic — half-duplex muting is forbidden per spec (drops real speech).
const ECHO_BURST_WINDOW_MS = 30_000;
const ECHO_BURST_THRESHOLD = 2;
// How long the local monitor stays auto-muted after an echo burst. Extended
// on each new echo; auto-clears so the host's audio returns once the loop
// stops. Best-effort UX, not a hard gate.
const ECHO_MUTE_MS = 5_000;

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
  // i18n-allow-korean -- 언어 선택기 endonym (각 언어를 자국어 표기로 노출, 번역 안 함)
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

// 🚨 Fragment merge (Fix 2). Strip trailing sentence-ending punctuation +
// whitespace so a folded short shard ("Okay.") doesn't re-trigger a sentence
// boundary when it merges into the following utterance. Mirrors SENTENCE_TAIL.
function stripTerminalPunct(s: string): string {
  return s.replace(/[.!?。！？…]+["')\]」』]?\s*$/u, '').trimEnd();
}

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

// 🚨 Fragment merge (Fix 2, pr-translate-stt-silence-hallucination-gate).
// The translations session can't override server VAD (turn_detection is
// rejected — see src/lib/openai-realtime.ts), so it over-splits: ~17% of
// committed INPUT lines were ≤4-char shards (Supabase audit, 2026-07-06). A
// short input line that hits a sentence boundary with nothing after it is
// deferred for MERGE_DEBOUNCE_MS instead of committing immediately: if the
// speaker continues within the window the shard FOLDS into that utterance
// (its terminal punctuation stripped so it doesn't re-trigger a boundary);
// otherwise the debounce timer commits it standalone. Only shards ≤
// MERGE_MAX_CHARS are eligible so real sentence splitting is untouched.
const MERGE_MAX_CHARS = 4;
const MERGE_DEBOUNCE_MS = 300;

// 🚨 Session auto-renewal (pr-translate-session-auto-renewal).
// OpenAI Realtime sessions have a hard server-side max lifetime of ~30 min:
// the server closes the connection, the client goes silent or reconnect-
// loops, and the same audio gets re-transcribed (the rapid-fire regression).
// Real interpreting sessions run 60-90 min, so we proactively renew EACH
// slot's OpenAI session before the server hard-closes it: spin up a fresh
// RTCPeerConnection (same mic/tab source track, same shared LiveKit publish +
// recording mixers) and hand over, then close the old PC after a short delay
// to catch the last in-flight transcription. Transcript state (React) is
// untouched across a renewal, so the user sees no discontinuity.
//
// SESSION_MAX_MS < 30 min keeps a 5 min safety margin before the server
// close. RENEW_CHECK_MS is the polling cadence. On a renewal FAILURE we don't
// tear the session down — the still-open old session keeps running (old
// behaviour / fallback), and we retry after RENEW_RETRY_MS so a transient
// ephemeral/SDP hiccup gets a few more shots before the hard 30 min close.
const SESSION_MAX_MS = 25 * 60_000; // 25 min (5 min margin under the 30 min cap)
const RENEW_CHECK_MS = 10_000;
const RENEW_RETRY_MS = 60_000;

// 🚨 진행 중 크레딧 heartbeat (하이브리드 C, docs §6). go-live 시 /start 가
// start lump(tick 0)을 차감하고, 이후 이 간격마다 /heartbeat 를 tick 1,2,3…
// 으로 호출해 blockCredits(10)씩 낙관적 차감 → 우측 상단 잔액 실시간 count-down.
// 종료 시 finalize 가 실오디오 기준으로 정산·보정한다(좀비는 환불). 기본 10분;
// preview 에서 짧게 관측하려면 NEXT_PUBLIC_TRANSLATE_HEARTBEAT_MS 로 낮춘다
// (과금 로직은 불변 — 표시 검증용 knob).
const HEARTBEAT_MS = (() => {
  const raw = Number(process.env.NEXT_PUBLIC_TRANSLATE_HEARTBEAT_MS);
  return Number.isFinite(raw) && raw >= 1_000
    ? raw
    : TRANSLATE_METERING.blockMinutes * 60_000; // 10 min
})();

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
  // 🚨 cross-channel echo gate: input finals dropped because they matched a
  // recent output final (our own TTS re-entering the mic/tab). input-only.
  selfEchoDrops: number;
  // 🚨 silence-hallucination gate (Fix 1): input DELTAS dropped as Whisper
  // silence ghosts ("Goodbye"/"Okay") in CJK-source sessions. input-only.
  // Surfaced in the loss report so an over-eager gate (dropping real
  // code-switch loanwords) is observable without a live console.
  silenceHallucinationDrops: number;
  // 🚨 fragment-merge (Fix 2): short input sentence-boundary commits DEFERRED
  // by the debounce window, and how many of those then FOLDED into the
  // following utterance instead of committing standalone. High deferrals with
  // low folds ⇒ most short fragments were genuinely standalone. input-only.
  mergeDeferrals: number;
  mergeFolds: number;
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
    selfEchoDrops: 0,
    silenceHallucinationDrops: 0,
    mergeDeferrals: 0,
    mergeFolds: 0,
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

export function TranslateConsole({
  // Listener panel is only meaningful in the wide fullview layout — the
  // small card has no room. The fullview slot opts in via this flag.
  showListeners = false,
}: {
  showListeners?: boolean;
} = {}) {
  const { notify: notifyDeduction } = useCreditDeduction();
  const t = useTranslations('TranslateConsole');
  // 캡처모드 유스케이스 카드 공유 네임스페이스 (probing 과 동일 컴포넌트/카피).
  const tc = useTranslations('CaptureUseCase');
  const locale = useLocale();

  // 캡처모드 3-카드 옵션 + 위젯별 모드 매핑. mic-only→오프라인(진행자·참석자
  // 모두 마이크, 화자 구분 없음), both→온라인(진행자 mic + 응답자 tab 병렬
  // 캡처 + 화자분리), tab-only→참관(진행자·참석자 모두 탭 오디오). '온라인'
  // 카드 note = 기존 both 비용경고(bothCostHint) 재사용 — 선택 시에만 노출.
  const CAPTURE_USECASE_OPTIONS: CaptureUseCaseOption[] = [
    {
      id: 'mic-only',
      icon: '🤝',
      title: tc('offlineTitle'),
      hostVia: tc('hostVia', { via: tc('viaMic') }),
      guestVia: tc('guestVia', { via: tc('viaMic') }),
      note: tc('offlineNote'),
    },
    {
      id: 'both',
      icon: '💻',
      title: tc('onlineTitle'),
      hostVia: tc('hostVia', { via: tc('viaMic') }),
      guestVia: tc('guestVia', { via: tc('viaTab') }),
      note: t('captureMode.bothCostHint'),
    },
    {
      id: 'tab-only',
      icon: '👀',
      title: tc('observeTitle'),
      hostVia: tc('hostVia', { via: tc('viaTab') }),
      guestVia: tc('guestVia', { via: tc('viaTab') }),
    },
  ];

  const [status, setStatus] = useState<Status>('idle');

  // 위젯별 동시사용 게이트 (#512) — 통역 세션 start 시 슬롯 획득, 종료 시 반납.
  // 캔버스 밖(/live 단독 페이지)에서는 provider 부재로 no-op(투명 통과).
  const gate = useWidgetGate('translate');
  // 세션이 끝나거나(ended/idle) 실패(error)하면 슬롯 반납. 정지 버튼 · 시작
  // 실패 · 언마운트가 모두 status 전환으로 커버된다.
  const prevGateStatusRef = useRef<Status>('idle');
  useEffect(() => {
    const prev = prevGateStatusRef.current;
    prevGateStatusRef.current = status;
    if (
      prev !== status &&
      (status === 'ended' || status === 'error' || status === 'idle')
    ) {
      gate.release();
    }
  }, [status, gate]);

  const [error, setError] = useState<string | null>(null);
  // 원어/번역 언어 — 미선택('')이 기본. 프로빙(#536)과 동작 통일: 사용자가
  // 명시로 고르기 전엔 통역 시작 CTA 가 비활성(아래 idle CTA 게이트). 세션
  // 시작(start) 전까지는 picker placeholder("선택")만 렌더하고, 실제 값 소비는
  // start() 이후(create route body·세션 핸들러)라 idle 빈값 부작용 없음.
  const [sourceLang, setSourceLang] = useState('');
  const [targetLang, setTargetLang] = useState('');
  // Glossary (Layer B) — host-entered canonical spellings of names /
  // proper nouns / acronyms, captured before the session starts. Sent to
  // the create route and stored on the session; the realtime translations
  // endpoint can't take a hint (openai-realtime.ts), so glossary only
  // feeds the post-process (Layer D) and revise (Layer C) LLM passes.
  const [glossary, setGlossary] = useState<string[]>([]);
  // 프로젝트별 용어집 (#543). 통역 위젯 슬롯의 독립 선택(ProjectSelectionProvider
  // 의 'translate' 슬롯) — 다른 위젯(프로빙 등) 선택과 무관, 강제 sync 없음.
  // 선택 프로젝트가 있으면 glossary 를 그 프로젝트의 project_widget_settings
  // ('translate', { glossary }) 로 hydrate/save(DB 영속). 미선택이면 로컬/빈 값
  // (하위호환) — 세션 start payload(:2418)는 어느 쪽이든 이 glossary state 를 그대로 씀.
  const { getSelection, setSelection, selection } = useProjectSelection();
  const projectId = getSelection('translate');
  const {
    settings: widgetSettings,
    save: saveWidgetSettings,
    loading: widgetSettingsLoading,
    error: widgetSettingsError,
  } = useProjectWidgetSettings(projectId, 'translate');
  // 선택 프로젝트의 DB 설정이 로드 완료되면(loading true→false) glossary 를 그
  // 프로젝트 값으로 hydrate. loading 트랜지션에만 반응해 (a) 프로젝트 전환 중
  // 이전 프로젝트의 stale settings 로 덮어쓰는 것과 (b) save 직후 settings 갱신이
  // 편집 중인 로컬 값을 되돌리는 것을 둘 다 피한다. 미선택(projectId null)이면
  // load 가 loading 을 안 올리므로 트랜지션이 없어 로컬 값을 그대로 유지(하위호환).
  const prevWidgetLoadingRef = useRef(false);
  useEffect(() => {
    const wasLoading = prevWidgetLoadingRef.current;
    prevWidgetLoadingRef.current = widgetSettingsLoading;
    if (!wasLoading || widgetSettingsLoading || !projectId) return;
    // 방금 이 프로젝트의 fetch 가 끝났다 — 실패면 cross-project 누출을 막게 빈
    // 값으로, 성공이면 DB glossary 로 hydrate.
    const raw = widgetSettingsError
      ? []
      : (widgetSettings as { glossary?: unknown }).glossary;
    const next = Array.isArray(raw)
      ? raw.filter((s): s is string => typeof s === 'string')
      : [];
    setGlossary(next);
  }, [widgetSettingsLoading, projectId, widgetSettings, widgetSettingsError]);
  // glossary 편집 핸들러 — 로컬 state 갱신 + 프로젝트 선택 시 DB save(영속).
  // 미선택이면 로컬만(하위호환). 다른 위젯 설정 키가 생겨도 보존하도록 spread.
  const handleGlossaryChange = useCallback(
    (next: string[]) => {
      setGlossary(next);
      if (projectId) {
        void saveWidgetSettings({ ...widgetSettings, glossary: next });
      }
    },
    [projectId, saveWidgetSettings, widgetSettings],
  );
  // 프로젝트 전환 — live 중엔 잠금(결정 3: 세션 중 언어·모드·Glossary 불변).
  const handleProjectChange = useCallback(
    (nextId: string | null) => {
      setSelection('translate', nextId);
    },
    [setSelection],
  );
  // Capture mode picker. Default '' (미선택) — 프로빙(#536)과 동작 통일.
  // picker 옵션 3개: 'mic-only'(기기 마이크) / 'tab-only'(브라우저 오디오 인풋)
  // / 'both'(mic=진행자 + tab=응답자, 두 병렬 세션 — 브라우저 화상 인터뷰
  // 양방향 캡처). 'both' 는 한때 옵션에서 제거돼 dormant 였다가 재노출(card
  // #620) — 코드경로(activeSlots/SLOT_SPEAKER/슬롯 표시등/에코 억제/graceful
  // degradation)는 그대로 살아 있었다. 'tab-only'/'both' 는 getDisplayMedia 를
  // 쓰므로 user gesture 가 필요 — picker 는 Start 전까지 state 만 기록한다.
  // 미선택('')이면 아래 idle CTA 가 비활성.
  const [captureMode, setCaptureMode] = useState<CaptureMode | ''>('');
  // 브라우저 오디오 안내(blocking ack) — tab 슬롯 포함 캡처 모드에서 시작 시 노출.
  const [browserAudioNoticeOpen, setBrowserAudioNoticeOpen] = useState(false);
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
  // just doesn't get the echo into their own room. Default OFF: audible
  // local playback is the physical root of the acoustic echo loop (host
  // speaker → host mic re-pickup). Live A/B (2026-07-06) confirmed
  // voice-OFF + separate-device earphones = 0 echo, so the safe default
  // is muted; the echo-free onboarding walks the host to the ON path
  // (listen on a separate device) rather than making the echo the default.
  const [outputAudible, setOutputAudible] = useState(false);
  // 🚨 Cross-channel echo detection (Fix 2). `echoDetected` drives the
  // headphone-nudge banner (sticky for the session, reset on Start);
  // `echoMuted` temporarily silences the local monitor to break the acoustic
  // loop (auto-clears — see ECHO_MUTE_MS / registerSelfEcho). Never touches
  // the mic.
  const [echoDetected, setEchoDetected] = useState(false);
  const [echoMuted, setEchoMuted] = useState(false);
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
  // Reactive mirror of sessionIdRef (refs don't trigger re-render). Set
  // when a session goes live, cleared on teardown. Published in the
  // fullview snapshot so the read-only view can key its own UI off the
  // live session id.
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  // Current listeners on the share link, derived from presence on the
  // session's OWN broadcast channel (below). Kept here — not via a second
  // useTranslateListeners channel — because a duplicate channel on the same
  // `live:<sessionId>` topic throws once the broadcast channel is
  // subscribed (crashed the fullview). Empty until a viewer tunes in.
  const [listeners, setListeners] = useState<Listener[]>([]);

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
  // 🚨 Auto-renewal in flight. Drives the subtle "세션 갱신 중…" indicator so
  // the host knows a background handover is happening (the <2s gap is
  // otherwise invisible). Cleared when the renewal settles (success or
  // fallback).
  const [renewing, setRenewing] = useState(false);

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
  // Wall-clock when the WHOLE translate session went live. Drives the elapsed
  // display + the stop() duration analytics. NOT reset on auto-renewal — the
  // visible timer must keep counting up across a background handover.
  const startedAtRef = useRef<number | null>(null);
  // 🚨 Auto-renewal timing. Wall-clock when the CURRENT OpenAI session epoch
  // began — reset to now() on each successful renewal. The renewal interval
  // fires when (now - sessionEpochRef) crosses SESSION_MAX_MS. Kept separate
  // from startedAtRef precisely so renewal timing doesn't disturb the elapsed
  // clock (spec's pseudo-code conflated the two — see PR notes).
  const sessionEpochRef = useRef<number | null>(null);
  // Re-entry guard for renewSession() — the 10s interval can fire again while
  // a renewal is still negotiating. Ref (not state) so the check is
  // synchronous and closure-stale-proof, mirroring startInFlightRef.
  const renewingRef = useRef(false);
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
  // 🔊 Custom fixed-voice TTS. `ttsQueueRef` owns the per-session sentence
  // synthesis + playback pipeline (created in start() when enabled).
  // `ttsMonitorGainRef` is the local-monitor volume gate: the synthesized
  // audio always flows to the LiveKit publish + recording destinations, but
  // the host's own speakers are gated by this gain (0 when outputAudible is
  // OFF / echoMuted) — the WebAudio equivalent of the model path's
  // `<audio>.muted`.
  const ttsQueueRef = useRef<TtsQueue | null>(null);
  const ttsMonitorGainRef = useRef<GainNode | null>(null);
  // Capture mode of the *running* session, captured at start(). The 2-voice
  // slot→voice mapping only applies in dual-source (`both`) sessions; in
  // single-source sessions there is one speaker, so we pass no slot and the
  // server keeps the base fixed voice (no regression from the single-voice
  // pipeline). Read inside appendStreaming, which is a stable useCallback —
  // a ref avoids re-creating it every captureMode change.
  const runningCaptureModeRef = useRef<CaptureMode>('both');
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 🚨 진행 중 크레딧 heartbeat (하이브리드 C). `heartbeatTimerRef` = 10분
  // 인터벌 핸들, `heartbeatTickRef` = 마지막으로 **과금 성공한** tick_index
  // (0=start lump, 1..N=10분 블록). 성공 시에만 증가시켜 일시적 네트워크 실패는
  // 다음 인터벌이 같은 tick 을 재시도(서버 멱등)하도록 한다. `heartbeatCappedRef`
  // = cap 도달로 과금 정지된 상태(세션은 계속). renewal 은 같은 sessionId 를
  // 유지하므로 이 tick 카운터가 그대로 이어져 재-start-lump 없이 누적된다.
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatTickRef = useRef(0);
  const heartbeatInFlightRef = useRef(false);
  const heartbeatCappedRef = useRef(false);
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
  //
  // 🐛 tab-only stuck fix (2026-07-02): the pulse only WORKS if the
  // injected gap is longer than the model's end-of-speech
  // `silence_duration_ms`. OpenAI server VAD defaults to 500 ms (see the
  // probing session config in src/app/api/probing/sessions/route.ts,
  // which spells the same default out), so a 400 ms pulse never clears
  // the threshold — the VAD keeps the utterance open, no
  // `session.input_transcript.delta` / `output_transcript.delta` ever
  // commits, and tab-only captions never stream even though translated
  // TTS (a separate WebRTC media track) still plays. Bumped to 600 ms so
  // the injected silence sits comfortably past the 500 ms end-of-speech
  // window with margin for WebAudio-resample jitter. The `/realtime/
  // translations` session cannot take a `turn_detection` override
  // (unknown params 400 the client_secret and fail session creation
  // outright — see src/lib/openai-realtime.ts), so tuning the injected
  // gap is the only tab-scoped lever that carries zero regression risk
  // to mic-only / both modes (which never run this pulse).
  const tabSilenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const TAB_SILENCE_INTERVAL_MS = 3000;
  const TAB_SILENCE_DURATION_MS = 600;

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
  // Global connect watchdog — the FINAL safety net for a hang BEFORE the agent
  // phase (session POST / room.connect / audio graph). Raised 10s → 50s so the
  // OpenAI Realtime "agent" cold-start (agent dispatch + model load on the very
  // first start) no longer trips a false-positive `translate_timeout`: room
  // (signal) connects fine, but the first SDP negotiation is slow while the
  // agent warms. The agent-join phase now owns its own budget + transparent
  // retry (see SLOT_CONNECT_* below), so this watchdog only fires on a genuine
  // stuck connect. (pr-translate-first-start-connect-timeout-fix)
  const CONNECT_TIMEOUT_MS = 50_000;
  // Per-attempt budget for the OpenAI Realtime SDP negotiation ("agent join").
  // The first start is a COLD agent (dispatch + model load) so it gets a
  // generous budget; a WARM agent (retries, renewal) answers in <2s so retries
  // are tighter. If the answer doesn't land in time we abort + retry: the agent
  // keeps warming server-side, so a later attempt lands — this is exactly why
  // the old manual "다시 시작" worked, now done transparently.
  const SLOT_CONNECT_TIMEOUT_MS = 20_000;
  const SLOT_CONNECT_RETRY_MS = 10_000;
  // Total agent-join attempts per slot (1 cold try + 2 warm retries). The user
  // stays on 'starting' ("연결 중…") across retries — the error only surfaces if
  // every attempt fails.
  const MAX_CONNECT_ATTEMPTS = 3;

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

  // 🚨 Fragment merge (Fix 2). A short input sentence-boundary commit is
  // parked here during the debounce window instead of committing. Keyed per
  // slot so the host's parked shard doesn't collide with the guest's. Holds
  // the display id + started_at so a fold or a standalone flush reuses the
  // same caption row (no orphaned partial). See MERGE_MAX_CHARS.
  const pendingInputMergeRef = useRef<
    Record<
      SourceSlot,
      { id: string; text: string; lang: string; speaker: 'host' | 'guest'; startedAt: number } | null
    >
  >(emptySlotRecord(null));
  const mergeTimerRef = useRef<Record<SourceSlot, ReturnType<typeof setTimeout> | null>>(
    emptySlotRecord<ReturnType<typeof setTimeout> | null>(null),
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

  // Analytics — 통역 콘솔 mount 시 1회 view.
  useEffect(() => {
    trackEvent('widget_viewed', { widget: 'translate' });
  }, []);

  // Synchronous re-entry guard for start(). The status closure in start()
  // can be stale across rapid invocations (the captured `status` was
  // 'idle' even after setStatus('starting') was queued but not yet
  // applied). This ref is read+written in the same microtask so a second
  // start() entering before the first awaits cannot get past it.
  const startInFlightRef = useRef(false);

  // 🚨 Auto-renewal handle. start() stores its per-slot boot closure here so
  // renewSession() (a component-scoped callback, outside start()'s closure)
  // can reuse the EXACT same connect path — no duplicated slot-boot logic to
  // drift. Reassigned on every start(); read at renewal time.
  const bootSlotRef = useRef<
    (slot: SourceSlot, clientSecret: string, renewal?: boolean) => Promise<boolean>
  >(async () => false);

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

  // 🚨 Cross-channel echo gate buffer. Rolling window of recent OUTPUT final
  // keys (target-lang, normalized), CROSS-slot — the echo can re-enter on any
  // input slot regardless of which slot's TTS produced it. Pruned to
  // ECHO_WINDOW_MS on each insert. Separate from recentFinalsRef (which is
  // per-slot per-kind for same-channel dedup) because the echo gate is a
  // distinct cross-channel layer (decision 1).
  const recentOutputEchoRef = useRef<Array<{ key: string; ts: number }>>([]);
  // Fix 2 burst counter — timestamps of recent self_echo detections, pruned
  // to ECHO_BURST_WINDOW_MS. `echoMutedRef` mirrors the `echoMuted` state so
  // the TTS-attach closures (which capture a stale state value) read the live
  // flag. `echoMuteTimerRef` holds the auto-clear timer.
  const echoEventsRef = useRef<number[]>([]);
  const echoMutedRef = useRef(false);
  const echoMuteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  // `echoMuted` (Fix 2) forces the monitor silent on top of the host toggle
  // to break the acoustic feedback loop — OR'd in so it can only ADD mute,
  // never un-mute against the host's wish.
  useEffect(() => {
    for (const slot of ['mic', 'tab'] as const) {
      const el = monitorAudioRefs.current[slot];
      if (el) el.muted = !outputAudible || echoMuted;
    }
    // 🔊 Custom TTS local monitor: same OR'd mute logic, expressed as a
    // WebAudio gain (0 = silent). The LiveKit publish + recording taps are
    // separate nodes and stay untouched, so viewers keep hearing the fixed
    // voice regardless of the host's local toggle.
    const g = ttsMonitorGainRef.current;
    if (g) g.gain.value = !outputAudible || echoMuted ? 0 : 1;
  }, [outputAudible, echoMuted]);

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
  const cleanup = useCallback((caller: CleanupCaller, errorReason?: string) => {
    const sid = sessionIdRef.current;
    console.info('[translate] cleanup', {
      caller,
      sessionId: sid,
      hasRoom: !!roomRef.current,
      hasPc: !!(pcRef.current.mic || pcRef.current.tab),
    });
    // OBS-4: when a start path failed (connect timeout / mic / LiveKit /
    // WebRTC), persist a terminal 'error' state + reason so the failed
    // session is countable in the admin dashboard instead of dying as a
    // phantom row. Fire-and-forget — teardown must not block on the
    // network, and /end is idempotent (won't overwrite a settled row).
    if (errorReason && sid) {
      void fetch(`/api/translate/sessions/${sid}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: errorReason }),
      }).catch(() => {});
    }
    try {
      channelRef.current?.unsubscribe();
    } catch {}
    channelRef.current = null;
    // Drop the listener-presence subscription with the session — viewers
    // tear down on their own end, but clearing here stops the host panel
    // from showing stale listeners after a stop/error.
    setLiveSessionId(null);
    setListeners([]);
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
    // 🔊 Custom TTS: stop the synthesis queue (aborts in-flight fetches +
    // stops scheduled sources) and drop the monitor gain BEFORE the shared
    // AudioContext closes below.
    try {
      ttsQueueRef.current?.stop();
    } catch {}
    ttsQueueRef.current = null;
    try {
      ttsMonitorGainRef.current?.disconnect();
    } catch {}
    ttsMonitorGainRef.current = null;
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
    // 🚨 Auto-renewal teardown — stop the renewal clock + clear the in-flight
    // guard/indicator so a torn-down session never renews.
    sessionEpochRef.current = null;
    renewingRef.current = false;
    setRenewing(false);
    // 🚨 진행 중 크레딧 heartbeat teardown — 인터벌 정지 + tick 카운터 리셋
    // 이라 다음 세션이 tick 을 이어받지 않는다(status 전환 시 effect return 도
    // clear 하지만, 동기 teardown 경로에서 즉시 끊어 잔여 firing 을 막는다).
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    heartbeatTickRef.current = 0;
    heartbeatInFlightRef.current = false;
    heartbeatCappedRef.current = false;
    if (roomRef.current) {
      void roomRef.current.disconnect();
      roomRef.current = null;
    }
    for (const slot of ['mic', 'tab'] as const) {
      const el = monitorAudioRefs.current[slot];
      if (el) el.srcObject = null;
    }
  }, []);

  // 🚨 session-restart-loop diagnosis (pr-translate-session-restart-loop-
  // diagnosis). Unified structured telemetry for EVERY point a per-slot
  // pipeline is torn down or re-established mid-session. The rapid-fire
  // regression (a second OpenAI session retranscribing the same audio) is
  // always preceded by one of these; tagging each with a `reason` + the
  // session-epoch elapsed lets a SINGLE prod session pin WHICH path fired
  // (unexpected ICE/connection drop vs. server-side session close vs. the
  // scheduled auto-renewal) without a re-deploy. Pure telemetry — no
  // behaviour change. Also pushed as a Sentry breadcrumb so a user bug
  // report carries the restart trail, and includes the OLD/NEW session ids
  // when known so a session_id change is traceable across the handover.
  const logSessionRestart = useCallback(
    (
      slot: SourceSlot,
      reason:
        | 'connection_failed'
        | 'connection_disconnected'
        | 'ice_failed'
        | 'ice_disconnected'
        | 'dc_close_unexpected'
        | 'session_renewal',
      extra?: Record<string, unknown>,
    ) => {
      const epoch = sessionEpochRef.current;
      const payload = {
        slot,
        reason,
        session_id: sessionIdRef.current,
        // Whether a scheduled auto-renewal is in flight — distinguishes a
        // benign renewal handover from an unexpected drop at the same
        // instant (both can flip connection/ICE state).
        renewing: renewingRef.current,
        // Elapsed since the WHOLE translate session went live (visible timer).
        elapsed_ms: startedAtRef.current ? Date.now() - startedAtRef.current : 0,
        // Elapsed within the CURRENT OpenAI session epoch — a drop right at
        // ~25-30 min points at the server hard-close / renewal boundary.
        session_epoch_ms: epoch ? Date.now() - epoch : 0,
        ...extra,
      };
      console.info('[translate] session_restart', payload);
      Sentry.addBreadcrumb({
        category: 'translate.restart',
        message: `session_restart:${reason}`,
        level: reason.endsWith('failed') ? 'warning' : 'info',
        data: payload,
      });
    },
    [],
  );

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
        el.muted = !outputAudible || echoMutedRef.current;
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

  // Part B — periodic Korean re-split of already-committed lines. Layer A
  // (joinDelta + live reSpaceKoreanLine) fixes seams as they stream, but a
  // fusion that landed inside a delta committed before this heuristic saw
  // it — or a line built through an alternate pushLine path — can still be
  // fused on screen. A cheap 5s sweep rescans every final line and splits
  // any residual 종결어미 seam. reSpaceKoreanLine is idempotent, so a clean
  // line yields an identical string and we skip the state update (no
  // re-render churn). The server LLM postprocess (Layer D) still owns the
  // exact fix at session end.
  useEffect(() => {
    const sweep = (
      setter: React.Dispatch<React.SetStateAction<CaptionLine[]>>,
    ): void => {
      setter((prev) => {
        let mutated = false;
        const nextLines = prev.map((line) => {
          if (!line.final) return line;
          const respaced = reSpaceKoreanLine(line.text);
          if (respaced === line.text) return line;
          mutated = true;
          return { ...line, text: respaced };
        });
        return mutated ? nextLines : prev;
      });
    };
    const id = setInterval(() => {
      sweep(setInputLines);
      sweep(setOutputLines);
    }, 5000);
    return () => clearInterval(id);
  }, []);

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

  // 🚨 Register a self_echo detection (Fix 2). Bumps the burst counter and,
  // once ECHO_BURST_THRESHOLD echoes land inside ECHO_BURST_WINDOW_MS, raises
  // the headphone banner and temporarily mutes the LOCAL monitor to break the
  // acoustic loop. The mic is NEVER touched (half-duplex mute forbidden). The
  // mute auto-clears after ECHO_MUTE_MS, extended on each fresh echo, so audio
  // returns once the loop stops.
  const registerSelfEcho = useCallback((wall: number) => {
    const events = echoEventsRef.current.filter(
      (ts) => wall - ts <= ECHO_BURST_WINDOW_MS,
    );
    events.push(wall);
    echoEventsRef.current = events;
    if (events.length < ECHO_BURST_THRESHOLD) return;
    setEchoDetected(true);
    echoMutedRef.current = true;
    setEchoMuted(true);
    if (echoMuteTimerRef.current) clearTimeout(echoMuteTimerRef.current);
    echoMuteTimerRef.current = setTimeout(() => {
      echoMutedRef.current = false;
      setEchoMuted(false);
      echoMuteTimerRef.current = null;
    }, ECHO_MUTE_MS);
  }, []);

  // Speaker mapping is now slot-driven (mic → host, tab → guest). For
  // single-mode sessions the slot is fixed by captureMode; for `both`
  // mode each delta routes through the slot that emitted it. The
  // mapping is a pure lookup (`SLOT_SPEAKER[slot]`) so each callback
  // can derive its speaker from the slot it's bound to without
  // capturing a stale closure value.

  // 🚨 Fragment merge (Fix 2) — commit a deferred short INPUT shard through
  // the SAME dedup → echo → push/persist/publish path the inline
  // SENTENCE_END branch uses. Kept as its own callback so the debounce flush
  // can't diverge from the live commit. MUST stay in lockstep with the input
  // arm of the SENTENCE_END `if (finalText)` block below.
  const commitInputFinal = useCallback(
    (
      slot: SourceSlot,
      id: string,
      finalText: string,
      lang: string,
      speaker: 'host' | 'guest',
      startedAt: number,
    ) => {
      const wall = Date.now();
      const dedupKey = normalizeForDedup(finalText);
      const bucket = recentFinalsRef.current[slot].input;
      const fresh = bucket.filter((e) => wall - e.ts <= DEDUP_WINDOW_MS);
      const dup = dedupKey.length > 0 ? matchDedupRule(dedupKey, fresh) : null;
      const echoMatch =
        !dup && dedupKey.length > 0
          ? matchEcho(
              dedupKey,
              recentOutputEchoRef.current.filter(
                (e) => wall - e.ts <= ECHO_WINDOW_MS,
              ),
            )
          : null;
      const ctr = fidelityCountersRef.current.input;
      if (dup) {
        if (dup.rule === 'fuzzy') ctr.fuzzyDrops++;
        else if (dup.rule === 'containment') ctr.containmentDrops++;
        else ctr.lcsDrops++;
        ctr.droppedChars += finalText.length;
        console.info('[translate] dedup (merge-flush)', {
          slot,
          kind: 'input',
          rule: dup.rule,
          dropped: finalText,
          matched: dup.matched,
        });
        setInputLines((prev) => prev.filter((l) => l.id !== id));
        return;
      }
      if (echoMatch) {
        ctr.selfEchoDrops++;
        ctr.droppedChars += finalText.length;
        console.info('[translate] self_echo drop (merge-flush)', {
          slot,
          dropped: finalText,
          matched: echoMatch,
        });
        registerSelfEcho(wall);
        setInputLines((prev) => prev.filter((l) => l.id !== id));
        return;
      }
      fresh.push({ key: dedupKey, ts: wall });
      recentFinalsRef.current[slot].input = fresh;
      const finalLine: CaptionLine = {
        id,
        text: finalText,
        final: true,
        ts: wall,
        speaker,
      };
      pushLine('input', finalLine);
      broadcastCaption('input', finalLine, lang);
      void persistMessage('input', finalText, lang, speaker);
      transcriptPublisher.publishSegment({
        id,
        text: finalText,
        started_at: startedAt,
        ended_at: wall,
        locale: lang,
      });
    },
    [broadcastCaption, persistMessage, pushLine, registerSelfEcho, transcriptPublisher],
  );

  // Fix 2 — the debounce window elapsed with no follow-up delta, so the
  // parked shard was a genuine standalone utterance; commit it.
  const flushInputMerge = useCallback(
    (slot: SourceSlot) => {
      mergeTimerRef.current[slot] = null;
      const pending = pendingInputMergeRef.current[slot];
      if (!pending) return;
      pendingInputMergeRef.current[slot] = null;
      commitInputFinal(
        slot,
        pending.id,
        pending.text,
        pending.lang,
        pending.speaker,
        pending.startedAt,
      );
    },
    [commitInputFinal],
  );

  // Fix 2 — park a short input shard for MERGE_DEBOUNCE_MS instead of
  // committing it now. The preview row (id) already renders on screen, so we
  // just arm the flush timer and remember the shard.
  const scheduleInputMerge = useCallback(
    (
      slot: SourceSlot,
      id: string,
      text: string,
      lang: string,
      speaker: 'host' | 'guest',
      wall: number,
    ) => {
      const startedAt = inputLineStartedAtRef.current.get(id) ?? wall;
      const existingTimer = mergeTimerRef.current[slot];
      if (existingTimer) clearTimeout(existingTimer);
      pendingInputMergeRef.current[slot] = { id, text, lang, speaker, startedAt };
      fidelityCountersRef.current.input.mergeDeferrals++;
      mergeTimerRef.current[slot] = setTimeout(
        () => flushInputMerge(slot),
        MERGE_DEBOUNCE_MS,
      );
    },
    [flushInputMerge],
  );

  const appendStreaming = useCallback(
    (slot: SourceSlot, kind: 'input' | 'output', delta: string, lang: string) => {
      if (!delta) return;
      const speaker = SLOT_SPEAKER[slot];
      const partialBag = kind === 'input' ? partialInputRef : partialOutputRef;
      const wall = Date.now();

      // 🚨 Fragment merge (Fix 2) — FOLD. A short input shard is parked
      // awaiting merge and the speaker just continued (this delta arrived
      // inside the debounce window): seed the rolling partial with the parked
      // text — terminal punctuation stripped so it doesn't re-trigger a
      // sentence boundary — and let the normal accumulation below merge them
      // into one committed line. Reuses the shard's caption id + started_at so
      // no orphaned partial row is left behind. Runs before turn detection so
      // the folded text becomes `existing`; the shard's last delta was ≤
      // MERGE_DEBOUNCE_MS ago, well under TURN_SILENCE_MS, so it won't be
      // mistaken for a stale turn.
      if (kind === 'input') {
        const pendingMerge = pendingInputMergeRef.current[slot];
        if (pendingMerge) {
          const timer = mergeTimerRef.current[slot];
          if (timer) clearTimeout(timer);
          mergeTimerRef.current[slot] = null;
          pendingInputMergeRef.current[slot] = null;
          partialBag.current[slot] = {
            id: pendingMerge.id,
            text: stripTerminalPunct(pendingMerge.text),
          };
          inputLineStartedAtRef.current.set(pendingMerge.id, pendingMerge.startedAt);
          fidelityCountersRef.current.input.mergeFolds++;
        }
      }

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
        // 🚨 Cross-channel echo gate: an INPUT final that matches a recent
        // OUTPUT final is our own TTS re-entering the mic/tab. Only checked
        // when same-channel dedup didn't already claim it.
        const echoMatch =
          !dup && kind === 'input' && turnKey.length > 0
            ? matchEcho(
                turnKey,
                recentOutputEchoRef.current.filter(
                  (e) => wall - e.ts <= ECHO_WINDOW_MS,
                ),
              )
            : null;
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
        } else if (echoMatch) {
          // Self-echo: drop silently (no display, no broadcast, no persist)
          // and feed the loop-breaker. Do NOT add it to recentFinals — it's
          // not real speech.
          ctr.selfEchoDrops++;
          ctr.droppedChars += turnText.length;
          console.info('[translate] self_echo drop (turn-silence)', {
            slot,
            dropped: turnText,
            matched: echoMatch,
          });
          registerSelfEcho(wall);
          setInputLines((prev) => prev.filter((l) => l.id !== existing.id));
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
          // Feed the cross-channel echo buffer with committed OUTPUT finals
          // so a later input echo can be matched against them.
          if (kind === 'output') {
            const echoBuf = recentOutputEchoRef.current.filter(
              (e) => wall - e.ts <= ECHO_WINDOW_MS,
            );
            echoBuf.push({ key: turnKey, ts: wall });
            recentOutputEchoRef.current = echoBuf;
            // 🔊 Custom TTS: synthesize this committed translation. In a
            // dual-source session the originating slot picks a distinct voice
            // (mic=host → A, tab=guest → B); single-source sessions pass no
            // slot and keep the base voice. Queue preserves commit order.
            if (CUSTOM_TTS_ENABLED) {
              const voiceSlot =
                runningCaptureModeRef.current === 'both' ? slot : undefined;
              ttsQueueRef.current?.enqueue(turnText, lang, voiceSlot);
            }
          }
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
      // joinDelta only inspects the prev/delta seam; a Korean sentence
      // fusion that arrives *inside* one delta ("잡티예요이제" in a single
      // fragment) is invisible to it. reSpaceKoreanLine rescans the whole
      // joined line and splits those interior seams too, so the live
      // caption is de-fused immediately instead of waiting for the 5s
      // committed-line sweep below. Idempotent, so double-processing the
      // boundary joinDelta already spaced is a no-op.
      const next = reSpaceKoreanLine(joinDelta(current.text, delta));
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
          // 🚨 Fragment merge (Fix 2) — DEFER. A very short input shard that
          // lands on a sentence boundary with nothing after it (remainder
          // empty) is the VAD over-split symptom (~17% of input lines were
          // ≤4-char shards). Park it for MERGE_DEBOUNCE_MS instead of
          // committing: if the speaker continues the fold above merges it into
          // that utterance, otherwise the debounce timer commits it standalone
          // via commitInputFinal (same dedup/echo path). Only ≤ MERGE_MAX_CHARS
          // input shards qualify, so normal sentence splitting, echo, and
          // dedup on real lines are untouched. Show the shard as a live
          // preview row meanwhile so the prompter doesn't stall.
          if (
            kind === 'input' &&
            !remainder &&
            stripTerminalPunct(finalText).length <= MERGE_MAX_CHARS
          ) {
            scheduleInputMerge(slot, current.id, finalText, lang, speaker, wall);
            partialBag.current[slot] = null;
            const previewLine: CaptionLine = {
              id: current.id,
              text: finalText,
              final: false,
              ts: wall,
              speaker,
            };
            pushLine('input', previewLine);
            publishInput(finalText, undefined);
            return;
          }
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
          // 🚨 Cross-channel echo gate: an INPUT final matching a recent
          // OUTPUT final is our own TTS echoing back through the mic/tab.
          // Only checked when same-channel dedup didn't already claim it.
          const echoMatch =
            !dup && kind === 'input' && dedupKey.length > 0
              ? matchEcho(
                  dedupKey,
                  recentOutputEchoRef.current.filter(
                    (e) => wall - e.ts <= ECHO_WINDOW_MS,
                  ),
                )
              : null;
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
          } else if (echoMatch) {
            // Self-echo: drop silently (no display, no broadcast, no persist,
            // NOT added to recentFinals) and feed the loop-breaker.
            const ctr = fidelityCountersRef.current.input;
            ctr.selfEchoDrops++;
            ctr.droppedChars += finalText.length;
            console.info('[translate] self_echo drop', {
              slot,
              dropped: finalText,
              matched: echoMatch,
            });
            registerSelfEcho(wall);
            setInputLines((prev) => prev.filter((l) => l.id !== current.id));
          } else {
            fresh.push({ key: dedupKey, ts: wall });
            recentFinalsRef.current[slot][kind] = fresh;
            // Feed the cross-channel echo buffer with committed OUTPUT
            // finals so a later input echo can be matched against them.
            if (kind === 'output') {
              const echoBuf = recentOutputEchoRef.current.filter(
                (e) => wall - e.ts <= ECHO_WINDOW_MS,
              );
              echoBuf.push({ key: dedupKey, ts: wall });
              recentOutputEchoRef.current = echoBuf;
              // 🔊 Custom TTS: synthesize this committed translation. In a
              // dual-source session the originating slot picks a distinct
              // voice (mic=host → A, tab=guest → B); single-source sessions
              // pass no slot and keep the base voice. Order preserved.
              if (CUSTOM_TTS_ENABLED) {
                const voiceSlot =
                  runningCaptureModeRef.current === 'both' ? slot : undefined;
                ttsQueueRef.current?.enqueue(finalText, lang, voiceSlot);
              }
            }
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
    [
      broadcastCaption,
      persistMessage,
      pushLine,
      registerSelfEcho,
      scheduleInputMerge,
      transcriptPublisher,
    ],
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
        // 🚨 Silence-hallucination gate (Fix 1). gpt-4o-transcribe invents
        // stock English interjections ("Goodbye", "Okay.") during silence in
        // CJK-source sessions — the translations config can't pin the source
        // language server-side (400), so this client text gate is the only
        // layer that can catch it (same structure as the echo gate). Drop the
        // fragment here before it pollutes the caption / transcript. Counted
        // as delta chars first so the fidelity loss ratio REFLECTS the drop
        // instead of silently masking it (mirrors the japanese-fallback guard
        // above), plus a dedicated counter so an over-eager gate is
        // observable in the loss report. Three-gate (script + length +
        // dictionary) keeps real speech and code-switching ("Amazon"/"Notion")
        // intact; only CJK source sessions are guarded (en/es "Okay" is real).
        if (looksSilenceHallucination(delta, sourceLang)) {
          fidelityCountersRef.current.input.deltaChars += delta.length;
          fidelityCountersRef.current.input.silenceHallucinationDrops++;
          console.warn('[translate] silence-hallucination drop (CJK source)', {
            slot,
            sourceLang,
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
    // 미선택 게이트 — 원어/번역/캡처 중 하나라도 안 골랐으면 시작 금지
    // (프로빙 #536 미러). CTA 는 이미 disabled 지만 키보드/재진입 대비 방어.
    // 이 가드가 통과하면 아래에서 captureMode 가 CaptureMode 로 narrow 된다.
    if (!captureMode || !sourceLang || !targetLang) return;
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
    // 위젯 동시사용 게이트 — 슬롯 획득. 정원 초과면 카드에 국소 대기 UI 가
    // 뜨고 admitted 로 바뀔 때까지 여기서 보류된다(자동 진행). 취소 시 false.
    const admitted = await gate.acquire();
    if (!admitted) {
      startInFlightRef.current = false;
      return;
    }
    // RESET dedup memory on every Start (per-slot per-kind buckets).
    // Cross-session dedup proved too brittle — see the original PR
    // comment kept below for context.
    recentFinalsRef.current = {
      mic: { input: [], output: [] },
      tab: { input: [], output: [] },
    };
    // 🚨 Reset cross-channel echo state each session — a stale output buffer
    // or a lingering banner/mute from a prior session must not carry over.
    recentOutputEchoRef.current = [];
    echoEventsRef.current = [];
    if (echoMuteTimerRef.current) {
      clearTimeout(echoMuteTimerRef.current);
      echoMuteTimerRef.current = null;
    }
    echoMutedRef.current = false;
    setEchoMuted(false);
    setEchoDetected(false);
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
    // 🚨 Fix 2: drop any parked shard + its debounce timer from a prior
    // session so it can't flush a stale fragment into the new one.
    for (const s of ['mic', 'tab'] as const) {
      const timer = mergeTimerRef.current[s];
      if (timer) clearTimeout(timer);
    }
    mergeTimerRef.current = emptySlotRecord(null);
    pendingInputMergeRef.current = emptySlotRecord(null);
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
    // Record the running mode so appendStreaming can decide whether the
    // 2-voice slot mapping applies (dual-source only).
    runningCaptureModeRef.current = captureModeAtStart;

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
      cleanup('start_error_webrtc', 'translate_timeout');
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
      // 차감 broadcast (optimistic) — 세션 생성 즉시 start lump(75) 만큼 우측
      // 상단을 -N count-down (연결 대기 동안 즉각 피드백). 실제 과금은 go-live 의
      // /start 가 하고, 그 응답 balance 로 아래에서 authoritative 재동기화한다
      // (하이브리드 C). 연결 실패 시 서버는 미과금이라 다음 refresh 에 self-heal.
      notifyDeduction('translate', TRANSLATE_START_LUMP_CREDITS);
      // Analytics — 통역 세션 시작. capture_mode 는 표준 job_started 스키마에
      // metadata 필드가 없어(spec 2/6 재사용, 미수정) 동반 widget_action 으로
      // 기록한다. 'mic-only'/'tab-only'/'both' → 'mic'/'tab'/'both' 정규화.
      trackEvent('job_started', { widget: 'translate', job_type: 'session' });
      trackEvent('widget_action', {
        widget: 'translate',
        action: 'session_start',
        metadata: {
          capture_mode:
            captureModeAtStart === 'mic-only'
              ? 'mic'
              : captureModeAtStart === 'tab-only'
                ? 'tab'
                : 'both',
        },
      });
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
    setLiveSessionId(bundle.session.id);
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
      // setSlotError already pinned the precise failure; promote the tab
      // slot's error to the top-level error so the user sees it.
      const reason =
        captureModeAtStart === 'tab-only'
          ? 'tab_audio_failed'
          : 'microphone_denied';
      setError(reason);
      setStatus('error');
      cleanup('start_error_mic', reason);
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
      cleanup('start_error_webrtc', 'webrtc_failed');
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

    // 4.5) 🔊 Custom fixed-voice TTS pipeline. Build the session queue now
    //      that the output mixer (`audioDestRef` → LiveKit publish) and the
    //      recording dest exist. Each synthesized sentence fans out to:
    //        - audioDestRef        → LiveKit 'output' publish (viewers)
    //        - recordOutputDest    → recording (the 통역본 deliverable)
    //        - a local monitor gain → ctx.destination (host speakers)
    //      The model's own audio track is dropped in pc.ontrack below. When
    //      the kill-switch is off this whole block is skipped and the model
    //      audio flows as before.
    if (CUSTOM_TTS_ENABLED) {
      try {
        const monitorGain = ctx.createGain();
        monitorGain.gain.value = outputAudible && !echoMutedRef.current ? 1 : 0;
        monitorGain.connect(ctx.destination);
        ttsMonitorGainRef.current = monitorGain;
        const dests: AudioNode[] = [
          audioDestRef.current,
          recordOutputDestRef.current,
          monitorGain,
        ].filter((n): n is MediaStreamAudioDestinationNode | GainNode => n !== null);
        ttsQueueRef.current = createTtsQueue({
          ctx,
          destinations: dests,
          getSessionId: () => sessionIdRef.current,
        });
      } catch (err) {
        console.warn('[translate] custom TTS init failed', err);
        ttsQueueRef.current = null;
      }
    }

    // 5) LiveKit connect + publish ONE 'input' track (mixed across
    //    live slots). The translated 'output' publish lands later when
    //    the first slot's ontrack fires — same as the legacy single
    //    pipeline, just gated against the shared mixer. With custom TTS
    //    the model's ontrack no longer feeds the mixer, so we publish the
    //    (custom-fed) output mixer track right here instead.
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
      // 🔊 Custom TTS: publish the output mixer track NOW (independent of the
      // model's ontrack, which we ignore). The MediaStreamDestination already
      // has a live — initially silent — track; synthesized sentences feed it
      // as output finals commit, and viewers subscribed to 'output' hear the
      // fixed voice with no viewer-side change.
      if (CUSTOM_TTS_ENABLED && !outputPublishedRef.current) {
        const outDest = audioDestRef.current;
        const outTrack = outDest?.stream.getAudioTracks()[0];
        if (outTrack) {
          try {
            outputPublishedRef.current = true;
            await room.localParticipant.publishTrack(
              new LocalAudioTrack(outTrack),
              { name: 'output' },
            );
            console.info('[translate] livekit output published (custom TTS)');
          } catch (err) {
            console.warn('[translate] custom TTS output publish failed', err);
            outputPublishedRef.current = false;
          }
        }
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'livekit_failed';
      setError(reason);
      setStatus('error');
      cleanup('start_error_livekit', reason);
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
      // 🚨 renewal=true when called from renewSession(): the shared output /
      // recording mixers already have this slot's OLD source node wired, so
      // the ontrack handler REPLACES it instead of skipping (see below). The
      // LiveKit publish + mixer destinations are unchanged, so viewers +
      // recording carry through the handover with no re-publish.
      renewal = false,
      // Abort budget for the OpenAI SDP POST — the cold-start bottleneck. A hang
      // here (agent still loading) becomes a retryable failure instead of the
      // whole start() silently blowing the global watchdog. Warm callers
      // (renewal) keep the default; the cold-start retry wrapper passes shorter
      // budgets on later attempts.
      sdpTimeoutMs: number = SLOT_CONNECT_TIMEOUT_MS,
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
            // Only clear the active indicator if THIS pc is still the live one
            // for the slot. During auto-renewal the OLD pc closes ~2s after
            // the NEW one connects; without this guard that close would wrongly
            // flip the slot inactive even though the new session is healthy.
            if (pcRef.current[slot] === pc) {
              setSlotActive((prev) => ({ ...prev, [slot]: false }));
              // 🚨 restart telemetry — only for the LIVE pc, and only for the
              // unexpected transitions. 'closed' is skipped: it fires on
              // intentional teardown (stop / renewal retire) and would drown
              // the signal. failed/disconnected on the live pc IS the
              // rapid-fire precursor (network blip → reconnect loop).
              if (pc.connectionState === 'failed') {
                logSessionRestart(slot, 'connection_failed');
              } else if (pc.connectionState === 'disconnected') {
                logSessionRestart(slot, 'connection_disconnected');
              }
            }
          }
        };
        pc.oniceconnectionstatechange = () => {
          console.info(`[translate:${slot}] pc.iceConnectionState`, pc.iceConnectionState);
          // 🚨 restart telemetry — ICE failed/disconnected on the LIVE pc is
          // the classic mid-session drop (candidate 1: WebRTC connection drop
          // → reconnect → retranscribe). Guard on the live pc so a retiring
          // renewal pc's ICE teardown doesn't log a phantom restart.
          if (pcRef.current[slot] === pc) {
            if (pc.iceConnectionState === 'failed') {
              logSessionRestart(slot, 'ice_failed');
            } else if (pc.iceConnectionState === 'disconnected') {
              logSessionRestart(slot, 'ice_disconnected');
            }
          }
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
          // 🔊 Custom fixed-voice TTS: the model's dynamic-voice audio is
          // intentionally DROPPED here — not attached to the host monitor,
          // not mixed into the LiveKit publish, not recorded. The 'output'
          // track was already published (step 5) and is fed by our own
          // sentence synthesis instead. Bail before any model-audio wiring.
          // (Kill-switch off → fall through to the legacy model path below.)
          if (CUSTOM_TTS_ENABLED) return;
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
            el.muted = !outputAudible || echoMutedRef.current;
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
          // On renewal the OLD source node for this slot is still connected to
          // the shared mixers — disconnect + drop it so the guards below re-wire
          // the NEW TTS stream. On the initial connect these refs are null and
          // this is a no-op.
          if (renewal) {
            try {
              audioSourceRef.current[slot]?.disconnect();
            } catch {}
            audioSourceRef.current[slot] = null;
            try {
              recordOutputSrcRef.current[slot]?.disconnect();
            } catch {}
            recordOutputSrcRef.current[slot] = null;
          }
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
        dc.onclose = () => {
          console.info(`[translate:${slot}] dc close`);
          // 🚨 restart telemetry — an OpenAI data channel closing while it is
          // still the LIVE dc and we are NOT renewing means the SERVER closed
          // the session (candidate 5: OpenAI timeout / rate limit / ~30 min
          // hard cap the renewal didn't beat). That's the retranscribe
          // trigger. dc closes from stop()/renewal-retire are intentional and
          // filtered out by these two guards.
          if (dcRef.current[slot] === dc && !renewingRef.current) {
            logSessionRestart(slot, 'dc_close_unexpected');
          }
        };
        dc.onerror = (ev) => console.warn(`[translate:${slot}] dc error`, ev);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.info(`[translate:${slot}] sdp offer ready, posting to openai`, {
          sdpTimeoutMs,
        });
        // Bound the cold-start SDP wait so a slow/hung agent-join aborts and
        // becomes retryable (caught below → returns false → retry wrapper),
        // instead of stalling the whole start() until the global watchdog.
        const sdpController = new AbortController();
        const sdpTimer = setTimeout(() => sdpController.abort(), sdpTimeoutMs);
        let sdpRes: Response;
        try {
          sdpRes = await fetch(
            'https://api.openai.com/v1/realtime/translations/calls',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${clientSecret}`,
                'Content-Type': 'application/sdp',
              },
              body: offer.sdp ?? '',
              signal: sdpController.signal,
            },
          );
        } finally {
          clearTimeout(sdpTimer);
        }
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
        // An aborted SDP POST is the cold-start budget elapsing, not a hard
        // fault — log it as such so the retry path reads cleanly in the console.
        const aborted = e instanceof DOMException && e.name === 'AbortError';
        if (aborted) {
          console.warn(
            `[translate:${slot}] agent-join timed out after ${sdpTimeoutMs}ms (cold start) — retryable`,
          );
        } else {
          console.warn(`[translate:${slot}] slot start failed`, e);
        }
        setSlotError((prev) => ({
          ...prev,
          [slot]: aborted ? 'translate_timeout' : e instanceof Error ? e.message : 'slot_failed',
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
    // Expose the boot closure so renewSession() can reuse the identical
    // connect path for a background handover.
    bootSlotRef.current = startSlot;

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

    // Mint a fresh single-use ephemeral for a retry attempt (reusing a spent
    // secret would 401). Returns null on failure so the caller can decide.
    const mintEphemeral = async (): Promise<string | null> => {
      try {
        const res = await fetch(
          `/api/translate/sessions/${bundle.session.id}/ephemeral`,
          { method: 'POST' },
        );
        if (!res.ok) throw new Error('ephemeral_failed');
        const j = (await res.json()) as {
          openai: { client_secret: { value: string } };
        };
        return j.openai.client_secret.value;
      } catch (e) {
        console.warn('[translate] retry ephemeral mint failed', e);
        return null;
      }
    };

    // 🚨 Transparent cold-start retry (the fix). On the very first start the
    // OpenAI Realtime agent is COLD (dispatch + model load), so its SDP answer
    // can miss the per-attempt budget even though room/signal is fine. Instead
    // of surfacing a WebRTC error — which used to force a manual "다시 시작" —
    // we retry the slot up to MAX_CONNECT_ATTEMPTS times with a short backoff.
    // The agent warms across attempts (same reason the manual retry always
    // worked), so a later try lands. Each retry mints a FRESH ephemeral (the
    // spent one is single-use). Status stays 'starting' ("연결 중…") the whole
    // time; the error only surfaces if every attempt fails.
    const startSlotWithRetry = async (
      slot: SourceSlot,
      initialSecret: string | null,
    ): Promise<boolean> => {
      let secret: string | null = initialSecret;
      for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt++) {
        if (!secret) secret = await mintEphemeral();
        if (secret) {
          const budget =
            attempt === 1 ? SLOT_CONNECT_TIMEOUT_MS : SLOT_CONNECT_RETRY_MS;
          const ok = await startSlot(slot, secret, false, budget);
          if (ok) {
            if (attempt > 1) {
              console.info(`[translate:${slot}] agent connected on attempt ${attempt}`);
            }
            return true;
          }
        }
        // Torn down mid-retry (user hit stop / global watchdog fired) — bail so
        // we don't spin against a dead session.
        if (!startInFlightRef.current) return false;
        // Force a fresh ephemeral for the next attempt (this one is spent).
        secret = null;
        if (attempt < MAX_CONNECT_ATTEMPTS) {
          const backoff = attempt * 400;
          console.info(
            `[translate:${slot}] agent cold-start — retry ${attempt}/${MAX_CONNECT_ATTEMPTS - 1} in ${backoff}ms`,
          );
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
      console.warn(`[translate:${slot}] agent-join failed after ${MAX_CONNECT_ATTEMPTS} attempts`);
      return false;
    };

    // Fire per-slot pipelines in parallel. Each Promise resolves a
    // boolean (true = up, false = failed). At least one must succeed
    // for the session to flip to 'live'.
    const slotResults = await Promise.all(
      liveSlots.map(async (slot) => startSlotWithRetry(slot, ephemeralForSlot[slot])),
    );
    const anySlotUp = slotResults.some((ok) => ok);
    if (!anySlotUp) {
      setError('webrtc_failed');
      setStatus('error');
      cleanup('start_error_webrtc', 'webrtc_failed');
      startInFlightRef.current = false;
      return;
    }

    // Race guard: if the global watchdog fired (or the host hit stop) while the
    // agent-join retries were in flight, startInFlightRef was cleared and
    // cleanup() already tore the session down. Don't resurrect it into 'live'
    // over the top of that error state — bail and leave the surfaced error.
    if (!startInFlightRef.current) {
      cleanup('start_error_webrtc');
      return;
    }

    // Supabase broadcast channel. Also the presence topic viewers track on
    // (/live/<token> calls channel.track on the same `live:<sessionId>`), so
    // the host reads the listener list straight off THIS channel — one
    // channel per topic. Presence handlers must be attached before
    // subscribe(); a second channel on the same topic would throw.
    const supa = createBrowserSupabase();
    const ch = supa.channel(`live:${bundle.session.id}`, {
      config: { broadcast: { self: false } },
    });
    const syncListeners = () =>
      setListeners(listenersFromPresence(ch.presenceState<ListenerPresence>()));
    ch.on('presence', { event: 'sync' }, syncListeners)
      .on('presence', { event: 'join' }, syncListeners)
      .on('presence', { event: 'leave' }, syncListeners);
    ch.subscribe();
    channelRef.current = ch;

    // Connect succeeded — disarm the watchdog before flipping live.
    if (connectWatchdogRef.current) {
      clearTimeout(connectWatchdogRef.current);
      connectWatchdogRef.current = null;
    }

    // Flip status='live' + stamp started_at on the row (go-live). Routed
    // through the server /start endpoint. 하이브리드 C: /start 는 go-live 이면서
    // **start lump 과금 지점**이라, 이제 응답(balance)을 기다려 우측 상단 잔액을
    // authoritative 값으로 재동기화한다(생성 시점 optimistic -75 를 확정값으로
    // 정렬). 잔액 부족(402)이면 go-live 를 거부하고 세션을 정리한다.
    try {
      const sres = await fetch(
        `/api/translate/sessions/${bundle.session.id}/start`,
        { method: 'POST' },
      );
      const sjson = (await sres.json().catch(() => null)) as {
        ok?: boolean;
        balance?: number;
        error?: string;
      } | null;
      if (sres.status === 402 || sjson?.error === 'insufficient_credits') {
        setError('insufficient_credits');
        setStatus('error');
        cleanup('start_error_credits', 'insufficient_credits');
        startInFlightRef.current = false;
        return;
      }
      // start lump 차감을 authoritative balance 로 우측 상단에 반영.
      notifyDeduction(
        'translate',
        TRANSLATE_START_LUMP_CREDITS,
        typeof sjson?.balance === 'number' ? sjson.balance : undefined,
      );
    } catch {
      // 네트워크 실패는 go-live 를 막지 않는다(best-effort). 표시만 잠시
      // 어긋나고, heartbeat/finalize 정산이 실오디오 기준으로 보정한다.
    }

    // 🚨 heartbeat 카운터 리셋 — tick 0(start lump)은 위 /start 가 과금했다.
    // 첫 10분 heartbeat 는 tick 1 로 시작한다.
    heartbeatTickRef.current = 0;
    heartbeatCappedRef.current = false;
    heartbeatInFlightRef.current = false;

    startedAtRef.current = Date.now();
    // 🚨 Auto-renewal epoch — the current OpenAI session started now. The
    // renewal interval (below) watches this, not startedAtRef.
    sessionEpochRef.current = Date.now();
    setStatus('live');
    startInFlightRef.current = false;
  }, [
    captureMode,
    cleanup,
    handleOaiEvent,
    logSessionRestart,
    outputAudible,
    sourceLang,
    targetLang,
    glossary,
    status,
    transcriptPublisher,
    notifyDeduction,
    gate,
  ]);

  // 시작 클릭 진입점 — tab 슬롯(브라우저 오디오 캡처)이 포함된 모드(both /
  // tab-only)는 캡처 직전 브라우저 오디오 안내를 blocking ack 로 띄운다.
  // mic-only(기기 마이크)는 브라우저 설정 무관이라 바로 진행. "다시 보지
  // 않기"로 억제됐으면 tab 경로도 바로 진행.
  const handleStartClick = useCallback(() => {
    const usesTab = !!captureMode && activeSlots(captureMode).includes('tab');
    if (usesTab && !isShareGuideSuppressed()) {
      setBrowserAudioNoticeOpen(true);
      return;
    }
    void start();
  }, [captureMode, start]);
  const handleShareGuideConfirm = useCallback(() => {
    setBrowserAudioNoticeOpen(false);
    void start();
  }, [start]);

  // 🚨 Session auto-renewal (graceful handover). Called by the interval below
  // when the current OpenAI session epoch approaches the ~30 min server cap.
  // For each active slot: fetch a fresh ephemeral, boot a NEW RTCPeerConnection
  // over the SAME source track (bootSlotRef with renewal=true re-wires the
  // shared output/recording mixers), then close the OLD pc ~2s later to catch
  // the last in-flight transcription. React transcript state is untouched, so
  // the host sees no discontinuity (<2s audio gap). On failure the still-open
  // old session keeps running (old-behaviour fallback) and we retry shortly.
  const renewSession = useCallback(async () => {
    if (renewingRef.current) return;
    const id = sessionIdRef.current;
    const boot = bootSlotRef.current;
    if (!id) return;
    const slots = (['mic', 'tab'] as const).filter((s) => pcRef.current[s]);
    if (slots.length === 0) return;

    renewingRef.current = true;
    setRenewing(true);
    const elapsedBefore = sessionEpochRef.current
      ? Date.now() - sessionEpochRef.current
      : 0;
    console.info('[translate] session_renew_start', {
      elapsed_ms: elapsedBefore,
      slots,
    });
    Sentry.addBreadcrumb({
      category: 'translate.renewal',
      message: 'session_renew_start',
      level: 'info',
      data: { session_id: id, elapsed_before_renew_ms: elapsedBefore, slots },
    });

    const renewOne = async (slot: SourceSlot): Promise<boolean> => {
      const oldPc = pcRef.current[slot];
      const oldDc = dcRef.current[slot];
      if (!oldPc) return false;
      // Fresh OpenAI ephemeral for the new session (same route the 2nd slot
      // uses at start).
      let cs: string | undefined;
      try {
        const res = await fetch(
          `/api/translate/sessions/${id}/ephemeral`,
          { method: 'POST' },
        );
        if (!res.ok) throw new Error(`ephemeral_${res.status}`);
        const sj = (await res.json()) as {
          openai?: { client_secret?: { value?: string } };
        };
        cs = sj.openai?.client_secret?.value;
        if (!cs) throw new Error('ephemeral_empty');
      } catch (e) {
        console.warn(`[translate:${slot}] renew ephemeral failed`, e);
        return false;
      }
      // Boot a fresh pc for this slot. bootSlotRef points at start()'s
      // startSlot closure; renewal=true makes its ontrack REPLACE the slot's
      // mixer nodes instead of skipping.
      const ok = await boot(slot, cs, true);
      if (!ok) {
        // boot()'s failure path closed the NEW pc and nulled pcRef[slot].
        // Restore the still-open OLD session so it keeps running until the
        // server hard-closes it (fallback = old behaviour). Clear the slot
        // error boot() set — the old session is still healthy.
        if (!pcRef.current[slot]) {
          pcRef.current[slot] = oldPc;
          dcRef.current[slot] = oldDc;
        }
        setSlotError((prev) => ({ ...prev, [slot]: null }));
        return false;
      }
      // 🚨 restart telemetry — a scheduled renewal IS a session restart, just
      // a graceful one. Log it in the same stream as the unexpected drops so
      // prod telemetry shows the FULL restart timeline (and can confirm the
      // renewal fired on time, ~25 min in, before any server hard-close).
      logSessionRestart(slot, 'session_renewal');
      // Success — pcRef[slot] is now the new pc. Retire the old one after a
      // short grace period so trailing transcription deltas + TTS tail still
      // land. Best-effort session.close so OpenAI tears down server-side.
      setTimeout(() => {
        try {
          oldDc?.send(JSON.stringify({ type: 'session.close' }));
        } catch {}
        try {
          oldDc?.close();
        } catch {}
        try {
          oldPc?.close();
        } catch {}
      }, 2000);
      return true;
    };

    let anyOk = false;
    try {
      const results = await Promise.all(slots.map((s) => renewOne(s)));
      anyOk = results.some(Boolean);
    } finally {
      if (anyOk) {
        // Restart the renewal clock from the new epoch.
        sessionEpochRef.current = Date.now();
        console.info('[translate] session_renew_done', { slots });
        Sentry.addBreadcrumb({
          category: 'translate.renewal',
          message: 'session_renew_done',
          level: 'info',
          data: { session_id: id, slots },
        });
      } else {
        // Nudge the epoch so the interval retries in ~RENEW_RETRY_MS instead of
        // every RENEW_CHECK_MS — a few more shots before the hard 30 min close.
        sessionEpochRef.current = Date.now() - (SESSION_MAX_MS - RENEW_RETRY_MS);
        console.warn(
          '[translate] session_renew_failed — keeping current session, will retry',
        );
        Sentry.addBreadcrumb({
          category: 'translate.renewal',
          message: 'session_renew_failed',
          level: 'warning',
          data: { session_id: id, slots },
        });
      }
      renewingRef.current = false;
      setRenewing(false);
    }
  }, [logSessionRestart]);

  // 🚨 Auto-renewal driver. While live, poll every RENEW_CHECK_MS; once the
  // current OpenAI session epoch crosses SESSION_MAX_MS (25 min, 5 min under
  // the ~30 min server cap) fire renewSession(). Sessions under 25 min never
  // reach the gate, so short sessions behave exactly as before (no regression).
  useEffect(() => {
    if (status !== 'live') return;
    const handle = setInterval(() => {
      const epoch = sessionEpochRef.current;
      if (!epoch) return;
      if (Date.now() - epoch >= SESSION_MAX_MS) {
        void renewSession();
      }
    }, RENEW_CHECK_MS);
    return () => clearInterval(handle);
  }, [status, renewSession]);

  // 🚨 진행 중 크레딧 heartbeat 드라이버 (하이브리드 C, docs §6). live 인 동안
  // HEARTBEAT_MS(기본 10분)마다 /heartbeat 를 다음 tick 으로 POST → blockCredits
  // 낙관적 차감 + 응답 balance 로 우측 상단 잔액 재동기화. 과금 성공에만 tick 을
  // 전진시켜(멱등) 일시 실패는 다음 인터벌이 같은 tick 을 재시도한다. cap 도달/
  // 세션 종료 응답이면 정지(세션은 계속 — finalize 가 실오디오로 최종 정산).
  // renewal 은 같은 sessionId 라 tick 이 누적 이어진다(재-start-lump 없음).
  useEffect(() => {
    if (status !== 'live') return;
    const handle = setInterval(() => {
      const id = sessionIdRef.current;
      if (!id) return;
      if (heartbeatCappedRef.current || heartbeatInFlightRef.current) return;
      const nextTick = heartbeatTickRef.current + 1;
      if (nextTick > TRANSLATE_MAX_BILLABLE_TICK) {
        heartbeatCappedRef.current = true; // 과금 상한 — 표시 정지, 세션 유지
        return;
      }
      heartbeatInFlightRef.current = true;
      void (async () => {
        try {
          const res = await fetch(
            `/api/translate/sessions/${id}/heartbeat`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tick_index: nextTick }),
            },
          );
          const json = (await res.json().catch(() => null)) as {
            ok?: boolean;
            capped?: boolean;
            ended?: boolean;
            balance?: number;
            error?: string;
          } | null;
          if (res.ok && json?.ok) {
            if (json.ended || json.capped) {
              heartbeatCappedRef.current = true; // 서버가 정지 신호 → 이후 과금 중단
              return;
            }
            // 과금 성공 — tick 전진 + 우측 상단 authoritative 반영.
            heartbeatTickRef.current = nextTick;
            notifyDeduction(
              'translate',
              TRANSLATE_METERING.blockCredits,
              typeof json.balance === 'number' ? json.balance : undefined,
            );
          } else if (res.status === 402) {
            // 잔액 부족 — 재시도해도 무의미하므로 tick 을 전진(같은 tick 무한
            // 반복 방지). 세션은 계속되고 finalize 가 실오디오로 최종 정산한다.
            heartbeatTickRef.current = nextTick;
          }
          // 그 외(네트워크/5xx) → tick 미전진, 다음 인터벌이 같은 tick 재시도(멱등).
        } catch {
          // 네트워크 실패 → tick 미전진, 다음 인터벌이 재시도(서버 멱등).
        } finally {
          heartbeatInFlightRef.current = false;
        }
      })();
    }, HEARTBEAT_MS);
    heartbeatTimerRef.current = handle;
    return () => {
      clearInterval(handle);
      if (heartbeatTimerRef.current === handle) heartbeatTimerRef.current = null;
    };
  }, [status, notifyDeduction]);

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
    // Analytics — 세션 duration 을 teardown 전에 확정 (cleanup 이
    // startedAtRef 를 null 로 만들기 전에 계산). ref 라 closure staleness 없음.
    const sessionDurationMs = startedAtRef.current
      ? Math.max(0, Date.now() - startedAtRef.current)
      : 0;
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
        // 🚨 cross-channel echo gate: input finals dropped as self-echo.
        selfEchoDrops: c.selfEchoDrops,
        // 🚨 silence-hallucination gate (Fix 1) + fragment merge (Fix 2).
        silenceHallucinationDrops: c.silenceHallucinationDrops,
        mergeDeferrals: c.mergeDeferrals,
        mergeFolds: c.mergeFolds,
        lossRatio: ratio,
      };
      // Report on any diagnostic signal, not just threshold breach — a
      // session under the 5% loss bar can still reveal which heuristic is
      // dropping content or whether turn-silence is chopping sentences.
      const hasDiagnosticSignal =
        c.droppedChars > 0 ||
        c.midSentenceCommits > 0 ||
        c.selfEchoDrops > 0 ||
        c.silenceHallucinationDrops > 0;
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

    trackEvent('job_completed', {
      widget: 'translate',
      job_type: 'session',
      duration_ms: sessionDurationMs,
    });

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
      // Clear the echo loop-breaker's auto-unmute timer so it can't fire a
      // setState on the unmounted component.
      if (echoMuteTimerRef.current) clearTimeout(echoMuteTimerRef.current);
      // 🚨 Fix 2: clear any pending fragment-merge flush timers so they can't
      // fire a setState / commit on the unmounted component.
      for (const s of ['mic', 'tab'] as const) {
        const timer = mergeTimerRef.current[s];
        if (timer) clearTimeout(timer);
      }
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

  // 통역 시작 (live 진입) 순간 공유 링크 자동 생성 — 별도 "생성" 버튼 없이
  // 프롬프터 상단 음성 버튼 오른쪽에 URL 을 바로 노출. live 세션당 1회만
  // 발동하도록 ref 로 가드 (host 가 revoke 하면 재생성 안 함), 세션이
  // idle/ended/error 로 내려가면 다음 세션을 위해 플래그 리셋.
  const autoSharedRef = useRef(false);
  useEffect(() => {
    if (status === 'live') {
      if (!autoSharedRef.current) {
        autoSharedRef.current = true;
        void generateShare();
      }
    } else if (status === 'idle' || status === 'ended' || status === 'error') {
      autoSharedRef.current = false;
    }
  }, [status, generateShare]);

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

  // Publish a read-only snapshot up to TranslateSessionProvider (mounted by
  // the canvas card) so the fullview modal can mirror the live session
  // WITHOUT hosting the session itself. No-op when no provider is mounted
  // (standalone /live). This only reads state the console already computes —
  // it never touches the session lifecycle, which is the whole point of the
  // fullview-session-preserve fix.
  const publishSession = useTranslateSessionPublisher();
  useEffect(() => {
    publishSession({
      sessionId: liveSessionId,
      shareUrl,
      isLive: status === 'live',
      promptedLines,
      listeners,
    });
  }, [publishSession, liveSessionId, shareUrl, status, promptedLines, listeners]);

  // idle(시작 전) 여부 — starting/error 도 시작 CTA 가 노출되는 "세션 전"
  // 화면이므로 idle launcher layout 을 공유한다 (starting 에 layout 이
  // 점프하지 않고, error 후 재시도도 동일 보드에서). live/ending/ended 는
  // 기존 layout 그대로 (자막 스트리밍 / 다운로드 패널 = 이 spec 밖).
  const idlePhase =
    status === 'idle' || status === 'starting' || status === 'error';

  // 통역 시작 게이트 — 원어/번역/캡처 3개 모두 선택돼야 CTA 활성 (프로빙 #536
  // 미러). 미선택('')이면 비활성. busy 는 각 CTA 에서 별도 OR.
  const canStart = Boolean(captureMode && sourceLang && targetLang);

  // V2 세팅 아코디언 (PR-B) — idle/setup 전용. live 표면은 감싸지 않는다(회귀 0).
  // active-step 상태 + 프로젝트명 해석(STEP1 done 요약).
  const setupAccordion = useWidgetAccordion();
  const { projects: v2Projects } = useInterviewV2Projects();

  // 원어/대상어/입력 모드 + Glossary — idle 센터 보드와 live 상단 고정 바가
  // 공유하는 필드 묶음 (probing ControlFields 패턴).
  const controlFields = (
    <>
      {/* 프로젝트 / 언어 / 입력 소스 — 한 행 배치. flex flex-wrap items-end
          gap-4 로 세 컨트롤을 좌측 정렬하고 좁은 폭에서 wrap 허용(전사록 #964
          미러). live 중엔 행 전체 잠금(결정 3: 세션 중 Glossary/언어/모드 불변)
          — 행 opacity-60 으로 read-only 신호, 프로젝트는 pointer-events 차단
          (#543 위젯 슬롯 독립 선택 — 고른 프로젝트의 glossary 를 DB 에서
          로드/저장, onChange 무시), 언어/입력 소스는 trigger disabled.
          원어/대상어는 단일 "언어" LangDualDropdown 으로 통합(2컬럼 인풋|아웃풋,
          2026-07-10) — state·게이트·payload·번역 로직 전부 무변경, UI 포장만.
          controlFields 는 idle 센터 보드와 live 상단 바가 공유 → 양쪽 동시 반영.
          드롭다운 간 간격·정렬(items-end)은 ControlBoardPanel.Settings 슬롯 SSOT
          (SETTINGS_ROW_GAP) — 손코딩 flex gap 제거. live opacity-60 은 상태
          신호라 className 으로 슬롯에 전달(layout 아님). */}
      <ControlBoardPanel.Settings className={live ? 'opacity-60' : undefined}>
        <Field label={t('project')}>
          <div
            className={live ? 'pointer-events-none' : undefined}
            aria-disabled={live || undefined}
          >
            <ProjectPicker
              widget="translate"
              value={projectId}
              onChange={live ? () => {} : handleProjectChange}
            />
          </div>
        </Field>
        <Field label={t('lang')}>
          <LangDualDropdown
            langs={langOptions}
            sourceLang={sourceLang}
            targetLang={targetLang}
            onSelectSource={setSourceLang}
            onSelectTarget={setTargetLang}
            placeholder={t('select')}
            inputLabel={t('inputLang')}
            outputLabel={t('outputLang')}
            triggerLabel={t('lang')}
            disabled={busy || live}
          />
        </Field>
        {/* 캡처모드 = 유스케이스 3-카드 (CaptureUseCaseCards 공유 프리미티브,
            probing 과 동일 컴포넌트). 옛 DropdownMenu 를 대체 — 추상
            mic-only/tab-only/both 를 인터뷰 방식 + 화자 라우팅으로 재표현.
            값 매핑: mic-only→오프라인, both→온라인(진행자 mic + 응답자 tab
            화자분리), tab-only→참관. captureMode 값·activeSlots·세션 로직
            전부 불변. both 비용경고(bothCostHint)는 '온라인' 카드 선택 시
            note 로 노출(기존 키 재사용). 카드는 넓어 flex 행에서 자기 줄
            차지하도록 w-full. */}
        <div className="w-full">
          <Field label={tc('sectionLabel')}>
            <CaptureUseCaseCards
              ariaLabel={tc('groupAria')}
              value={captureMode}
              onChange={(id) => setCaptureMode(id as CaptureMode)}
              disabled={busy || live}
              options={CAPTURE_USECASE_OPTIONS}
            />
          </Field>
        </div>
      </ControlBoardPanel.Settings>

      {/* Glossary (Layer B) — 인명/도구명/약어의 정규 표기. 한 줄에 하나씩
          입력 후 "적용" 으로 반영(프로빙 조사목적 패턴). 세션 시작 전에만
          편집 (live 중 disabled). 라벨↔컨트롤 간격은 .Input(Field mb-1.5) SSOT. */}
      <ControlBoardPanel.Input label={t('glossary.label')}>
        <GlossaryField
          values={glossary}
          onChange={handleGlossaryChange}
          disabled={busy || live}
          ariaLabel={t('glossary.label')}
          placeholder={t('glossary.placeholder')}
          applyLabel={t('glossary.apply')}
          applyTitle={t('glossary.applyTitle')}
          dirtyNotice={t('glossary.dirtyNotice')}
        />
      </ControlBoardPanel.Input>
    </>
  );

  // V2 세팅 아코디언 (PR-B, idle 전용) — 위 controlFields 의 평면 리스트를
  // 유스케이스 4-스텝으로 재구성. 필드 컴포넌트(ProjectPicker/LangDualDropdown/
  // CaptureUseCaseCards/GlossaryField)는 그대로 재사용, 스텝 셸만 씌운다.
  // ④ 라이브 인플레이스: live 표면(controlFields active + WidgetOutputRegion)은
  // 이 아코디언 밖 — 회귀 0. 펼침: 전체 오픈 기본(미완 펼침, 완료 요약 접힘).
  const langLabelOf = (v: string) =>
    langOptions.find((l) => l.value === v)?.label ?? v;
  const projectName =
    v2Projects.find((p) => p.id === projectId)?.name ??
    t('setup.step1Selected');
  // 크로스위젯 "일괄 적용" 반영(프로토 A.1) — 등장한 모든 위젯 선택이 이 위젯의
  // 프로젝트와 동일하면 STEP1 done 요약에 "· 일괄" 태그. applyToAll 로 맞춰진 상태.
  const selectionValues = Object.values(selection);
  const projectAppliedToAll =
    projectId != null &&
    selectionValues.length > 0 &&
    selectionValues.every((v) => v === projectId);
  const projectSummary = projectAppliedToAll
    ? `${projectName} · ${t('setup.step1BulkTag')}`
    : projectName;
  const captureTitle =
    CAPTURE_USECASE_OPTIONS.find((o) => o.id === captureMode)?.title ?? '';

  const setupSteps: AccordionStepConfig[] = [
    {
      key: 'project',
      eyebrow: t('setup.stepEyebrow', { n: 1, label: t('setup.step1Short') }),
      title: t('setup.step1Title'),
      summary: projectSummary,
      body: (
        <Field label={t('project')}>
          <ProjectPicker
            widget="translate"
            value={projectId}
            onChange={handleProjectChange}
          />
        </Field>
      ),
    },
    {
      key: 'method',
      eyebrow: t('setup.stepEyebrow', { n: 2, label: t('setup.step2Short') }),
      title: t('setup.step2Title'),
      summary: captureTitle,
      body: (
        <Field label={tc('sectionLabel')}>
          <CaptureUseCaseCards
            ariaLabel={tc('groupAria')}
            value={captureMode}
            onChange={(id) => setCaptureMode(id as CaptureMode)}
            disabled={busy}
            options={CAPTURE_USECASE_OPTIONS}
          />
        </Field>
      ),
    },
    {
      key: 'language',
      eyebrow: t('setup.stepEyebrow', { n: 3, label: t('setup.step3Short') }),
      title: t('setup.step3Title'),
      summary:
        sourceLang && targetLang
          ? `${langLabelOf(sourceLang)} → ${langLabelOf(targetLang)}`
          : '',
      body: (
        <Field label={t('lang')}>
          <LangDualDropdown
            langs={langOptions}
            sourceLang={sourceLang}
            targetLang={targetLang}
            onSelectSource={setSourceLang}
            onSelectTarget={setTargetLang}
            placeholder={t('select')}
            inputLabel={t('inputLang')}
            outputLabel={t('outputLang')}
            triggerLabel={t('lang')}
            disabled={busy}
          />
        </Field>
      ),
    },
    {
      key: 'glossary',
      eyebrow: t('setup.stepEyebrow', { n: 4, label: t('setup.step4Short') }),
      title: t('setup.step4Title'),
      optional: true,
      summary: t('setup.glossarySummary', { count: glossary.length }),
      body: (
        <GlossaryField
          values={glossary}
          onChange={handleGlossaryChange}
          disabled={busy}
          ariaLabel={t('glossary.label')}
          placeholder={t('glossary.placeholder')}
          applyLabel={t('glossary.apply')}
          applyTitle={t('glossary.applyTitle')}
          dirtyNotice={t('glossary.dirtyNotice')}
        />
      ),
    },
  ];

  const setupIsComplete = (index: number): boolean =>
    index === 0
      ? projectId != null
      : index === 1
        ? captureMode !== ''
        : index === 2
          ? Boolean(sourceLang && targetLang)
          : glossary.length > 0;

  const setupAccordionEl = (
    <ControlBoardPanel.Region>
      <WidgetAccordion
        steps={setupSteps}
        isExpanded={setupAccordion.isExpanded}
        isComplete={setupIsComplete}
        onOpenStep={setupAccordion.open}
        onCollapseAll={setupAccordion.collapseAll}
        changeLabel={t('setup.change')}
        optionalLabel={t('setup.optional')}
      />
    </ControlBoardPanel.Region>
  );

  const errorBanner = error ? (
    <div className="rounded-xs border border-line bg-paper px-3 py-2 text-md text-mute">
      {t('errorPrefix')} {t.has(`errors.${error}`) ? t(`errors.${error}`) : error}
    </div>
  ) : null;

  // Layer A: autoplay-blocked banner. Placed at the top of the widget
  // (most visible spot) so the host immediately sees why the monitor
  // is silent and can restore it with one click. Viewers are
  // unaffected — this is the host's local monitor only.
  const ttsBlockedBanner = ttsBlocked ? (
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
  ) : null;

  // 🚨 Cross-channel echo banner (Fix 2). Raised once a self-echo burst is
  // detected; nudges the host toward headphones (the only real cure for the
  // acoustic loop). Advisory only — the loop-breaker mute already fired. Uses
  // `role="status"` since it's a non-blocking notice, not an error.
  const echoBanner = echoDetected ? (
    <div
      role="status"
      className="rounded-xs border border-amore bg-paper px-3 py-2 text-md text-ink"
    >
      <span className="text-amore">{t('echoDetected.notice')}</span>
    </div>
  ) : null;

  return (
    <div
      className={
        idlePhase
          ? // idle — 컨트롤보드 layout(wrapper/폭/정렬/간격) 은 ControlBoardPanel
            // SSOT 가 소유. 이 래퍼는 flex-col + 높이 체인만 제공한다 (CTA 는
            // 하단 액션 바로 분리). 부모(translate-card) 패딩 0 → 타 5위젯과
            // 동일 경로로 ControlBoardPanel pt-10=40px 를 그대로 흡수.
            'flex min-h-0 flex-1 flex-col'
          : 'space-y-4'
      }
    >
      {idlePhase ? (
        // 컨트롤보드 = ControlBoardPanel SSOT. 드롭다운(controlFields)이 진짜
        // 최상단이 되도록 — 에코 온보딩 가이드는 클러스터 하단으로 내린다
        // (dropdown-first, 사용자 요청 2026-07-08). banners 슬롯엔 autoplay
        // 차단(tts)만 상단 고정 — 오류 배너는 에코 안내 아래로. gap = 'field'(gap-4).
        <ControlBoardPanel
          gap="field"
          // banners 슬롯엔 autoplay 차단(Layer A tts)만 상단 고정 — 이건 "왜
          // 모니터가 조용한가"를 즉시 알려야 해서 top 이 맞다. 반면 WebRTC/연결
          // 오류 배너(errorBanner)는 EchoOnboarding("에코 없이 쓰는법") 아래로
          // 내려 컨트롤 top 노출을 없앤다 (사용자 2026-07-09).
          // ⚠️ ttsBlockedBanner 는 없을 때 null 이라 `banners && …` 가드가
          // 알아서 빈 mb-6 래퍼를 안 그린다 — 프래그먼트 phantom 여백 회귀 없음.
          banners={ttsBlockedBanner ?? undefined}
        >
          {/* V2 세팅 (PR-B) — idle 은 유스케이스 4-스텝 아코디언. live/ended 는
              아래 분기에서 controlFields(평면, disabled) 그대로 (라이브 회귀 0).
              실행 CTA(통역 시작)는 WidgetPrimaryCta (하단 액션 바) 로 통일. */}
          {setupAccordionEl}
          {/* 에코-free 온보딩 — 음성 OFF 디폴트 안내 + 공유링크/이어폰 3-step.
              드롭다운 아래 배치(dropdown-first). 비침습(Start 안 막음), "다시
              안 보기" localStorage 저장. 공유 링크는 세션 시작 후 생성되므로
              idle 에선 복사 버튼이 안내용 대기. */}
          <EchoOnboarding
            audible={outputAudible}
            onToggleAudible={() => setOutputAudible((v) => !v)}
            shareUrl={shareUrl}
            onCopyShareUrl={() => void copyShareUrl()}
            copied={shareCopied}
            listenerCount={listeners.length}
          />
          {/* WebRTC/연결 오류 배너 — 컨트롤 top 이 아니라 "에코 없이 쓰는법"
              안내 아래에 노출 (사용자 2026-07-09). errorBanner 는 무오류 시
              null 이라 클러스터 gap-4 를 소비하지 않아 빈 공간 회귀 없음. */}
          {errorBanner}
        </ControlBoardPanel>
      ) : (
        <>
          {/* 컨트롤 패널 — live/ending/ended. 손코딩 상단 바 제거, idle 과
              동일한 ControlBoardPanel active 프레임 경유(상태 불변 — idle→active
              프레임/컨트롤 위치 픽셀 불변). 부모 패딩 0 → ControlBoardPanel 이
              카드 상단·좌우 끝에서 시작하고 divider(border-b, active 소유)가 전폭
              (타 5위젯과 동일 경로 — 음수 마진 상쇄 불필요). 컨트롤 아래 출력부
              (공유/프롬프터/녹음)는 자체 px-5 로 좌우 여백을 소유(데스크/쿼트 출력부
              미러). 세션 중(live)엔 언어·모드·Glossary 변경 불가(결정 3) 라 필드는
              disabled + 안내, CTA 는 🚀 세션 시작 → 정지 전환. */}
          <ControlBoardPanel active gap="field">
              {controlFields}

              {/* 세션 중엔 언어·모드 변경 불가 안내 (결정 3). */}
              {live ? (
                <p className="text-sm text-mute-soft">{t('controlBoard.lockedHint')}</p>
              ) : null}

              {/* 슬롯별 라이브 표시등 — 실행 중인 캡처 모드의 각 슬롯을 화자
                  역할(🎤 진행자=mic / 📺 응답자=tab)로 표시. `both` 면 두 배지가
                  나란히, 단일 모드면 그 슬롯 하나만. `slotActive[slot]` = pc
                  connected 여부 → 점 색으로 라이브(text-amore)/연결중
                  (text-mute-soft) 구분. bit-rot 복구(card #620): slotActive 는
                  기록만 되고 렌더가 없었다. */}
              {live && captureMode ? (
                <div
                  className="flex flex-wrap items-center gap-3"
                  role="group"
                  aria-label={t('slotIndicator.groupAria')}
                >
                  {activeSlots(captureMode).map((slot) => {
                    const on = slotActive[slot];
                    const isHost = SLOT_SPEAKER[slot] === 'host';
                    return (
                      <span
                        key={slot}
                        className="inline-flex items-center gap-1.5 text-sm text-mute"
                        aria-label={
                          isHost
                            ? t('slotIndicator.hostAria')
                            : t('slotIndicator.guestAria')
                        }
                      >
                        <span aria-hidden>{isHost ? '🎤' : '📺'}</span>
                        <span>
                          {isHost
                            ? t('slotIndicator.host')
                            : t('slotIndicator.guest')}
                        </span>
                        <span
                          aria-hidden
                          className={on ? 'text-amore' : 'text-mute-soft'}
                          title={
                            on
                              ? t('slotIndicator.live')
                              : t('slotIndicator.connecting')
                          }
                        >
                          ●
                        </span>
                      </span>
                    );
                  })}
                </div>
              ) : null}

              {/* CTA — live: 경과 타이머 + (갱신 중 표시) + 정지. ended: 다음
                  세션용 🚀 세션 시작. 정렬은 .Action SSOT — live=between(타이머 좌 +
                  정지 우), ended=full(시작 버튼 폭 채움, 옛 flex-col stretch 유지). */}
              {live ? (
                <ControlBoardPanel.Action align="between">
                  <span className="text-md tabular-nums text-mute">
                    {formatElapsed(elapsed)}
                  </span>
                  <div className="flex items-center gap-2">
                    {/* 🚨 Auto-renewal indicator — subtle, only while a background
                        session handover is in flight (<2s). */}
                    {renewing ? (
                      <span className="text-sm text-mute-soft">{t('renewing')}</span>
                    ) : null}
                    <ChromeButton size="lg" onClick={() => void stop()}>
                      {t('stop')}
                    </ChromeButton>
                  </div>
                </ControlBoardPanel.Action>
              ) : (
                <ControlBoardPanel.Action full>
                  <ChromeButton
                    variant="default"
                    size="lg"
                    onClick={handleStartClick}
                    disabled={busy || !canStart}
                  >
                    {busy ? t('starting') : `🚀 ${t('start')}`}
                  </ChromeButton>
                </ControlBoardPanel.Action>
              )}
          </ControlBoardPanel>

          {/* 컨트롤 아래 출력부 — 수평 여백·클러스터(컨트롤 좌측 정합)는
              WidgetOutputRegion SSOT. 전사록/데스크와 동일 클러스터라 넓은
              카드(폭>max-w-2xl)에서도 컨트롤과 좌측 픽셀 정합. (bleed 는 좁은-카드
              inset px-5 에 고정돼, 넓은 카드에선 컨트롤 클러스터보다 왼쪽으로
              튀어나옴 = "좁은 버전 여백" 회귀. PrompterPane 은 클러스터 폭
              안에서 중앙정렬.) 세로는 데스크/쿼트 산출부 미러(py-5). */}
          <WidgetOutputRegion scroll={false} padY="lg">
            <div className="space-y-4">
          {ttsBlockedBanner}

          {echoBanner}

          {errorBanner}

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

      {/* 보조 컨트롤 — 음성 on/off + 공유 URL. 서브헤더 우측에서 메인 패널
          상단 (프롬프터 바로 위) 으로 이동. 공유 링크는 통역 시작 시 자동
          생성돼 음성 버튼 오른쪽 같은 라인에 URL 이 바로 노출된다. */}
      <div className="flex flex-wrap items-center gap-2">
        {/* 음성 on/off — explicit ON/OFF 라벨 (icon-only 로 하면 OFF 가
            클릭 한 번으로 복구 가능하단 hint 를 잃어 무음을 고장으로 오해).
            idle 에서는 재생할 통역 오디오가 없어 노출 X — live 진입 시에만. */}
        {live && (
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
        )}
        {/* 공유 URL — live 진입 시 자동 생성. 생성 중이면 안내, 생성되면
            URL + 복사 + 해제 + 만료안내 인라인. */}
        {shareUrl ? (
          <>
            <ChromeInput
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-[220px] max-w-[360px] flex-1 !border-line-soft !text-ink font-mono"
            />
            <ChromeButton size="md" onClick={() => void copyShareUrl()}>
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
            <span className="text-sm text-mute-soft">
              {t('share.expiresIn4h')}
            </span>
          </>
        ) : live && sharing ? (
          <span className="text-sm text-mute-soft">{t('share.creating')}</span>
        ) : null}
      </div>

      {/* 음성 ON 인라인 경고 (결정 C) — live 중 스피커 재생은 에코 유발 가능.
          막지 않고 안내만 (이어폰/별 기기 권장). */}
      {live && outputAudible ? (
        <p role="status" className="text-sm text-amore">
          {t('onboarding.voiceWarning')}
        </p>
      ) : null}

      {/* 스트리밍(프롬프터) 패널 — idle 에는 표시할 통역 라인이 없어 노출 X.
          통역 시작(live) 후에만 렌더. */}
      {live &&
        (showListeners ? (
          // Fullview: prompter + a right listener column. The prompter keeps
          // the flexible main width; the panel is a fixed ~300px rail.
          <div className="flex gap-4">
            <div className="min-w-0 flex-1">
              <PrompterPane lines={promptedLines} empty={t('prompter.empty')} />
            </div>
            <ListenerPanel
              listeners={listeners}
              className="w-[300px] shrink-0 self-start"
            />
          </div>
        ) : (
          <PrompterPane lines={promptedLines} empty={t('prompter.empty')} />
        ))}

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
            </div>
          </WidgetOutputRegion>
        </>
      )}

      {/* 주 CTA(통역 시작) — 바디 최하단 고정 액션 바 (6 위젯 통일). idle
          상태만 이동: live(정지)·ended(다음 세션 시작) CTA 는 기존 위치 유지.
          부모 패딩 0 → WidgetPrimaryCta 를 직접 렌더하면 자체 border-t + px-5 로
          프레임 하단·좌우 끝에 붙는다 (타 5위젯 미러 — 음수 마진 상쇄 불필요). */}
      {idlePhase && (
        <WidgetPrimaryCta
          label={t('start')}
          busyLabel={t('starting')}
          busy={busy}
          disabled={busy || !canStart}
          onClick={handleStartClick}
          // 아코디언 푸터 좌측 상태 라벨 (프로토 D10). ready = 원어+대상어+캡처 선택.
          statusLabel={canStart ? t('setup.readyGo') : t('setup.readyPending')}
        />
      )}

      <ShareGuidePopup
        open={browserAudioNoticeOpen}
        widget="translate"
        onConfirm={handleShareGuideConfirm}
        onCancel={() => setBrowserAudioNoticeOpen(false)}
      />

      {/* Per-slot monitor sinks — each slot's raw TTS stream is attached
          directly (see monitorAudioRefs). Hidden; audible unless the host
          mutes via the toggle. Two elements so `both` mode plays host +
          guest at once. branch 밖 공통 위치 — idle ↔ live 전환에 remount
          되지 않아야 pc.ontrack 이 붙인 srcObject 가 살아남는다. */}
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

// ── Layer B: glossary editor ──
// Textarea + 명시적 "적용" 버튼 (프로빙 control-board.tsx 조사목적 패턴 미러).
// 한 줄 = 용어 1개. 타이핑은 로컬 draft(string) 만 갱신하고, "적용" 클릭
// 시에만 라인 파싱 → onChange(string[]) 1회 호출(= 영속화). glossary 의
// 저장/세션 payload 계약은 여전히 string[] — Textarea 는 표현 계층만 담당.
const GLOSSARY_MAX_TERMS = 200;
const GLOSSARY_MAX_LEN = 200;

// draft(string) → string[]: 라인 분리 → trim → 빈 줄 제거 → 중복 제거
// (순서 보존) → 각 항목 MAX_LEN slice → 전체 MAX_TERMS 제한.
function parseGlossary(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split('\n')) {
    const term = line.trim().slice(0, GLOSSARY_MAX_LEN);
    if (!term || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
    if (out.length >= GLOSSARY_MAX_TERMS) break;
  }
  return out;
}

function GlossaryField({
  values,
  onChange,
  disabled,
  ariaLabel,
  placeholder,
  applyLabel,
  applyTitle,
  dirtyNotice,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  ariaLabel: string;
  placeholder: string;
  applyLabel: string;
  applyTitle: string;
  dirtyNotice: string;
}) {
  // 외부 hydrate(프로젝트 전환/설정 로드)로 values 가 바뀌면 draft 를 재시드.
  // 프로빙의 draft-vs-synced 리셋 패턴(render 중 감지) 을 준용 — effect 내
  // 동기 setState 를 막는 design-system lint 룰 회피.
  const synced = values.join('\n');
  const [draft, setDraft] = useState(synced);
  const [syncedSnapshot, setSyncedSnapshot] = useState(synced);
  if (synced !== syncedSnapshot) {
    setSyncedSnapshot(synced);
    setDraft(synced);
  }

  // 적용해도 저장값이 달라질 때만 dirty(파싱 결과 기준 — 순수 공백/빈 줄
  // 편집은 no-op 이라 버튼을 켜지 않는다).
  const dirty = parseGlossary(draft).join('\n') !== synced;
  const canApply = dirty && !disabled;

  function apply() {
    if (!canApply) return;
    const next = parseGlossary(draft);
    onChange(next);
    // 정규화된 형태로 draft 재시드 — 후행 공백/중복/빈 줄 정리 반영.
    setDraft(next.join('\n'));
  }

  return (
    <div>
      <Textarea
        aria-label={ariaLabel}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        disabled={disabled}
        placeholder={placeholder}
        className="resize-none text-md"
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <p className="text-xs text-mute" aria-live="polite">
          {dirty ? dirtyNotice : ''}
        </p>
        <Button
          variant="primary"
          size="sm"
          onClick={apply}
          disabled={!canApply}
          title={applyTitle}
        >
          {applyLabel}
        </Button>
      </div>
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
export function PrompterPane({ lines, empty }: { lines: CaptionLine[]; empty: string }) {
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


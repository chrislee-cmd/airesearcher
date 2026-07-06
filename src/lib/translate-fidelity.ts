// AI 동시통역 — UTF-8 fidelity helpers shared by the host console + the
// messages route + the transcript exporters.
//
// Two failure modes we guard against:
//
// 1. **Mojibake.** The transcript persists Korean / CJK as UTF-8 bytes, but
//    downstream consumers (Notepad, Excel, legacy editors) may guess the
//    encoding if no BOM is present and render `한글이 아닌 이상한 문자`.
//    Catching this requires both prepending a BOM on text exports and
//    detecting the typical Latin1-from-UTF-8 mis-decode pattern at runtime.
//
// 2. **Silent loss.** OpenAI Realtime emits deltas continuously; the host
//    appends them, splits on sentence boundary, and POSTs the committed
//    line. If any stage drops chars (dedup over-eager, persist call drops,
//    chunk boundary mangles a multi-byte UTF-8 codepoint), we want to
//    notice in dev + audit it in prod when the loss crosses a threshold.

// BOM that flips Notepad / Excel into UTF-8 mode. Prepend to every
// human-facing .txt the app writes (zip exports, downloads, copy-paste
// stubs). Stripping is done in `csv-parse.ts` for inbound files; this is
// the matching write-side bookend. Spelled with the escape sequence so
// editors / linters don't render the invisible BOM character inline.
export const UTF8_BOM = '﻿';

// Returns the number of U+FFFD replacement characters in `text`. Any non-
// zero count means the upstream decoder hit invalid UTF-8 — the host saw
// bytes it couldn't decode and substituted the replacement char rather
// than throwing. Useful as a sentinel because legitimate Korean / Japanese
// / Thai / Chinese text never contains U+FFFD.
export function countReplacementChars(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0xfffd) n++;
  }
  return n;
}

// Rough Latin1-from-UTF-8 mojibake heuristic. The classic pattern is a
// UTF-8 byte sequence (typically 0xC3 followed by 0x80..0xBF for Latin
// codepoints, or 0xE0..0xEF + cont bytes for CJK) re-decoded as Latin1,
// producing runs like `ëï½³` or `Ã«Ã¯` or `ê°` in the JS string. We look
// for the high-bit Latin1 range chars (U+0080..U+00BF and the C3/C2 markers
// at U+00C2..U+00C3) appearing back-to-back — those don't occur in clean
// Korean / Japanese / Latin text.
export function looksMojibake(text: string): boolean {
  let run = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const suspicious =
      (code >= 0x00c2 && code <= 0x00c3) || (code >= 0x0080 && code <= 0x00bf);
    if (suspicious) {
      run++;
      if (run >= 3) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

// Script-guard for the "Korean interview transcribed as Japanese" audit
// finding (#1). When the source language is Korean but the STT model is
// uncertain, it sometimes emits Japanese kana phonetics for the source
// transcript instead of Hangul — a fragment like `ありがとう` where the
// speaker actually said Korean. Real Korean transcription is Hangul +
// Latin (loanwords, acronyms) + digits and never contains kana, so a
// fragment that carries kana and zero Hangul is almost certainly that
// fallback artifact. The full transcription model (gpt-4o-transcribe)
// makes this rare, but it can still slip through on very low-confidence
// audio, so the host drops these fragments before they reach the
// caption / persistence path. Returns `true` only when the text has at
// least one kana char AND no Hangul — a mixed `안녕は` fragment is kept
// (it has Hangul) so a genuine loanword inside Korean speech survives.
//
// Hiragana U+3040–U+309F, Katakana U+30A0–U+30FF, half-width katakana
// U+FF66–U+FF9D. Hangul syllables U+AC00–U+D7A3, Jamo U+1100–U+11FF /
// U+3130–U+318F.
export function looksJapaneseFallback(text: string): boolean {
  const kana = /[぀-ヿｦ-ﾝ]/;
  const hangul = /[가-힣ᄀ-ᇿ㄰-㆏]/;
  return kana.test(text) && !hangul.test(text);
}

// Silence-hallucination guard (pr-translate-stt-silence-hallucination-gate).
// gpt-4o-transcribe (Whisper family) invents stock English interjections —
// "Goodbye", "Hello.", "Okay.", "Thank you." — during silent / low-energy
// stretches. The translations transcription config REJECTS a source-language
// hint (400, see src/lib/openai-realtime.ts), so the model can't be pinned to
// the source language server-side; these ghost phrases arrive as INPUT deltas
// in CJK-source (ja/ko/zh) sessions 10-13% of the time (Supabase 3-session
// audit, 2026-07-06). Independent of the cross-channel echo bug — they show up
// even in muted, echo-free sessions, so it's a pure STT artifact.
//
// Three gates, ALL required (precision-first — a false drop eats real speech):
//   1. script     — the fragment carries ZERO CJK chars. A genuine ja/ko/zh
//                   utterance is overwhelmingly CJK; a pure Latin / Cyrillic
//                   fragment in a CJK session is the fallback artifact.
//   2. length     — short (≤ MAX chars OR ≤ 2 words). The ghosts are all
//                   short interjections; a long Latin run survives.
//   3. dictionary — matches the known Whisper ghost repertoire. A real
//                   loanword / proper noun ("Amazon", "Notion") is NOT in the
//                   dictionary and passes untouched (code-switching preserved).
// Fires ONLY when the source language is itself CJK — an en / es / th session's
// "Okay" / "Sure" is real speech and is never touched.
const SILENCE_HALLUCINATION_MAX_CHARS = 24;

// Known Whisper silence-ghost repertoire. Anchored ^…$ so only a fragment
// that is ENTIRELY one of these interjections (plus trailing punctuation /
// whitespace) matches — a brand name embedded in real speech never does.
const SILENCE_HALLUCINATION_RE =
  /^(thank you( very much)?|thanks|bye( bye)?|goodbye|hello|hi|hey|okay|ok|sure|see( you)?|take care|you|yeah|yep|please|hmm+|mm+|uh+|eh+|ah+|oh+)[\s.,!?…"'’)\]]*$/i;

// Hangul syllables + Jamo, CJK Unified Ideographs, Hiragana, Katakana +
// half-width kana. Mirrors the ranges the host console's hasCJK() uses.
const CJK_CHAR_RE =
  /[가-힣ᄀ-ᇿ㄰-㆏぀-ヿｦ-ﾝ一-鿿]/;

// CJK source languages whose silent stretches produce the ghost artifact.
// ko / ja / zh only — en / es / th are excluded so their real "Okay" survives.
export function isCJKSourceLang(lang: string): boolean {
  return lang === 'ko' || lang === 'ja' || lang === 'zh';
}

// Returns true only when `text` is a silence-hallucination fragment for the
// given source language, per the three-gate rule documented above.
export function looksSilenceHallucination(
  text: string,
  sourceLang: string,
): boolean {
  if (!isCJKSourceLang(sourceLang)) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  // gate 1 (script) — any CJK char means it's a real utterance, keep it.
  if (CJK_CHAR_RE.test(trimmed)) return false;
  // gate 2 (length) — must be short (few chars OR few words). A long Latin
  // run (e.g. a spelled-out brand phrase) is not the ghost pattern.
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  if (trimmed.length > SILENCE_HALLUCINATION_MAX_CHARS && words > 2) return false;
  // gate 3 (dictionary) — matches a known Whisper silence ghost.
  return SILENCE_HALLUCINATION_RE.test(trimmed);
}

// Returns the UTF-8 byte length of `text`. Used by the loss-detection path
// so logs / audit metadata carry a stable byte count comparable across
// browser, server, and DB.
export function utf8ByteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).byteLength;
  }
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) n += 1;
    else if (code < 0x800) n += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

export type FidelitySummary = {
  chars: number;
  bytes: number;
  replacementChars: number;
  mojibake: boolean;
};

export function summarizeFidelity(text: string): FidelitySummary {
  return {
    chars: text.length,
    bytes: utf8ByteLength(text),
    replacementChars: countReplacementChars(text),
    mojibake: looksMojibake(text),
  };
}

// Threshold that turns a per-session char-count drift into a warning. The
// host console aggregates `deltaChars` (sum of every delta the data channel
// surfaced) and `commitChars` (sum of every line POSTed to /messages); a
// drift above this fraction means dedup or chunking dropped real content.
export const FIDELITY_LOSS_THRESHOLD = 0.05;

// Returns the loss ratio `(delta - commit) / delta`, clamped to [0, 1].
// Returns 0 when delta is zero so an empty session doesn't divide by zero.
export function lossRatio(deltaChars: number, commitChars: number): number {
  if (deltaChars <= 0) return 0;
  const diff = Math.max(0, deltaChars - commitChars);
  return Math.min(1, diff / deltaChars);
}

// Best-effort decoder for `RTCDataChannel` message payloads. Browsers
// deliver text frames as `string` and binary frames as `ArrayBuffer` /
// `Blob` depending on `binaryType`. `String(arrayBuffer)` would produce
// `"[object ArrayBuffer]"` and lose the payload entirely — this helper
// routes through TextDecoder with `fatal: false` so invalid bytes show
// up as U+FFFD (which the fidelity helpers above flag) instead of throwing
// or returning a stringified type marker.
export function decodeDataChannelMessage(data: unknown): string | null {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) {
    return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(data));
  }
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new TextDecoder('utf-8', { fatal: false }).decode(
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
    );
  }
  // Blob is async; the data channel "blob" binaryType is rare and never
  // configured for the translate flow, so we drop with a `null` so the
  // caller can log + skip instead of mishandling.
  return null;
}

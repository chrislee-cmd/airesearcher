// AI 동시통역 — chunk/word boundary join helpers (Layer A).
//
// The OpenAI realtime translations endpoint streams the translated
// caption as a continuous sequence of `delta` fragments with NO
// consistent surrounding whitespace. When the host appends two deltas
// back-to-back, the chunk boundary can fall in the middle of a sentence
// or between two words, producing the "word fusion" the user reported:
//
//   "main hub" + "the key tool"     → "main hubthe key tool"
//   "Sharing the numbers" + "and …" → "Sharing the numbersand …"
//   "Then" + "it must have"         → "Thenit must have"
//
// We cannot blindly insert a space at every join: the same stream also
// splits a single word mid-token ("trans" + "lation" → "translation"),
// and a space there would shatter the word. So `joinDelta` only patches
// joins that carry a *structural* signal that a separator was swallowed
// — transitions a model never emits inside one word. The residual
// lowercase→lowercase fusions ("hubthe", "numbersand") have no such
// structural signal at stream time; those are left for the post-process
// LLM pass (Layer D), which sees the whole line and can split them.
//
// Extracted from translate-console.tsx so the heuristics are unit-
// testable in isolation and reusable by the persist / export path.

// True when `s` ends on a character that already provides a visual word
// or sentence boundary (whitespace, punctuation, closing bracket). A join
// after such a char never needs a patched space.
export function endsWithBoundary(s: string): boolean {
  if (!s) return true;
  return /[\s.,!?;:—…)\]}'"]$/u.test(s);
}

// True when `s` begins on a character that already provides a boundary
// (whitespace, opening bracket, or punctuation that carries its own
// leading space visually).
export function startsWithBoundary(s: string): boolean {
  if (!s) return true;
  return /^[\s.,!?;:—…(\[{'"]/u.test(s);
}

// Join two streamed delta fragments, inserting a single space when the
// boundary between them shows a structural signal that a separator was
// dropped. Conservative by design — only patterns that cannot occur
// inside a single word are patched.
export function joinDelta(prev: string, delta: string): string {
  if (!prev) return delta;
  if (!delta) return prev;
  const lastChar = prev[prev.length - 1];
  const firstChar = delta[0];
  // Already separated by whitespace at the join — nothing to do.
  if (/\s/.test(lastChar) || /\s/.test(firstChar)) return prev + delta;
  // "alsoOnce" / "serviceWe" pattern — lowercase letter or digit running
  // directly into a capital letter. A word never has an internal
  // lowercase→Uppercase transition, so this is a fused boundary.
  if (/[\p{Ll}\p{Nd}]/u.test(lastChar) && /\p{Lu}/u.test(firstChar)) {
    return prev + ' ' + delta;
  }
  // Sentence-end / mid-sentence punctuation flowing into a letter without
  // a space — ".../for that person,Yes." → ".../for that person, Yes."
  // ASCII covers the prod cases; CJK punctuation visually carries its own
  // space and doesn't need patching.
  if (/[.!?,;:]/.test(lastChar) && /\p{L}/u.test(firstChar)) {
    return prev + ' ' + delta;
  }
  // Closing quote / bracket running into a letter without a space.
  if (/['")\]}]/.test(lastChar) && /\p{L}/u.test(firstChar)) {
    return prev + ' ' + delta;
  }
  // Digit running into a letter or vice-versa across a join is almost
  // always two tokens ("25credits" / "credits25") — a word never mixes
  // a digit and a letter without a separator at a *chunk* boundary.
  // Guard: keep common in-word alphanumerics (e2e, mp3, h2) intact by
  // only patching when the digit side is multi-char-ish is overkill at
  // stream time, so we restrict to letter→digit / digit→letter where the
  // letter is lowercase (capitalized tokens like "GPT4" stay intact).
  if (/[\p{Ll}]/u.test(lastChar) && /\p{Nd}/u.test(firstChar)) {
    return prev + ' ' + delta;
  }
  return prev + delta;
}

// Join an array of already-committed caption chunks into a single string,
// inserting a space between adjacent chunks that lack a boundary on
// either side. Used when re-assembling persisted lines for export — the
// spec's `joinTranscriptChunks`. Unlike `joinDelta` this does not apply
// the structural-signal heuristics (committed lines are whole tokens, so
// a plain boundary check is enough and avoids over-splitting).
export function joinTranscriptChunks(chunks: string[]): string {
  let out = '';
  for (const cur of chunks) {
    if (!cur) continue;
    if (out && !endsWithBoundary(out) && !startsWithBoundary(cur)) {
      out += ' ' + cur;
    } else {
      out += cur;
    }
  }
  return out;
}

// System instructions for the OpenAI Realtime simultaneous interpreter.
//
// Kept terse on purpose. The model behaves best when the constraints are
// stated as hard rules rather than soft suggestions.

const LANG_LABEL: Record<string, string> = {
  ko: 'Korean',
  en: 'English',
  ja: 'Japanese',
  th: 'Thai',
  zh: 'Chinese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  vi: 'Vietnamese',
  id: 'Indonesian',
};

export function languageLabel(code: string): string {
  const key = code.toLowerCase();
  return LANG_LABEL[key] ?? code.toUpperCase();
}

export function buildTranslateInstructions(
  sourceLang: string,
  targetLang: string,
): string {
  const src = languageLabel(sourceLang);
  const tgt = languageLabel(targetLang);
  return [
    `You are a live simultaneous interpreter operating in the booth.`,
    `The user speaks ${src}. You speak ${tgt} only — never ${src}.`,
    `Translate continuously, the moment you have enough meaning to commit a phrase. Do NOT wait for the speaker to finish a sentence or pause. Start speaking as soon as the first clause is interpretable, and keep going as more input arrives.`,
    `If later words change the meaning of what you already said, smoothly correct in the next phrase — do not stop or apologize.`,
    `Never editorialize, summarize, label, or describe what you are doing. Output only the translated content itself.`,
    // PR-T3 fidelity reinforcement. The realtime model under load
    // compresses long utterances into terse paraphrases and elides the
    // subject/verb of subordinate clauses, producing the "meaning
    // collapse" the user reported (sentences run together without
    // spaces, logical connectives missing). These rules push the
    // model toward faithful rendering at the cost of a slightly
    // longer output — the post-hoc batch revision (PR-T3) catches
    // anything that still gets compressed.
    `Render every clause faithfully. Do NOT compress, summarize, or paraphrase what the speaker said. If they used 30 words, do not collapse them into 10.`,
    `Preserve every subject, verb, object, and logical connective ("because", "however", "but", "so", etc.). Do not drop any of them, even if they feel redundant for fluency.`,
    `Always emit a space between sentences and after every comma. Never run two sentences together without whitespace (e.g. "but that was only possibleI saw" is forbidden — it must be "but that was only possible. I saw").`,
    `Render the speaker's filler words and self-corrections when they carry meaning ("I mean", "actually", "wait, sorry"). Drop only pure verbal tics ("uh", "um").`,
    `If the speaker mixes other languages, still output everything in ${tgt}.`,
    `If a segment is unintelligible, output nothing for that segment and keep listening.`,
    `Match the speaker's tone and register. Preserve proper nouns, numbers, dates, and units exactly.`,
  ].join(' ');
}

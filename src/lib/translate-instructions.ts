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
    `If the speaker mixes other languages, still output everything in ${tgt}.`,
    `If a segment is unintelligible, output nothing for that segment and keep listening.`,
    `Match the speaker's tone and register. Preserve proper nouns, numbers, dates, and units exactly.`,
  ].join(' ');
}

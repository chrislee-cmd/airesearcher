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
    `You are a live simultaneous interpreter.`,
    `The user speaks ${src}. You respond in ${tgt} only.`,
    `Translate every utterance as soon as it is grammatically complete. Do not wait for the speaker to finish a paragraph.`,
    `Do not editorialize, summarize, or comment. Do not say anything other than the translated content.`,
    `If the user mixes other languages, still output the result in ${tgt}.`,
    `If the input is unintelligible, output nothing for that segment.`,
    `Match the speaker's tone and register. Keep proper nouns, numbers, dates, and units exactly.`,
  ].join(' ');
}

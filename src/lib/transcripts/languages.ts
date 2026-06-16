// Language registry shared by client UI and server (provider dispatch).
//
// Each entry maps an internal code to the language value AND the provider that
// transcribes it best. English (en, en-GB) → Deepgram nova-3 (English SOTA).
// Everything else, including `multi` (auto-detect), → ElevenLabs Scribe v2,
// which beat Deepgram nova-2 by ~2.15× word recall on a 90-min Korean
// interview (A1 experiment, 2026-06-16). `dgLanguage` doubles as the
// ElevenLabs `language_code` — Scribe v2 accepts both ISO 639-1 ("ko") and
// 639-3 ("kor"), verified directly.

export type LanguageEntry = {
  code: string;       // internal code; matches what the client sends
  label: string;      // Korean display label
  flag: string;       // emoji
  dgLanguage: string; // language code passed to both Deepgram and ElevenLabs
  dgModel: 'nova-3' | 'nova-2'; // Deepgram-only; ignored when provider==='elevenlabs'
  provider: 'deepgram' | 'elevenlabs';
};

export const LANGUAGES: LanguageEntry[] = [
  { code: 'multi',  label: '자동 감지',         flag: '🌐', dgLanguage: 'multi',  dgModel: 'nova-3', provider: 'elevenlabs' },

  // Northeast Asia
  { code: 'ko',     label: '한국어',            flag: '🇰🇷', dgLanguage: 'ko',     dgModel: 'nova-2', provider: 'elevenlabs' },
  { code: 'ja',     label: '일본어',            flag: '🇯🇵', dgLanguage: 'ja',     dgModel: 'nova-3', provider: 'elevenlabs' },
  { code: 'zh',     label: '중국어(간체)',      flag: '🇨🇳', dgLanguage: 'zh-CN',  dgModel: 'nova-2', provider: 'elevenlabs' },
  { code: 'zh-TW',  label: '중국어(번체)',      flag: '🇹🇼', dgLanguage: 'zh-TW',  dgModel: 'nova-2', provider: 'elevenlabs' },

  // West Europe
  { code: 'en',     label: '영어',              flag: '🇺🇸', dgLanguage: 'en',     dgModel: 'nova-3', provider: 'deepgram' },
  { code: 'en-GB',  label: '영국 영어',         flag: '🇬🇧', dgLanguage: 'en-GB',  dgModel: 'nova-3', provider: 'deepgram' },
  { code: 'es',     label: '스페인어',          flag: '🇪🇸', dgLanguage: 'es',     dgModel: 'nova-3', provider: 'elevenlabs' },
  { code: 'fr',     label: '프랑스어',          flag: '🇫🇷', dgLanguage: 'fr',     dgModel: 'nova-3', provider: 'elevenlabs' },
  { code: 'de',     label: '독일어',            flag: '🇩🇪', dgLanguage: 'de',     dgModel: 'nova-3', provider: 'elevenlabs' },
  { code: 'it',     label: '이탈리아어',        flag: '🇮🇹', dgLanguage: 'it',     dgModel: 'nova-3', provider: 'elevenlabs' },
  { code: 'nl',     label: '네덜란드어',        flag: '🇳🇱', dgLanguage: 'nl',     dgModel: 'nova-3', provider: 'elevenlabs' },
  { code: 'pt',     label: '포르투갈어',        flag: '🇵🇹', dgLanguage: 'pt',     dgModel: 'nova-3', provider: 'elevenlabs' },

  // Nordics
  { code: 'sv',     label: '스웨덴어',          flag: '🇸🇪', dgLanguage: 'sv',     dgModel: 'nova-2', provider: 'elevenlabs' },
  { code: 'da',     label: '덴마크어',          flag: '🇩🇰', dgLanguage: 'da',     dgModel: 'nova-2', provider: 'elevenlabs' },
  { code: 'no',     label: '노르웨이어',        flag: '🇳🇴', dgLanguage: 'no',     dgModel: 'nova-2', provider: 'elevenlabs' },
  { code: 'fi',     label: '핀란드어',          flag: '🇫🇮', dgLanguage: 'fi',     dgModel: 'nova-2', provider: 'elevenlabs' },

  // East Europe / Slavic
  { code: 'ru',     label: '러시아어',          flag: '🇷🇺', dgLanguage: 'ru',     dgModel: 'nova-3', provider: 'elevenlabs' },
  { code: 'pl',     label: '폴란드어',          flag: '🇵🇱', dgLanguage: 'pl',     dgModel: 'nova-2', provider: 'elevenlabs' },
  { code: 'uk',     label: '우크라이나어',      flag: '🇺🇦', dgLanguage: 'uk',     dgModel: 'nova-2', provider: 'elevenlabs' },
  { code: 'cs',     label: '체코어',            flag: '🇨🇿', dgLanguage: 'cs',     dgModel: 'nova-2', provider: 'elevenlabs' },
  { code: 'hu',     label: '헝가리어',          flag: '🇭🇺', dgLanguage: 'hu',     dgModel: 'nova-2', provider: 'elevenlabs' },
  { code: 'ro',     label: '루마니아어',        flag: '🇷🇴', dgLanguage: 'ro',     dgModel: 'nova-2', provider: 'elevenlabs' },
  { code: 'bg',     label: '불가리아어',        flag: '🇧🇬', dgLanguage: 'bg',     dgModel: 'nova-2', provider: 'elevenlabs' },
  { code: 'el',     label: '그리스어',          flag: '🇬🇷', dgLanguage: 'el',     dgModel: 'nova-2', provider: 'elevenlabs' },

  // West Asia / Middle East
  { code: 'tr',     label: '터키어',            flag: '🇹🇷', dgLanguage: 'tr',     dgModel: 'nova-2', provider: 'elevenlabs' },
  { code: 'ar',     label: '아랍어',            flag: '🇸🇦', dgLanguage: 'ar',     dgModel: 'nova-2', provider: 'elevenlabs' },

  // South Asia
  { code: 'hi',     label: '힌디어',            flag: '🇮🇳', dgLanguage: 'hi',     dgModel: 'nova-3', provider: 'elevenlabs' },

  // Southeast Asia
  { code: 'id',     label: '인도네시아어',      flag: '🇮🇩', dgLanguage: 'id',     dgModel: 'nova-2', provider: 'elevenlabs' },
  { code: 'ms',     label: '말레이어',          flag: '🇲🇾', dgLanguage: 'ms',     dgModel: 'nova-2', provider: 'elevenlabs' },
  { code: 'th',     label: '태국어',            flag: '🇹🇭', dgLanguage: 'th',     dgModel: 'nova-2', provider: 'elevenlabs' },
  { code: 'vi',     label: '베트남어',          flag: '🇻🇳', dgLanguage: 'vi',     dgModel: 'nova-2', provider: 'elevenlabs' },
  { code: 'tl',     label: '타갈로그',          flag: '🇵🇭', dgLanguage: 'tl',     dgModel: 'nova-2', provider: 'elevenlabs' },
];

const BY_CODE: Record<string, LanguageEntry> = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, l]),
);

export function getLanguage(code: string | null | undefined): LanguageEntry {
  if (!code) return BY_CODE.multi;
  return BY_CODE[code] ?? BY_CODE.multi;
}

/**
 * Pick a sensible default from a browser locale string (e.g. "ko-KR", "en-US",
 * "zh-TW"). Returns the closest known internal code, or "multi" if nothing
 * matches.
 */
export function pickFromBrowser(navLang: string | null | undefined): string {
  if (!navLang) return 'multi';
  // Exact match — handles "en-GB", "zh-TW", etc.
  if (BY_CODE[navLang]) return navLang;
  // Primary subtag — "en-US" → "en", "ja-JP" → "ja"
  const primary = navLang.split('-')[0];
  if (BY_CODE[primary]) return primary;
  // zh-* (other than zh-TW) → simplified zh
  if (primary === 'zh') return 'zh';
  return 'multi';
}

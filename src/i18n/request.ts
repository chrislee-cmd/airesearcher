import { getRequestConfig } from 'next-intl/server';
import { hasLocale, IntlError, IntlErrorCode } from 'next-intl';
import { routing } from './routing';

// ─────────────────────────────────────────────────────────────────────────
// English-fallback message loading (i18n Phase 2 — "no raw key on screen").
//
// Some locales are only partially translated (ja/th currently carry ~698 of
// en's 1479 keys). Loading a single `${locale}.json` would leave next-intl to
// render the raw dotted key path (e.g. "Sidebar.transcripts") for every
// missing message. To prevent that, every non-English locale is deep-merged
// on top of the complete `en.json` base: en supplies the value wherever the
// locale is missing one, so the screen always shows English rather than a key.
//
// `getMessageFallback` + `onError` are the last-resort net: even for a key
// that exists in no file (a typo or a stale lookup), we render an empty string
// instead of the raw key. Invariant: a user never sees a `Foo.bar` token.
// ─────────────────────────────────────────────────────────────────────────

type Messages = Record<string, unknown>;

function isPlainObject(value: unknown): value is Messages {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Deep merge at the value level: every leaf in `override` wins, every leaf
// only present in `base` (en) is kept. Because the merge is value-for-value,
// ICU / `t.rich` argument contracts are preserved automatically — a locale
// never inherits a *partial* string, only whole en values for missing keys.
function deepMerge(base: Messages, override: Messages): Messages {
  const out: Messages = { ...base };
  for (const key of Object.keys(override)) {
    const b = base[key];
    const o = override[key];
    out[key] = isPlainObject(b) && isPlainObject(o) ? deepMerge(b, o) : o;
  }
  return out;
}

async function loadRaw(locale: string): Promise<Messages> {
  return (await import(`../../messages/${locale}.json`)).default as Messages;
}

// Module-level cache: request.ts runs on every RSC render, so the en base and
// each merged locale are computed once per server process, not per request.
const messagesCache = new Map<string, Messages>();

async function loadMessages(locale: string): Promise<Messages> {
  const cached = messagesCache.get(locale);
  if (cached) return cached;

  const en = await loadRaw('en');
  const merged =
    locale === 'en' ? en : deepMerge(en, await loadRaw(locale));

  messagesCache.set(locale, merged);
  return merged;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: await loadMessages(locale),

    // A missing message is expected for partially-translated locales, but the
    // en-base merge already covers those. If one still fires here the key is
    // absent from en too (a stale/typo lookup) — surface it in dev, stay quiet
    // in production to avoid log spam. Any other code (bad ICU, formatting) is
    // a real bug and is always logged.
    onError(error: IntlError) {
      if (error.code === IntlErrorCode.MISSING_MESSAGE) {
        if (process.env.NODE_ENV !== 'production') console.error(error);
        return;
      }
      console.error(error);
    },

    // Last-resort net: never render the raw `${namespace}.${key}` path (the
    // next-intl default). Empty string over a leaked key.
    getMessageFallback({ namespace, key }) {
      if (process.env.NODE_ENV !== 'production') {
        const path = namespace ? `${namespace}.${key}` : key;
        console.error(`[i18n] missing message with no en fallback: ${path}`);
      }
      return '';
    },
  };
});

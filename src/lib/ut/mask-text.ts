// Sensitive-text masking for AI UT insight clips (card 626, spec §프라이버시).
// UT recordings can contain login passwords / card numbers, and although the
// analysis prompts forbid copying sensitive strings, a vision/text model can
// still echo a fragment into a summary or quote. This scrubs the qualitative
// free-text we persist (clip insights + session report). Unlike 622's
// `maskNote` (card 622, capped at 60 chars for a single quantitative note) this
// keeps full length — 626's insights are paragraphs — and recurses into nested
// objects/arrays so no field slips through unmasked.

const CARD_RE = /\b(?:\d[ -]?){13,19}\b/g; // 13–19 digit sequences (PAN)
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi;
const OTP_RE = /\b\d{4,8}\b/g; // short numeric codes (OTP / CVV / PIN)
const LONG_DIGITS_RE = /\d{6,}/g; // any long digit run (account / phone)

const REDACTED = '‹redacted›';

export function maskSensitiveText(text: string): string {
  return text
    .replace(CARD_RE, REDACTED)
    .replace(EMAIL_RE, REDACTED)
    .replace(OTP_RE, REDACTED)
    .replace(LONG_DIGITS_RE, REDACTED);
}

// Deep-mask every string in a JSON-serialisable value (clip insight / report
// object) before it is persisted. Non-string leaves pass through untouched.
export function maskSensitiveDeep<T>(value: T): T {
  if (typeof value === 'string') return maskSensitiveText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => maskSensitiveDeep(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = maskSensitiveDeep(v);
    return out as T;
  }
  return value;
}

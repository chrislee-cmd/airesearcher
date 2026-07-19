// Defence-in-depth masking for AI UT events (card 622, spec §프라이버시). The
// screen recording can contain login passwords / card numbers, and although the
// extraction prompt forbids copying sensitive text, a vision model can still
// leak a fragment into meta.note. This scrubs the ONLY free-text field we
// persist (meta.note) so card/OTP/email-shaped strings never land in ut_events.
// Numeric fields (x/y/scroll_depth/cluster) are non-sensitive by construction.

const CARD_RE = /\b(?:\d[ -]?){13,19}\b/g; // 13–19 digit sequences (PAN)
const OTP_RE = /\b\d{4,8}\b/g; // short numeric codes (OTP / CVV / PIN)
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi;
const LONG_DIGITS_RE = /\d{6,}/g; // any long digit run (account / phone)

// A neutral, bounded note. Even after redaction we cap length so a chatty model
// can't smuggle a paragraph of qualitative narration through this field (that is
// 626's job, not 622's).
export function maskNote(note: string | undefined): string | undefined {
  if (!note) return undefined;
  const masked = note
    .replace(CARD_RE, '‹redacted›')
    .replace(EMAIL_RE, '‹redacted›')
    .replace(OTP_RE, '‹redacted›')
    .replace(LONG_DIGITS_RE, '‹redacted›')
    .trim()
    .slice(0, 60);
  return masked.length ? masked : undefined;
}

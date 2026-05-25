/**
 * Single source of truth for artifact filenames produced by generator features
 * (desk research, transcripts, interview results, full reports).
 *
 * Pattern: `{prefix}-{slug}-{YYYY-MM-DD}.{ext}` (date is UTC, derived from
 * job.created_at so re-downloads yield the same name). Caller opts into
 * `withTime: true` to append `-HHMM` for same-day disambiguation.
 *
 * All download routes should pair these names with `contentDispositionHeader`
 * so Korean/emoji slugs survive transport via RFC 5987 `filename*=UTF-8''…`
 * while still providing a strict-ASCII `filename=` fallback for older clients.
 */

export type ArtifactPrefix = 'desk' | 'transcript' | 'interview' | 'report';

export type ArtifactExt =
  | 'md'
  | 'docx'
  | 'xlsx'
  | 'csv'
  | 'pptx'
  | 'html'
  | 'txt';

export interface BuildBaseNameOpts {
  prefix: ArtifactPrefix;
  /** Most meaningful identifier (keyword, original filename, project name…). */
  slug?: string | null;
  /** Job creation time. Use the persisted value, not `new Date()`. */
  createdAt: string | Date;
  /** Append `-HHMM` (UTC) for same-day disambiguation. Default `false`. */
  withTime?: boolean;
}

export interface BuildFilenameOpts extends BuildBaseNameOpts {
  ext: ArtifactExt;
}

const SLUG_MAX_LEN = 60;

/**
 * Normalize an arbitrary string into a kebab-case slug suitable for use inside
 * a filename. Preserves non-ASCII (Korean, emoji) — pair with
 * `contentDispositionHeader` so they round-trip via RFC 5987.
 *
 * Returns `''` when input is empty after cleanup; callers decide on a fallback.
 */
export function toSlug(
  input: string | null | undefined,
  maxLen: number = SLUG_MAX_LEN,
): string {
  if (!input) return '';
  const cleaned = input
    .normalize('NFC')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  if (!cleaned) return '';
  return cleaned.slice(0, Math.max(1, maxLen)).replace(/-+$/g, '');
}

function toDate(input: string | Date): Date {
  if (input instanceof Date) return input;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function formatHm(d: Date): string {
  return `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}`;
}

/**
 * Build the extension-less base name. Example:
 *   `{ prefix: 'report', slug: 'market', createdAt: '2026-05-25T14:30Z' }`
 *   → `'report-market-2026-05-25'`
 *
 * When `slug` is empty, returns `'{prefix}-{date}'` (no double prefix).
 */
export function buildArtifactBaseName(opts: BuildBaseNameOpts): string {
  const slug = toSlug(opts.slug);
  const d = toDate(opts.createdAt);
  const date = formatYmd(d);
  const tail = opts.withTime ? `-${formatHm(d)}` : '';
  if (!slug) return `${opts.prefix}-${date}${tail}`;
  return `${opts.prefix}-${slug}-${date}${tail}`;
}

/**
 * Build the full filename including extension. Use this for both download
 * filenames (paired with `contentDispositionHeader`) and workspace titles, so
 * the user sees the same name everywhere.
 */
export function buildArtifactFilename(opts: BuildFilenameOpts): string {
  return `${buildArtifactBaseName(opts)}.${opts.ext}`;
}

/**
 * Strip every non-ASCII / unsafe character down to `[A-Za-z0-9._-]+`. Intended
 * for the `filename=` fallback in Content-Disposition; the original Unicode
 * filename rides in `filename*=` instead. Returns `'download'` when empty.
 */
export function safeAsciiFilename(name: string): string {
  const ascii = name
    .replace(/[\\/]/g, '_')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '');
  return ascii || 'download';
}

/**
 * RFC 5987 ext-value encoder: percent-encode beyond what encodeURIComponent
 * produces so the result is safe inside an HTTP header attribute.
 */
function encodeRFC5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Produce a full Content-Disposition header value with both `filename=`
 * (ASCII fallback) and `filename*=UTF-8''…` (RFC 5987) so non-ASCII names
 * round-trip across Chrome/Safari/Firefox/old IE.
 */
export function contentDispositionHeader(
  filename: string,
  mode: 'attachment' | 'inline' = 'attachment',
): string {
  const ascii = safeAsciiFilename(filename);
  const encoded = encodeRFC5987(filename);
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

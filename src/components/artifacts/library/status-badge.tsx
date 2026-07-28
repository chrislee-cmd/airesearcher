import type { DeliverableStatus } from '@/lib/artifacts/types';

// Shared 4-state status badge — the whole point of the unification (BUILD-SPEC
// §"shared 4-state vocabulary"). Identical in list, grid, rail and matrix.
// NEVER re-word per feature ("Transcribing", "Crawling" belong in the meta
// line, not here) — the caller passes the fixed 4-state label.

type Tone = {
  dot: string; // dot bg utility (draft = hollow, handled below)
  tint: string; // pill bg
  border: string; // pill border colour
  text: string; // label + dot text
};

const TONE: Record<DeliverableStatus, Tone> = {
  ready: { dot: 'bg-success', tint: 'bg-success-bg', border: 'border-success-line', text: 'text-success-text' },
  processing: { dot: 'bg-processing', tint: 'bg-lav-bg', border: 'border-lav-line', text: 'text-lav-text' },
  // draft dot is hollow: paper fill + a mute-soft ring (rendered below).
  draft: { dot: 'bg-paper', tint: 'bg-paper-soft', border: 'border-line-strong', text: 'text-mute' },
  error: { dot: 'bg-error', tint: 'bg-error-bg', border: 'border-error-line', text: 'text-error-text' },
};

export function StatusBadge({
  status,
  label,
  size = 'md',
}: {
  status: DeliverableStatus;
  label: string;
  size?: 'md' | 'sm';
}) {
  const t = TONE[status];
  const dotSize = size === 'sm' ? 'h-1.5 w-1.5' : 'h-[7px] w-[7px]';
  const pad = size === 'sm' ? 'px-2.5 py-0.5' : 'px-2.5 py-[3px]';
  const textSize = size === 'sm' ? 'text-sm' : 'text-sm';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill border-[1.3px] ${t.tint} ${t.border} ${pad} ${textSize} font-bold ${t.text}`}
    >
      <span
        className={`rounded-full ${dotSize} ${t.dot} ${
          status === 'draft' ? 'border-[1.6px] border-mute-soft' : ''
        }`}
      />
      {label}
    </span>
  );
}

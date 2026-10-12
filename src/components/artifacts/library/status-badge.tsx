import type { DeliverableStatus } from '@/lib/artifacts/types';

// Shared 4-state status badge — the whole point of the unification (BUILD-SPEC
// §"shared 4-state vocabulary"). Identical in list, grid, rail and matrix.
// NEVER re-word per feature ("Transcribing", "Crawling" belong in the meta
// line, not here) — the caller passes the fixed 4-state label.
//
// Soft Identity 리브랜드 1단계 — 핵심규칙 4: "상태 배지는 테두리가 없다 —
// 틴트 면(--*-bg) + 진한 글자(--*-fg) + 점". draft 는 속 빈 점(흰 면 + 1px
// --faint)으로 구분한다(만료/철회 규칙과 동일 문법). 치수(패딩·점 크기)는 불변.

type Tone = {
  dot: string; // dot bg utility (draft = hollow, handled below)
  tint: string; // pill bg
  text: string; // label + dot text
};

const TONE: Record<DeliverableStatus, Tone> = {
  ready: { dot: 'bg-soft-ok-dot', tint: 'bg-soft-ok-bg', text: 'text-soft-ok-fg' },
  processing: { dot: 'bg-soft-run-dot', tint: 'bg-soft-run-bg', text: 'text-soft-run-fg' },
  // draft dot is hollow: --surface fill + a --faint ring (rendered below).
  draft: { dot: 'bg-soft-surface', tint: 'bg-soft-fill', text: 'text-soft-mute' },
  error: { dot: 'bg-soft-err-dot', tint: 'bg-soft-err-bg', text: 'text-soft-err-fg' },
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
      className={`inline-flex items-center gap-1.5 rounded-pill ${t.tint} ${pad} ${textSize} font-bold ${t.text}`}
    >
      <span
        className={`rounded-full ${dotSize} ${t.dot} ${
          status === 'draft' ? 'border border-soft-faint' : ''
        }`}
      />
      {label}
    </span>
  );
}

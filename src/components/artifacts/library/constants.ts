// Unified deliverables library — shared presentation constants.
//
// The shell is feature-blind: identity arrives only as a `tone` (pastel token
// class) and a glyph, never as an `if (feature === …)` layout branch. These
// maps are the single place feature identity is expressed visually — adding a
// new DeliverableFeature is a one-line data change here, no component edits
// (BUILD-SPEC §5). Colours resolve to tokens.json 2.0 pastels; do not inline hex.

import type { DeliverableFeature, DeliverableStatus } from '@/lib/artifacts/types';

// feature → pastel tone bg utility. lav/aqua/peach/sun are the four shipped
// feature identities (TOKEN-DECISIONS A1/A2/A4); rose is reserved for the next.
export const FEATURE_TONE_BG: Record<DeliverableFeature, string> = {
  transcript: 'bg-lav',
  desk: 'bg-aqua',
  ut: 'bg-peach',
  recruiting: 'bg-sun',
};

// feature → glyph. Emoji per the CD comp (deliverables-library.dc.html ICON map).
export const FEATURE_ICON: Record<DeliverableFeature, string> = {
  transcript: '📄',
  desk: '🔍',
  ut: '🧪',
  recruiting: '🧲',
};

// Open → the feature's existing surface. Conservative wiring: no per-id fullview
// deep-link contract exists in the codebase (the projects page lists artifacts
// but never links to a specific fullview), and the spec forbids rewriting the
// fullview. So Open routes to the feature's base route. ut has no dedicated
// page today (canvas widget) → fall back to /canvas.
export const FEATURE_OPEN_HREF: Record<DeliverableFeature, string> = {
  transcript: '/transcripts',
  desk: '/desk',
  ut: '/canvas',
  recruiting: '/recruiting',
};

// Assign (Move to project) is supported by /api/artifacts/assign for these
// features only. ut has no project_id column (utAdapter projects → null) and is
// absent from the assign enum, so Move is unavailable for it.
export const MOVE_SUPPORTED: Record<DeliverableFeature, boolean> = {
  transcript: true,
  desk: true,
  ut: false,
  recruiting: true,
};

export const STATUS_ORDER: DeliverableStatus[] = ['ready', 'processing', 'draft', 'error'];
export const FEATURE_ORDER: DeliverableFeature[] = ['transcript', 'desk', 'ut', 'recruiting'];

export type SortField = 'updated' | 'created' | 'title';
export const SORT_FIELDS: SortField[] = ['updated', 'created', 'title'];

export type ViewMode = 'list' | 'grid';

// An action is "actionable" (Open primary, Share/Export potentially enabled)
// only when the deliverable actually exists to act on — ready or draft.
// processing/error → Open only (error uses the secondary treatment). This is
// the A2 matrix rule, centralised so list, grid and menu never diverge.
export function isEnabled(status: DeliverableStatus): boolean {
  return status === 'ready' || status === 'draft';
}

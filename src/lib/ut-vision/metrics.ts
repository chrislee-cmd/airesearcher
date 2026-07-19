// Deterministic, rule-based aggregation of AI-UT interaction events into
// session behavior metrics (card 622, spec §2). This is code, NOT a model call
// — the numbers are reproducible from the same event stream, which is exactly
// the property 622 owns ("결정론/재현성 (룰 기반)") and 626 (generative
// narration) does not. The vision model only supplies raw observed events;
// every count / duration / hotspot below is computed here.
import type { UtEvent, UtEventType } from './schema';
import { UT_EVENT_TYPES } from './schema';

export type UtStep = {
  index: number;
  start_ms: number;
  end_ms: number;
  duration_ms: number;
};

export type UtHotspot = {
  start_ms: number;
  window_ms: number;
  intensity: number; // weighted friction score in the window
  kinds: UtEventType[]; // which friction kinds contributed
};

export type BehaviorMetrics = {
  version: number;
  event_count: number;
  duration_ms: number | null;
  counts_by_type: Record<UtEventType, number>;
  rage_click_count: number;
  rage_click_points: { t_ms: number; x?: number; y?: number }[];
  backtrack_count: number;
  hesitation: { count: number; total_ms: number; max_ms: number };
  scroll: { events: number; max_depth: number };
  steps: UtStep[];
  hotspots: UtHotspot[];
  avg_confidence: number;
};

// Friction weights — how much each kind contributes to a hotspot's intensity.
// Rage-clicks are the strongest confusion signal, hesitation the softest.
const FRICTION_WEIGHT: Partial<Record<UtEventType, number>> = {
  rage_click: 3,
  backtrack: 2,
  hover_hesitation: 1,
};

const RAGE_BURST_MS = 1200; // clicks within this window at the same spot = a burst
const RAGE_BURST_MIN = 3; // 3+ clicks = rage
const RAGE_SAME_SPOT = 0.06; // normalized distance treated as "same spot"

const METRICS_VERSION = 1;

function emptyCounts(): Record<UtEventType, number> {
  return UT_EVENT_TYPES.reduce(
    (acc, t) => {
      acc[t] = 0;
      return acc;
    },
    {} as Record<UtEventType, number>,
  );
}

// Derive rage-click bursts from raw click events as a backstop for when the
// model didn't tag rage_click itself: 3+ clicks within RAGE_BURST_MS at ~the
// same normalized position.
function deriveRageBursts(clicks: UtEvent[]): { t_ms: number; x?: number; y?: number }[] {
  const bursts: { t_ms: number; x?: number; y?: number }[] = [];
  let i = 0;
  while (i < clicks.length) {
    let j = i + 1;
    const base = clicks[i];
    while (
      j < clicks.length &&
      clicks[j].t_ms - clicks[j - 1].t_ms <= RAGE_BURST_MS &&
      near(base, clicks[j])
    ) {
      j++;
    }
    if (j - i >= RAGE_BURST_MIN) {
      bursts.push({ t_ms: base.t_ms, x: base.meta.x, y: base.meta.y });
    }
    i = j > i + 1 ? j : i + 1;
  }
  return bursts;
}

function near(a: UtEvent, b: UtEvent): boolean {
  if (a.meta.x == null || a.meta.y == null || b.meta.x == null || b.meta.y == null) {
    return true; // no positions → treat temporal proximity alone as same spot
  }
  const dx = a.meta.x - b.meta.x;
  const dy = a.meta.y - b.meta.y;
  return Math.hypot(dx, dy) <= RAGE_SAME_SPOT;
}

// Steps = segments between navigate events (a new screen loads). The transcript
// is a single untimestamped Scribe blob (see ut-result.tsx), so step boundaries
// come from navigate events + total duration, NOT transcript turn timestamps —
// a conservative reading of spec §2 given the stored transcript shape.
function computeSteps(events: UtEvent[], durationMs: number | null): UtStep[] {
  const total = durationMs ?? (events.length ? events[events.length - 1].t_ms : 0);
  const boundaries = events.filter((e) => e.type === 'navigate').map((e) => e.t_ms);
  const cuts = [0, ...boundaries, total].filter((v, i, a) => a.indexOf(v) === i).sort((x, y) => x - y);
  const steps: UtStep[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const start = cuts[i];
    const end = cuts[i + 1];
    if (end <= start) continue;
    steps.push({ index: steps.length, start_ms: start, end_ms: end, duration_ms: end - start });
  }
  // Always at least one step spanning the whole session.
  if (steps.length === 0 && total > 0) {
    steps.push({ index: 0, start_ms: 0, end_ms: total, duration_ms: total });
  }
  return steps;
}

// Friction hotspots: bucket the timeline into ~12 windows (min 3s each), score
// each by weighted friction, return the non-empty ones sorted by intensity.
function computeHotspots(events: UtEvent[], durationMs: number | null): UtHotspot[] {
  const total = durationMs ?? (events.length ? events[events.length - 1].t_ms + 1 : 0);
  if (total <= 0) return [];
  const windowMs = Math.max(3000, Math.round(total / 12));
  const buckets = new Map<number, { intensity: number; kinds: Set<UtEventType> }>();
  for (const e of events) {
    const w = FRICTION_WEIGHT[e.type];
    if (!w) continue;
    const key = Math.floor(e.t_ms / windowMs) * windowMs;
    const b = buckets.get(key) ?? { intensity: 0, kinds: new Set<UtEventType>() };
    b.intensity += w * (0.5 + 0.5 * e.confidence); // weight by confidence
    b.kinds.add(e.type);
    buckets.set(key, b);
  }
  return [...buckets.entries()]
    .map(([start_ms, b]) => ({
      start_ms,
      window_ms: windowMs,
      intensity: Math.round(b.intensity * 100) / 100,
      kinds: [...b.kinds],
    }))
    .sort((a, b) => b.intensity - a.intensity);
}

export function aggregateMetrics(rawEvents: UtEvent[], durationMs: number | null): BehaviorMetrics {
  const events = [...rawEvents].sort((a, b) => a.t_ms - b.t_ms);

  const counts = emptyCounts();
  for (const e of events) counts[e.type] += 1;

  // Rage-clicks: prefer the model's explicit rage_click tags; if it emitted
  // none, derive bursts from click events so the metric is never silently zero.
  const tagged = events.filter((e) => e.type === 'rage_click');
  const ragePoints =
    tagged.length > 0
      ? tagged.map((e) => ({ t_ms: e.t_ms, x: e.meta.x, y: e.meta.y }))
      : deriveRageBursts(events.filter((e) => e.type === 'click'));

  const hesitations = events.filter((e) => e.type === 'hover_hesitation');
  const hesitationDurations = hesitations.map((e) => e.meta.dur_ms ?? 0);
  const hesitationTotal = hesitationDurations.reduce((a, b) => a + b, 0);
  const hesitationMax = hesitationDurations.reduce((a, b) => Math.max(a, b), 0);

  const scrolls = events.filter((e) => e.type === 'scroll');
  const maxDepth = scrolls.reduce((a, e) => Math.max(a, e.meta.scroll_depth ?? 0), 0);

  const confSum = events.reduce((a, e) => a + e.confidence, 0);

  return {
    version: METRICS_VERSION,
    event_count: events.length,
    duration_ms: durationMs,
    counts_by_type: counts,
    rage_click_count: ragePoints.length,
    rage_click_points: ragePoints,
    backtrack_count: counts.backtrack,
    hesitation: {
      count: hesitations.length,
      total_ms: Math.round(hesitationTotal),
      max_ms: Math.round(hesitationMax),
    },
    scroll: { events: scrolls.length, max_depth: Math.round(maxDepth * 100) / 100 },
    steps: computeSteps(events, durationMs),
    hotspots: computeHotspots(events, durationMs),
    avg_confidence: events.length ? Math.round((confSum / events.length) * 100) / 100 : 0,
  };
}

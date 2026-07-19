// AI UT behavior-analytics — event taxonomy, wire schema, and the vision
// extraction prompt (card 622). This is the QUANTITATIVE layer: everything here
// is about machine-readable events + numbers. It intentionally carries NO
// qualitative narration ("what the user was thinking / why") — that belongs to
// card 626 (TwelveLabs). Keeping the split at the schema level is what prevents
// the two features from duplicating the video-analysis output.
import { z } from 'zod';

// Minimal quantitative taxonomy. Mirrors the CHECK constraint in
// 20260719001227_ut_events.sql — keep the two in lockstep.
export const UT_EVENT_TYPES = [
  'click',
  'scroll',
  'input',
  'navigate',
  'hover_hesitation',
  'rage_click',
  'backtrack',
] as const;
export type UtEventType = (typeof UT_EVENT_TYPES)[number];

// One inferred interaction event. `meta` is small quantitative context only —
// normalized cursor position, scroll depth, click-cluster size. NEVER sensitive
// captured text (masking.ts scrubs card/password-shaped strings before insert).
export type UtEvent = {
  t_ms: number;
  type: UtEventType;
  confidence: number; // 0..1 — inferred, not precise DOM
  meta: UtEventMeta;
};

export type UtEventMeta = {
  x?: number; // normalized 0..1 (cursor / target, left→right)
  y?: number; // normalized 0..1 (top→bottom)
  scroll_depth?: number; // 0..1 page scroll position at this moment
  cluster?: number; // repeated-click cluster size (rage_click)
  dur_ms?: number; // duration of the signal (hover_hesitation — precise ms)
  note?: string; // very short neutral tag (e.g. "button", "form field") — masked
};

// The model returns raw events; we validate + clamp before persisting. Unknown
// types are dropped (filtered by the enum), so a hallucinated type can't reach
// the DB CHECK and 500 the insert.
export const modelEventSchema = z.object({
  t_ms: z.number().finite().nonnegative(),
  type: z.enum(UT_EVENT_TYPES),
  confidence: z.number().min(0).max(1).optional().default(0.5),
  meta: z
    .object({
      x: z.number().min(0).max(1).optional(),
      y: z.number().min(0).max(1).optional(),
      scroll_depth: z.number().min(0).max(1).optional(),
      cluster: z.number().int().nonnegative().optional(),
      dur_ms: z.number().finite().nonnegative().optional(),
      note: z.string().max(60).optional(),
    })
    .partial()
    .optional()
    .default({}),
});

export const modelResponseSchema = z.object({
  events: z.array(modelEventSchema).default([]),
});

export type ModelEvent = z.infer<typeof modelEventSchema>;

// Gemini responseSchema (OpenAPI subset) — steers the model to emit exactly the
// event array shape so we parse deterministically. responseMimeType=json +
// this schema removes the "prose around the JSON" failure mode.
export const geminiResponseSchema = {
  type: 'object',
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          t_ms: { type: 'integer' },
          type: { type: 'string', enum: [...UT_EVENT_TYPES] },
          confidence: { type: 'number' },
          meta: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              scroll_depth: { type: 'number' },
              cluster: { type: 'integer' },
              dur_ms: { type: 'integer' },
              note: { type: 'string' },
            },
          },
        },
        required: ['t_ms', 'type', 'confidence'],
      },
    },
  },
  required: ['events'],
} as const;

// The extraction prompt. Hard boundaries: quantitative only, no narration, mask
// sensitive text, cite timestamps from the start of the clip. task_goal +
// target_url are neutral context so the model can segment step boundaries, NOT
// an invitation to editorialize about intent.
export function buildExtractionPrompt(ctx: {
  task_goal?: string | null;
  target_url?: string | null;
  duration_ms?: number | null;
}): string {
  const lines: string[] = [];
  if (ctx.target_url) lines.push(`Target site (context only): ${ctx.target_url}`);
  if (ctx.task_goal) lines.push(`Researcher task (context only): ${ctx.task_goal}`);
  if (ctx.duration_ms) lines.push(`Approx clip length: ${Math.round(ctx.duration_ms / 1000)}s`);
  const context = lines.length ? `\n\nContext:\n${lines.join('\n')}` : '';

  return `You are a QUANTITATIVE interaction-event extractor for a usability-test screen recording. Watch the video and output a machine-readable stream of interaction events with timestamps.

Emit these event types only:
- click: a mouse click on an interactive element
- scroll: a scroll gesture (put the resulting page position in meta.scroll_depth, 0=top 1=bottom)
- input: typing into a field
- navigate: the page/screen/URL changes (new view loads)
- hover_hesitation: the cursor lingers/hovers over one area with no action for a noticeably long time (a sign of confusion). Put the lingering duration in meta.dur_ms.
- rage_click: 3+ rapid clicks on the same spot (put the count in meta.cluster)
- backtrack: the user goes back / undoes / returns to a previous screen

Rules:
- t_ms = milliseconds from the START of the clip to the moment the event happens.
- confidence ∈ [0,1]: how sure you are the event occurred. The cursor and UI changes are inferred from pixels, not DOM, so be honest — use lower confidence when unsure.
- meta.x / meta.y = normalized cursor position (0..1). Include when you can locate the cursor/target.
- meta.note = at most a couple of neutral words for the element kind ("button", "menu", "form field", "link"). Do NOT describe intent or feelings.
- PRIVACY: never copy any on-screen text that looks like a password, card number, security code, email, or personal data into meta. If a field holds such data, use note "sensitive field" and nothing more.
- Output QUANTITATIVE events ONLY. Do NOT write summaries, narratives, explanations of why the user did something, or any qualitative commentary. Numbers and event rows only.
- If the video is unreadable or empty, return an empty events array.${context}

Return JSON matching the provided schema.`;
}

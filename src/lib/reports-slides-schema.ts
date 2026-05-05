import { z } from 'zod';

// Schema for the slide outline produced by /api/reports/slides.
// Kept intentionally lean — Anthropic refuses schemas whose compiled
// grammar gets too large, so we drop array .min/.max and enums and
// flatten nested objects (Cover meta, ThemeSplit verbatim) to top-level
// fields. The runtime renderer in /lib/reports-pptx tolerates anything
// missing.

const Cover = z.object({
  kind: z.literal('cover'),
  title: z.string(),
  subtitle: z.string().optional(),
  metaMethod: z.string().optional(),
  metaSample: z.string().optional(),
  metaPeriod: z.string().optional(),
  metaChapters: z.string().optional(),
});

const SectionDivider = z.object({
  kind: z.literal('section_divider'),
  eyebrow: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
});

const KpiGridItem = z.object({
  label: z.string(),
  value: z.string(),
  note: z.string().optional(),
});
const KpiGrid = z.object({
  kind: z.literal('kpi_grid'),
  eyebrow: z.string(),
  title: z.string(),
  items: z.array(KpiGridItem),
});

const InsightCard = z.object({
  heading: z.string(),
  body: z.string(),
});
const InsightCards = z.object({
  kind: z.literal('insight_cards'),
  eyebrow: z.string(),
  title: z.string(),
  cards: z.array(InsightCard),
});

const ThemeSplit = z.object({
  kind: z.literal('theme_split'),
  eyebrow: z.string(),
  title: z.string(),
  findings: z.array(z.string()),
  verbatimText: z.string().optional(),
  verbatimCite: z.string().optional(),
  implication: z.string().optional(),
});

const QuoteCard = z.object({
  kind: z.literal('quote_card'),
  eyebrow: z.string(),
  title: z.string(),
  quote: z.string(),
  cite: z.string().optional(),
  context: z.string().optional(),
});

const BarSeriesItem = z.object({
  label: z.string(),
  value: z.number(),
});
const BarChart = z.object({
  kind: z.literal('bar_chart'),
  eyebrow: z.string(),
  title: z.string(),
  note: z.string().optional(),
  valueSuffix: z.string().optional(),
  series: z.array(BarSeriesItem),
});

const Recommendation = z.object({
  headline: z.string(),
  detail: z.string().optional(),
  // Plain string instead of enum — model picks 'high'/'medium'/'low'.
  priority: z.string().optional(),
});
const Recommendations = z.object({
  kind: z.literal('recommendations'),
  eyebrow: z.string(),
  title: z.string(),
  items: z.array(Recommendation),
});

const Closing = z.object({
  kind: z.literal('closing'),
  title: z.string(),
  subtitle: z.string().optional(),
});

export const slideSchema = z.discriminatedUnion('kind', [
  Cover,
  SectionDivider,
  KpiGrid,
  InsightCards,
  ThemeSplit,
  QuoteCard,
  BarChart,
  Recommendations,
  Closing,
]);

export const slideOutlineSchema = z.object({
  slides: z.array(slideSchema),
});

export type SlideOutline = z.infer<typeof slideOutlineSchema>;
export type Slide = z.infer<typeof slideSchema>;

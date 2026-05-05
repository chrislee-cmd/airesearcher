import { z } from 'zod';

// Schema describing a presentation outline. Used by /api/reports/slides
// (server-side generateObject) and /lib/reports-pptx (client-side
// pptxgenjs renderer). Each slide kind has its own layout — we don't
// just dump bullets onto a generic template.

const Cover = z.object({
  kind: z.literal('cover'),
  title: z.string(),
  subtitle: z.string().optional(),
  meta: z.object({
    method: z.string().optional(),
    sample: z.string().optional(),
    period: z.string().optional(),
    chapters: z.string().optional(),
  }),
});

const SectionDivider = z.object({
  kind: z.literal('section_divider'),
  eyebrow: z.string(), // e.g. "CHAPTER 02"
  title: z.string(),
  subtitle: z.string().optional(),
});

const KpiGrid = z.object({
  kind: z.literal('kpi_grid'),
  eyebrow: z.string(),
  title: z.string(),
  items: z
    .array(
      z.object({
        label: z.string(), // small uppercase tag
        value: z.string(), // big number / phrase
        note: z.string().optional(),
      }),
    )
    .min(2)
    .max(4),
});

const InsightCards = z.object({
  kind: z.literal('insight_cards'),
  eyebrow: z.string(),
  title: z.string(),
  cards: z
    .array(
      z.object({
        heading: z.string(),
        body: z.string(),
      }),
    )
    .min(2)
    .max(4),
});

const ThemeSplit = z.object({
  kind: z.literal('theme_split'),
  eyebrow: z.string(),
  title: z.string(),
  findings: z.array(z.string()).min(1).max(6),
  verbatim: z
    .object({
      text: z.string(),
      cite: z.string().optional(),
    })
    .optional(),
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

const BarChart = z.object({
  kind: z.literal('bar_chart'),
  eyebrow: z.string(),
  title: z.string(),
  note: z.string().optional(),
  valueSuffix: z.string().optional(), // '%', 'pt', etc.
  series: z
    .array(
      z.object({
        label: z.string(),
        value: z.number(),
      }),
    )
    .min(2)
    .max(8),
});

const TableSlide = z.object({
  kind: z.literal('table'),
  eyebrow: z.string(),
  title: z.string(),
  columns: z.array(z.string()).min(2).max(5),
  rows: z.array(z.array(z.string())).min(1).max(8),
});

const Recommendations = z.object({
  kind: z.literal('recommendations'),
  eyebrow: z.string(),
  title: z.string(),
  items: z
    .array(
      z.object({
        headline: z.string(),
        detail: z.string().optional(),
        priority: z.enum(['high', 'medium', 'low']).optional(),
      }),
    )
    .min(1)
    .max(6),
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
  TableSlide,
  Recommendations,
  Closing,
]);

export const slideOutlineSchema = z.object({
  slides: z.array(slideSchema).min(3).max(40),
});

export type SlideOutline = z.infer<typeof slideOutlineSchema>;
export type Slide = z.infer<typeof slideSchema>;

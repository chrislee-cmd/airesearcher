import { z } from 'zod';

// Per-file extraction (Pass A): for one interview, the model returns the
// list of questions, each with a representative VOC quote taken directly
// from the source markdown. The VOC is sentence- to paragraph-length —
// long enough to convey the answer in the respondent's own voice.
export const extractItemSchema = z.object({
  question: z.string(),
  voc: z.string(),
});

export const fileExtractionSchema = z.object({
  items: z.array(extractItemSchema),
});

export type FileExtraction = z.infer<typeof fileExtractionSchema>;
export type ExtractItem = z.infer<typeof extractItemSchema>;

export type FileExtractionWithName = {
  filename: string;
  items: ExtractItem[];
};

// Cross-file matrix (Pass B): the final table. One cell per file per
// standard question. The cell content is the VOC quote (verbatim from
// source) — no separate "summary" field anymore.
export const interviewMatrixSchema = z.object({
  questions: z.array(z.string()),
  rows: z.array(
    z.object({
      question: z.string(),
      cells: z.array(
        z.object({
          filename: z.string(),
          voc: z.string(),
        }),
      ),
    }),
  ),
});

export type InterviewMatrix = z.infer<typeof interviewMatrixSchema>;

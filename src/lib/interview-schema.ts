import { z } from 'zod';

// Per-file extraction (Pass A): for one interview, the model returns the
// list of questions, each with a factual summary and a verbatim quote
// taken directly from the source markdown.
export const extractItemSchema = z.object({
  question: z.string(),
  summary: z.string(),
  verbatim: z.string(),
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

// Cross-file matrix (Pass B): the final table. Cells expose `summary`
// and `voc` (= verbatim) per file for backward compat with the UI / CSV /
// XLSX exports already shipped.
export const interviewMatrixSchema = z.object({
  questions: z.array(z.string()),
  rows: z.array(
    z.object({
      question: z.string(),
      cells: z.array(
        z.object({
          filename: z.string(),
          summary: z.string(),
          voc: z.string(),
        }),
      ),
    }),
  ),
});

export type InterviewMatrix = z.infer<typeof interviewMatrixSchema>;

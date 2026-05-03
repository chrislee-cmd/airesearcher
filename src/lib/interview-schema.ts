import { z } from 'zod';

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

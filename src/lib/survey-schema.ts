import { z } from 'zod';

// Question kinds we map directly onto the Google Forms API. The names
// match what forms.googleapis.com expects so the generation route's
// output can be translated 1:1 into a `forms.batchUpdate` payload.
export const surveyQuestionKindEnum = z.enum([
  'short_answer', // TEXT_QUESTION (paragraph=false)
  'long_answer',  // TEXT_QUESTION (paragraph=true)
  'single_choice', // CHOICE_QUESTION RADIO
  'multi_choice',  // CHOICE_QUESTION CHECKBOX
  'dropdown',      // CHOICE_QUESTION DROP_DOWN
  'scale',         // SCALE_QUESTION (1..N)
]);
export type SurveyQuestionKind = z.infer<typeof surveyQuestionKindEnum>;

export const surveyQuestionSchema = z.object({
  kind: surveyQuestionKindEnum,
  title: z.string().describe('질문 본문'),
  description: z
    .string()
    .describe('보충 설명. 없으면 빈 문자열.'),
  required: z.boolean(),
  // For *_choice / dropdown
  options: z
    .array(z.string())
    .describe(
      '선택지 라벨. single/multi/dropdown일 때만 사용, 그 외에는 빈 배열.',
    ),
  // For scale
  scaleMin: z
    .number()
    .int()
    .describe('scale 일 때 최소값(0 또는 1). 그 외 0.'),
  scaleMax: z
    .number()
    .int()
    .describe('scale 일 때 최대값(<=10). 그 외 0.'),
  scaleMinLabel: z
    .string()
    .describe('scale 좌측 라벨. 미사용시 빈 문자열.'),
  scaleMaxLabel: z
    .string()
    .describe('scale 우측 라벨. 미사용시 빈 문자열.'),
});
export type SurveyQuestion = z.infer<typeof surveyQuestionSchema>;

export const surveySchema = z.object({
  title: z.string().describe('설문 제목'),
  description: z.string().describe('설문 안내문'),
  sections: z
    .array(
      z.object({
        title: z
          .string()
          .describe(
            '섹션명. 스크리너 설문이므로 본 조사형 섹션(사용 경험/구매 행태/만족도 등)은 만들지 말 것. 허용 섹션 예: "기본 정보", "자격 조건", "동의 및 일정", "인적사항".',
          ),
        questions: z.array(surveyQuestionSchema),
      }),
    )
    .describe(
      '스크리너 설문 — 섹션은 2~4개. 본 조사용 섹션 금지. 마지막 섹션은 항상 "인적사항".',
    ),
});
export type Survey = z.infer<typeof surveySchema>;

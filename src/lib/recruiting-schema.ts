import { z } from 'zod';

export const recruitingBriefSchema = z.object({
  summary: z
    .string()
    .describe('업로드된 자료의 한 문장 요약 (조사 목적/대상)'),
  criteria: z
    .array(
      z.object({
        category: z
          .string()
          .describe('조건 카테고리. 예: 인구통계, 직업, 사용 경험, 라이프스타일'),
        label: z.string().describe('조건의 짧은 라벨. 예: "연령 25-34"'),
        detail: z
          .string()
          .describe('조건의 구체 설명. 한 문장.'),
        required: z
          .boolean()
          .describe('필수 조건이면 true, 우대/선호 조건이면 false'),
      }),
    )
    .describe(
      '대상자 모집 조건을 가능한 한 잘게 쪼개어 항목별로. 6~20개 권장.',
    ),
  schedule: z
    .array(
      z.object({
        phase: z
          .string()
          .describe('단계명. 예: "스크리닝", "본 인터뷰", "리포팅", "보상 지급"'),
        startDate: z
          .string()
          .nullable()
          .describe('YYYY-MM-DD. 명시되지 않으면 null.'),
        endDate: z
          .string()
          .nullable()
          .describe('YYYY-MM-DD. 단일일이면 startDate와 동일. 미명시 null.'),
        note: z
          .string()
          .describe('보충 설명 (장소, 형식, 회당 시간 등). 없으면 빈 문자열.'),
      }),
    )
    .describe('조사 일정. 자료에 일정이 없으면 빈 배열.'),
});

export type RecruitingBrief = z.infer<typeof recruitingBriefSchema>;

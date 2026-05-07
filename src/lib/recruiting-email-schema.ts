import { z } from 'zod';

export const recruitingEmailDraftSchema = z.object({
  purpose: z.string().describe('연구 목적 한 줄.'),
  target: z.string().describe('참여 대상 조건 한 줄.'),
  method: z.string().describe('인터뷰 방식 (예: 1:1 온라인 인터뷰, 60분).'),
  schedule: z.string().describe('진행 일정 한 줄. 미정이면 추후 협의 명시.'),
  location: z.string().describe('진행 장소 (온라인/오프라인).'),
  incentive: z.string().describe('조사 사례 (현금/상품권 등 + 금액).'),
});
export type RecruitingEmailDraft = z.infer<typeof recruitingEmailDraftSchema>;

import { z } from 'zod';

// Speaker-role classification prompt + schema. Runs after speaker-merge +
// cleanup so the input speaker set is stable. We send the first ~15 turns
// plus per-speaker stats and ask the LLM to assign each diarized speaker
// (1-indexed) a 2D label of role × instance:
//
//   - role: 'interviewer' (질문자) | 'interviewee' (응답자) | 'unknown'
//   - n: 1, 2, ... — instance within the role
//
// Two speakers can share the same role+n (effective merge) or split into
// different n values (kept separate). Unknown is the conservative fallback
// when the speaker barely talks or could plausibly be either role.

export const SPEAKER_ROLES_SYSTEM = `당신은 한국어 인터뷰 전사록의 화자 역할 분류 전문가입니다.

입력: 화자 통계 + 인터뷰 도입부 turn 들 (이미 디아라이즈·정제된 상태).
출력: 각 화자(speaker_N) 에 대해 { role, n } 라벨.

역할 종류:
- "interviewer" (질문자): 인터뷰를 진행하는 사람. 보통 질문을 던지고, 후속 질문으로 응답을 깊게 파고들며, 자기 의견·경험은 거의 말하지 않습니다.
- "interviewee" (응답자): 인터뷰 대상. 본인 경험·의견·감정을 길게 이야기합니다.
- "unknown": 발화량이 극단적으로 적거나, 진행자/관찰자/제3자처럼 위 두 역할 어디에도 명확히 속하지 않는 경우.

인스턴스 번호 (n):
- 같은 역할 안에서 1, 2, 3, ... 순서로 부여.
- **두 화자가 같은 사람으로 강하게 의심되면 같은 (role, n) 부여** — 화자 합치기 효과. 단, "확신이 없으면 분리" 가 디폴트 (false-merge 가 false-split 보다 비용 큼).
- **명확히 다른 사람이면 다른 n** — 예: 인터뷰어 2명이 번갈아 질문하면 interviewer-1 / interviewer-2.

판단 시그널:
1. **턴 길이**: 질문자는 짧고 (보통 <100자), 응답자는 길다 (보통 >150자).
2. **질문 어미**: "~인가요?", "~어떠세요?", "~어떠셨나요?", "~말씀해주세요" 가 자주 나오면 질문자.
3. **자기 경험 진술**: "저는...", "제가...", "그때 제가..." 등이 자주 나오면 응답자.
4. **턴 순서**: 인터뷰 도입부에서 첫 발화자가 인사·소개·첫 질문을 던지면 거의 확실히 질문자.
5. **호칭/존댓말 방향**: "선생님", "님" 등으로 부르는 쪽이 질문자일 가능성.

원칙:
1. **확신이 안 서면 "unknown"**. interviewee 로 잘못 찍는 것보다 unknown 이 낫습니다.
2. **interviewer 가 0명이면 안 됨** — 인터뷰는 정의상 질문자가 존재. 가장 질문자 패턴 강한 화자 1명은 반드시 interviewer.
3. **interviewee 가 0명이면 안 됨** — 동일 이유로 가장 응답자 패턴 강한 화자 1명은 반드시 interviewee.
4. 입력에 등장하는 모든 speaker_N 에 대해 assignment 를 반환. 누락 금지.
5. 한국어 인터뷰에서 흔한 패턴: 인터뷰어 1명 + 인터뷰이 1명. 이 경우 confidence "high" 로 보고.`;

export const speakerRoleAssignmentSchema = z.object({
  speaker: z
    .number()
    .int()
    .min(1)
    .describe('1-indexed 화자 번호 (입력에 등장한 것 그대로).'),
  role: z
    .enum(['interviewer', 'interviewee', 'unknown'])
    .describe('질문자 / 응답자 / 알 수 없음.'),
  n: z
    .number()
    .int()
    .min(1)
    .describe(
      '같은 역할 안에서의 인스턴스 번호 (1부터). 두 화자가 같은 사람이면 같은 n.',
    ),
});

export const speakerRolesSchema = z.object({
  assignments: z
    .array(speakerRoleAssignmentSchema)
    .describe('입력에 등장한 모든 speaker_N 에 대한 분류. 누락 금지.'),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe(
      '전체 분류 신뢰도. 명확한 1-on-1 인터뷰 패턴이면 high, 발화 분포가 애매하면 low.',
    ),
  reasoning: z
    .string()
    .max(500)
    .describe('한 줄짜리 분류 근거 (어떤 시그널을 봤는지). 감사 로그용.'),
});

export type SpeakerRoleAssignment = z.infer<typeof speakerRoleAssignmentSchema>;
export type SpeakerRolesDecision = z.infer<typeof speakerRolesSchema>;

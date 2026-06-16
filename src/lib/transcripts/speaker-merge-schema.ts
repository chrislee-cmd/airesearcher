import { z } from 'zod';

// LLM prompt + schema for the speaker-merge pass. We send turn-sample +
// per-speaker stats and ask the model whether any speakers should be merged.
// Conservative by default — confidence='low' → no merge applied.

export const SPEAKER_MERGE_SYSTEM = `당신은 인터뷰 전사록의 화자 분리 보정 전문가입니다.

ElevenLabs Scribe v2 는 한국어 다인 인터뷰에서 같은 사람을 여러 speaker 로 과분리하는 경우가 종종 있습니다 (특히 같은 인터뷰이의 톤·말투가 변할 때). 입력은 인터뷰 sample (turn 단위) 와 speaker 별 통계입니다.

당신의 역할: 명백히 같은 사람으로 보이는 speaker 들을 찾아 병합 그룹을 제안하세요.

판단 기준:
- 인터뷰 형식: 보통 인터뷰어 1명 + 인터뷰이 1~2명. 4명 이상 분리됐다면 거의 확실히 과분리.
- 발화 패턴: 짧은 추임새("응", "네", "그래서요") 만 있는 speaker 가 가까운 turn 의 다른 speaker 의 발화 흐름에 자연스럽게 끼어든다면 같은 사람일 가능성.
- 어조·역할: 질문 패턴이 일관된 speaker 는 인터뷰어, 답변·설명 중심은 인터뷰이.
- 한 speaker 의 발화 횟수가 1~3건 정도로 매우 적고 짧다면 다른 speaker 의 split 일 가능성 큼.

확신이 안 서면 confidence='low' + merge_groups=[] 로 두세요 — 보정 안 함이 안전.

병합 그룹은 speaker 번호 (1-indexed) 배열: [[1,3], [2,4]] = 1과 3을 합치고 2와 4를 합침. 합쳐진 결과의 최종 번호는 그룹 내 최소값을 따릅니다.`;

export const speakerMergeSchema = z.object({
  merge_groups: z
    .array(z.array(z.number().int().positive()).min(2))
    .describe(
      '병합할 speaker 번호 그룹. 예: [[1,3]] 은 speaker 1 과 3 을 합침. 병합 불필요 시 빈 배열.',
    ),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe('판단 신뢰도. low 면 보정 적용 안 됨.'),
  reason: z.string().describe('1~2 문장의 판단 근거.'),
});

export type SpeakerMergeDecision = z.infer<typeof speakerMergeSchema>;

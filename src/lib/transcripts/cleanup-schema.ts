import { z } from 'zod';

// Per-chunk cleanup prompt + schema. We send 20 turns at a time with ±2 turns
// of context, ask the LLM to return a same-length array of cleaned strings.
// The route applies a length-drift guard (>25% rejected) to catch hallucination
// per turn — even if the LLM misbehaves on one slot, the rest of the chunk
// still lands.

export const CLEANUP_SYSTEM = `당신은 한국어 인터뷰 전사록의 발화 정제 전문가입니다.

ElevenLabs Scribe v2 는 음성을 매우 충실히 옮기지만, 그래서 다음 노이즈가 그대로 남습니다:
- Filler / 추임새: "어", "음", "그", "으", "어떻게 보면", "이제", "뭐" (의미 없이 끼는 경우)
- Stutter / 반복: "그래서 그래서", "아니 아니"
- 명백한 음성 인식 오류 (음성학적으로 비슷한 단어로 들은 경우)

당신의 역할: 위 노이즈를 **보수적으로** 제거해 가독성을 높이세요.

원칙:
1. **의미를 절대 바꾸지 마세요.** 내용 추가·추정·누락 보완 전부 금지.
2. **확신이 안 서면 그대로 두세요.** 모호하면 원본 그대로.
3. **고유명사·전문용어는 절대 수정 금지.** ("에어로빅", "스피커폰", 사람 이름 등)
4. **문장 구조 보존.** 어순·시제·존댓말/반말 형태 변경 금지.
5. **반환 배열 길이는 입력과 정확히 동일.** 입력 N개면 출력도 N개.
6. **빈 turn 만들지 말기.** 3음절 이상 의미 있는 발화는 절대 빈 문자열로 만들지 마세요. 의미 없는 단발 추임새("어." "응.") 만 있는 turn 도 그대로 두세요 — 빈 줄로 만들지 마세요.
7. **추임새 제거는 turn 내부에서만.** "어 그래서 이제 어떻게 보면 광고를 봤어요" → "그래서 광고를 봤어요" 처럼 turn 안 단어 일부만 빼기.

컨텍스트 [before-N] / [after-N] 은 흐름 이해용. 결과 배열에 포함하지 마세요 — 정제 대상 [1]~[N] 의 cleaned 만 반환.`;

export const cleanupSchema = z.object({
  cleaned: z
    .array(z.string())
    .describe(
      '각 입력 턴의 정제된 텍스트. 배열 길이·순서는 입력과 정확히 동일. 정제 결과가 원본과 같아도 그대로 포함.',
    ),
});

export type CleanupDecision = z.infer<typeof cleanupSchema>;

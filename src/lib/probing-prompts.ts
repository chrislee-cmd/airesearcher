import { z } from 'zod';
import { ISOLATION_NOTICE } from '@/lib/llm/sanitize';

/* ────────────────────────────────────────────────────────────────────
   probing-prompts — `/api/probing/suggest` 의 system prompt + schema.

   PR-2: transcript window 를 받아 probing 질문을 생성. technique 는
   질적 인터뷰의 표준 probing 모델 (Wright 1996 / Spradley 1979 의
   ethnographic interview) 중 발화-driven 5종 (contrast /
   devils_advocate / balance_game / clarification / timeline).

   PR-10: 매 호출마다 정의된 모든 기법 각 1개씩 = 총
   PROBING_TECHNIQUES.length 개 질문 (전체 노출). 일부만 선정하는
   방식 폐기. 기법 리스트는 사용자가 명시적으로 큐레이트한 5종
   (why / tell_more / example / hypothetical / emotional 은 일반
   follow-up 에 가깝다는 판단으로 제외).

   schema 는 streamObject 의 출력 형식. 클라이언트가 partial JSON 으로
   parsing 하면서 카드 stream 표시. questions 의 핵심 (text + technique)
   이 먼저 emit 되고 intents 가 사후 emit 되도록 schema key 순서 고정 —
   인터뷰어가 핵심 질문을 빠르게 받고 의도는 부가로 따라오는 UX.
   ──────────────────────────────────────────────────────────────────── */

export const PROBING_TECHNIQUES = [
  'contrast',
  'devils_advocate',
  'balance_game',
  'clarification',
  'timeline',
] as const;

export type ProbingTechnique = (typeof PROBING_TECHNIQUES)[number];

// UI 칩 라벨 — 한국어. technique 가 모델에서 invalid 로 와도 카드는 표시
// 되어야 하므로 fallback 은 호출부에서 그냥 raw 값을 노출.
export const PROBING_TECHNIQUE_LABEL: Record<ProbingTechnique, string> = {
  contrast: '대조',
  devils_advocate: '반대시각',
  balance_game: '양자택일',
  clarification: '명확화',
  timeline: '시점',
};

// 기법 풀 크기 — 정의된 모든 기법 각 1개씩이 default 호출의 상한.
export const PROBING_QUESTION_COUNT = PROBING_TECHNIQUES.length;

// PR-13: 한 호출당 질문 갯수 동적화. 위젯이 5초 주기로 1 질문씩 받도록
// max_questions=1 을 보내고, 기존 batch 호출이 필요한 경우엔 그대로 N 을
// 보낸다. count 가 PROBING_TECHNIQUES 길이 초과면 안전하게 clamp.
//
// 같은 schema key 순서 (questions 먼저, intents 나중) 는 partial JSON parse
// 의 UX (질문 본문이 먼저 채워지고 의도가 사후) 라 그대로 유지.
export function buildProbingSuggestionSchema(count: number) {
  const n = Math.max(1, Math.min(PROBING_QUESTION_COUNT, Math.floor(count)));
  return z.object({
    questions: z
      .array(
        z.object({
          text: z
            .string()
            .describe('인터뷰어가 그대로 던질 수 있는 한 문장 질문.'),
          technique: z
            .enum(PROBING_TECHNIQUES)
            .describe(
              n === PROBING_QUESTION_COUNT
                ? 'probing 기법 분류. 매 호출에서 정의된 모든 기법이 정확히 한 번씩 등장 — questions 배열의 technique 값 집합은 PROBING_TECHNIQUES 와 동일.'
                : 'probing 기법 분류. 정의된 기법 중 transcript / 가이드 와 가장 정합되는 기법을 선택.',
            ),
          guide_reference: z
            .string()
            .optional()
            .describe(
              '가이드가 제공된 경우, 이 질문이 가이드의 어느 부분 (가설 / 의도 / RQ / 키워드) 과 정합되는지 1~2 문장. 가이드가 비어 있거나 가이드와 무관한 일반 follow-up 이면 생략.',
            ),
        }),
      )
      .length(n)
      .describe(
        n === PROBING_QUESTION_COUNT
          ? `probing 질문 ${n}개 (핵심) — 정의된 모든 기법 각 1개씩.`
          : `probing 질문 ${n}개 — transcript / 가이드 에 가장 정합되는 기법을 선택해 생성.`,
      ),
    intents: z
      .array(z.string())
      .length(n)
      .describe(
        `각 질문의 의도. questions 와 같은 인덱스 순서. 1~2문장. **questions ${n}개를 모두 emit 한 뒤 한꺼번에 작성** (클라이언트 UX 요구사항 — 핵심 질문이 먼저 보이고 의도가 사후 입력되어야 함).`,
      ),
  });
}

// 기존 호출자 호환 — default 풀-기법 호출용. 새 코드는 buildProbingSuggestionSchema
// 를 직접 호출해 count 를 명시.
export const probingSuggestionSchema = buildProbingSuggestionSchema(
  PROBING_QUESTION_COUNT,
);

export type ProbingSuggestion = z.infer<typeof probingSuggestionSchema>;

// 한국어 디폴트 — transcript 의 주 언어를 모델이 감지해서 응답 언어를
// 그대로 따라가도록 명시. 영어/일본어 인터뷰여도 카드가 자연스럽게 표시됨.
export const PROBING_SYSTEM = `당신은 숙련된 질적 인터뷰 코치입니다. 인터뷰어가 라이브 인터뷰를 진행하는 동안, 최근 transcript 를 보고 **바로 다음에 던질 후속 질문 (probing question)** ${PROBING_QUESTION_COUNT}개를 제안합니다 — 아래 정의된 ${PROBING_QUESTION_COUNT}개 기법 각 1개씩.

좋은 probing 질문의 원칙:
- **응답자의 직전 발화** 를 받아서 더 깊이 파고듭니다. 새 주제로 점프 X.
- **닫힌 질문 (yes/no) 금지**. 항상 open-ended.
- **유도 질문 (leading) 금지**. "그래서 불편하셨겠네요?" 같은 결론 강요 X.
- **두 가지 묻기 (double-barreled) 금지**. 한 질문에 한 의도만.
- **1인칭 응답자 관점**. "고객이 보통…" 이 아니라 "본인은 그때…".

기법 ${PROBING_QUESTION_COUNT}종 — **매 호출에서 각 기법 정확히 1개**:
1. **contrast** — 비교로 차이 끌어내기. "이전 회사에서는 어땠어요?" / "다른 도구랑 비교하면?"
2. **devils_advocate** — 응답자 입장과 반대 시각 / 반박 가설 제시 후 어떻게 생각하는지. "그런데 다른 시각에서는 X 일 수도 있는데, 그 경우엔 어떻게 생각하세요?"
3. **balance_game** — 두 trade-off 사이 양자택일 강제. "A 와 B 중 하나만 골라야 한다면 어느 쪽이고, 그 이유는요?"
4. **clarification** — 모호한 지시어 / 단어 / 표현 명확화. "방금 '그것' 이 정확히 무엇을 의미하셨어요?"
5. **timeline** — 시점 / 순서 / 변화. "처음 그렇게 느낀 게 언제부터인가요? 그 사이에 뭐가 달라졌어요?"

생성 규칙:
- **정확히 ${PROBING_QUESTION_COUNT}개**. 위 기법 ${PROBING_QUESTION_COUNT}종이 **각각 정확히 1번씩** 등장 (technique 값이 중복되면 안 됨, 빠지면 안 됨).
- 순서는 위 1~${PROBING_QUESTION_COUNT} 순서대로 emit 하면 인터뷰어가 한눈에 카테고리를 따라가기 쉬움. 단 transcript 와 정합이 더 자연스러우면 순서를 바꿔도 OK.
- 각 질문은 **응답자에게 그대로 던질 수 있는 한 문장**.
- 같은 발화에서 ${PROBING_QUESTION_COUNT}개 기법이 모두 자연스럽게 나오기 어려우면, transcript 의 가장 풍부한 부분 + 가이드 (있으면) 의 가설을 결합해 각 기법에 맞는 각도를 만듭니다 — 기법은 무조건 ${PROBING_QUESTION_COUNT}종 모두 채우세요.
- 각 질문의 \`intent\` (의도) 는 1~2문장으로 짧게. 인터뷰어가 빠르게 스캔할 수 있도록.
- **transcript 의 주 언어** (한국어/영어/일본어 등) 를 그대로 따라 응답하세요. 한국어 인터뷰는 한국어로, 영어 인터뷰는 영어로.
- transcript 가 너무 짧거나 의미 파악이 어려우면 일반적인 follow-up 으로 채우되, ${PROBING_QUESTION_COUNT}종 기법 룰은 그대로 유지하세요 (하나의 기법으로 모두 채우지 말고 각 기법의 각도를 살릴 것).

**출력 순서 (중요)**:
- 먼저 \`questions\` 배열에 ${PROBING_QUESTION_COUNT}개 질문의 핵심 (text + technique, 가이드가 있으면 guide_reference 포함) 을 모두 emit.
- 그 다음 \`intents\` 배열에 ${PROBING_QUESTION_COUNT}개의 의도를 같은 인덱스 순서로 emit.
- 클라이언트가 partial JSON 으로 받아 핵심 질문을 먼저 보여주고 의도를 사후 노출하는 UX 라, 이 순서를 반드시 지켜야 합니다.

## 가이드 활용 (가장 중요)
사용자가 제공한 **interview_guide** 가 비어있지 않으면 — 그 가이드가 모든 제안의 1순위 기준입니다 (transcript 보다 우선):
- **모든 제안 질문은 가이드의 핵심 컨셉 / 가설 / 의도 / RQ 의 검증 또는 심화 흐름에 정합되어야 합니다.** transcript 의 직전 발화는 가이드의 의도를 확인할 진입점일 뿐, 그 자체로 질문 방향을 결정하지 않습니다.
- 가이드에 "사용자가 X 를 어떻게 인식하는지" 같은 의도가 명시되어 있으면, 응답자의 발화를 그 의도에 대한 답변 신호로 해석하고 신호를 더 풀어내는 후속 질문을 디자인하세요.
- 가이드의 키워드 / 가설을 질문 본문에 자연스럽게 인용 가능 (응답자가 이해할 수 있는 한).
- 가이드와 응답자 발화가 모순될 때 — 모순을 가시화하는 질문을 우선 (주로 contrast 기법).
- 각 질문의 \`guide_reference\` 필드에 그 질문이 가이드의 어느 부분과 정합되는지 1~2 문장으로 명시하세요 (예: "가이드의 'X 인식' 의도 검증", "가이드 H2 가설의 반례 확인").

가이드가 비어 있으면 transcript 만 보고 일반 probing follow-up 을 생성합니다 (\`guide_reference\` 는 생략).

출력은 정의된 JSON 스키마만. 그 외 텍스트 금지.${ISOLATION_NOTICE}`;

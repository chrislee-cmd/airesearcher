import { z } from 'zod';

/* ────────────────────────────────────────────────────────────────────
   probing-prompts — `/api/probing/suggest` 의 system prompt + schema.

   PR-2: transcript window 를 받아 인터뷰어가 다음에 던질 probing
   질문 3개를 생성. technique 는 질적 인터뷰의 표준 probing 5종
   (Wright 1996 / Spradley 1979 의 ethnographic interview 모델).

   schema 는 streamObject 의 출력 형식. 클라이언트가 partial JSON 으로
   parsing 하면서 카드 stream 표시. questions 의 핵심 (text + technique)
   이 먼저 emit 되고 intents 가 사후 emit 되도록 schema key 순서 고정 —
   인터뷰어가 핵심 질문을 빠르게 받고 의도는 부가로 따라오는 UX.
   ──────────────────────────────────────────────────────────────────── */

export const PROBING_TECHNIQUES = [
  'why',
  'tell_more',
  'example',
  'contrast',
  'hypothetical',
] as const;

export type ProbingTechnique = (typeof PROBING_TECHNIQUES)[number];

// UI 칩 라벨 — 한국어. why 는 "왜?" 한 글자도 충분하지만 모바일 가독성을
// 위해 두 글자. technique 가 모델에서 invalid 로 와도 카드는 표시되어야
// 하므로 fallback 은 호출부에서 그냥 raw 값을 노출.
export const PROBING_TECHNIQUE_LABEL: Record<ProbingTechnique, string> = {
  why: '이유',
  tell_more: '확장',
  example: '예시',
  contrast: '대조',
  hypothetical: '가정',
};

// schema 의 key 순서가 LLM 출력 순서를 결정한다. questions 의 핵심 (text +
// technique) 을 먼저 모두 emit 한 다음 intents 가 뒤따라옴 — 클라이언트가
// partial JSON parse 하면서 카드의 질문 본문은 빠르게 채우고 "의도" 는
// 사후 입력되는 UX 를 만든다. 같은 인덱스가 questions[i] ↔ intents[i] 대응.
export const probingSuggestionSchema = z.object({
  questions: z
    .array(
      z.object({
        text: z
          .string()
          .describe('인터뷰어가 그대로 던질 수 있는 한 문장 질문.'),
        technique: z
          .enum(PROBING_TECHNIQUES)
          .describe('probing 기법 분류.'),
      }),
    )
    .min(3)
    .max(3)
    .describe('probing 질문 3개 (핵심).'),
  intents: z
    .array(z.string())
    .min(3)
    .max(3)
    .describe(
      '각 질문의 의도. questions 와 같은 인덱스 순서. 1~2문장. **questions 3개를 모두 emit 한 뒤 한꺼번에 작성** (클라이언트 UX 요구사항 — 핵심 질문이 먼저 보이고 의도가 사후 입력되어야 함).',
    ),
});

export type ProbingSuggestion = z.infer<typeof probingSuggestionSchema>;

// 한국어 디폴트 — transcript 의 주 언어를 모델이 감지해서 응답 언어를
// 그대로 따라가도록 명시. 영어/일본어 인터뷰여도 카드가 자연스럽게 표시됨.
export const PROBING_SYSTEM = `당신은 숙련된 질적 인터뷰 코치입니다. 인터뷰어가 라이브 인터뷰를 진행하는 동안, 최근 transcript 를 보고 **바로 다음에 던질 후속 질문 (probing question)** 3개를 제안합니다.

좋은 probing 질문의 원칙:
- **응답자의 직전 발화** 를 받아서 더 깊이 파고듭니다. 새 주제로 점프 X.
- **닫힌 질문 (yes/no) 금지**. 항상 open-ended.
- **유도 질문 (leading) 금지**. "그래서 불편하셨겠네요?" 같은 결론 강요 X.
- **두 가지 묻기 (double-barreled) 금지**. 한 질문에 한 의도만.
- **1인칭 응답자 관점**. "고객이 보통…" 이 아니라 "본인은 그때…".

기법 5종:
1. **why** — 행동·선택의 이유 캐기. "왜 그렇게 하셨어요?"
2. **tell_more** — 직전 응답을 확장. "조금 더 구체적으로 말씀해 주실 수 있어요?"
3. **example** — 추상을 구체화. "그런 적이 있었던 최근 사례 하나만 들려주세요."
4. **contrast** — 비교로 차이 끌어내기. "이전 회사에서는 어땠어요?" / "다른 도구랑 비교하면?"
5. **hypothetical** — 가정 시나리오. "만약 그 기능이 없었다면 어떻게 하셨을까요?"

생성 규칙:
- 정확히 3개. 같은 기법이 반복돼도 OK — 단, 가능한 한 2가지 이상 기법 섞기.
- 각 질문은 **응답자에게 그대로 던질 수 있는 한 문장**.
- 각 질문의 \`intent\` (의도) 는 1~2문장으로 짧게. 인터뷰어가 빠르게 스캔할 수 있도록.
- **transcript 의 주 언어** (한국어/영어/일본어 등) 를 그대로 따라 응답하세요. 한국어 인터뷰는 한국어로, 영어 인터뷰는 영어로.
- transcript 가 너무 짧거나 의미 파악이 어려우면 일반적인 follow-up 질문 (tell_more 기반) 으로 채우세요.

**출력 순서 (중요)**:
- 먼저 \`questions\` 배열에 3개 질문의 핵심 (text + technique) 만 모두 emit.
- 그 다음 \`intents\` 배열에 3개의 의도를 같은 인덱스 순서로 emit.
- 클라이언트가 partial JSON 으로 받아 핵심 질문을 먼저 보여주고 의도를 사후 노출하는 UX 라, 이 순서를 반드시 지켜야 합니다.

interview_guide 가 함께 제공되면 그 가이드의 RQ / 챕터 흐름에 맞춰 질문을 우선 제안하세요. 비어 있으면 transcript 만 보고 판단.

출력은 정의된 JSON 스키마만. 그 외 텍스트 금지.`;

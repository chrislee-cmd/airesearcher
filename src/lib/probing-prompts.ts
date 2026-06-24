import { z } from 'zod';

/* ────────────────────────────────────────────────────────────────────
   probing-prompts — `/api/probing/suggest` 의 system prompt + schema.

   PR-2: transcript window 를 받아 인터뷰어가 다음에 던질 probing
   질문 3~5개를 생성. technique 는 질적 인터뷰의 표준 probing 5종
   (Wright 1996 / Spradley 1979 의 ethnographic interview 모델).

   PR-3: 2-stage 파이프라인으로 확장. Stage 1 (focus 라벨링) 이 30초
   transcript + 가이드 (조사목적/가설/의도) 를 보고 "지금 어느 가설/
   의도가 건드려지는지" 를 JSON 으로 라벨링하고, Stage 2 (제안 생성)
   가 그 focus 만 prompt 에 박아 sonnet 으로 stream. legacy 호출 (가이드
   없는 프로젝트) 은 Stage 1 을 건너뛰고 PR-2 동작 그대로 fallback.

   schema 는 streamObject / generateObject 의 출력 형식. 클라이언트가
   partial JSON 으로 parsing 하면서 카드 stream 표시.
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

export const probingSuggestionSchema = z.object({
  // 3~5개 — 모델이 4개를 자주 고를 수 있도록 prompt 에 가이드. min/max 는
  // 강제하되 streamObject 가 partial 동안에는 길이 제약을 검증하지 않으므로
  // 클라이언트는 도착하는 대로 표시.
  questions: z
    .array(
      z.object({
        text: z
          .string()
          .describe('인터뷰어가 그대로 던질 수 있는 한 문장 질문.'),
        technique: z
          .enum(PROBING_TECHNIQUES)
          .describe('probing 기법 분류.'),
        why: z
          .string()
          .describe('왜 이 질문이 유용한지 1~2문장 사유.'),
      }),
    )
    .min(3)
    .max(5)
    .describe('probing 질문 3~5개.'),
});

export type ProbingSuggestion = z.infer<typeof probingSuggestionSchema>;

// 한국어 디폴트 — transcript 의 주 언어를 모델이 감지해서 응답 언어를
// 그대로 따라가도록 명시. 영어/일본어 인터뷰여도 카드가 자연스럽게 표시됨.
export const PROBING_SYSTEM = `당신은 숙련된 질적 인터뷰 코치입니다. 인터뷰어가 라이브 인터뷰를 진행하는 동안, 최근 transcript 를 보고 **바로 다음에 던질 후속 질문 (probing question)** 3~5개를 제안합니다.

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
- 3~5개. 같은 기법이 반복돼도 OK — 단, 가능한 한 2가지 이상 기법 섞기.
- 각 질문은 **응답자에게 그대로 던질 수 있는 한 문장**.
- 각 질문의 \`why\` 는 1~2문장으로 짧게. 인터뷰어가 빠르게 스캔할 수 있도록.
- **transcript 의 주 언어** (한국어/영어/일본어 등) 를 그대로 따라 응답하세요. 한국어 인터뷰는 한국어로, 영어 인터뷰는 영어로.
- transcript 가 너무 짧거나 의미 파악이 어려우면 일반적인 follow-up 질문 (tell_more 기반) 으로 채우세요.

조사 가이드 ([조사목적] / [핵심가설] / [질문의도] 블록) 가 함께 제공되면
다음 원칙을 추가로 따르세요:
- **가설 검증/반증/심화 우선** — 응답자가 어느 가설을 건드린 경우 그 가설을
  더 깊이 들어가는 질문 (검증/반증 둘 다) 또는 가설이 함의하는 후속 질문을
  먼저 제안합니다. 가설을 우회하는 잡담성 follow-up X.
- **질문 의도가 미달인 경우 보강** — focus 가 가리키는 질문 의도가 충분히
  답변되지 않았다면, 그 의도를 다른 각도에서 다시 물을 수 있는 질문을 1개
  이상 포함합니다.
- **조사목적과 연결** — 모든 제안이 조사목적의 어느 면을 진전시키는지
  why 한 줄에 가능한 한 명시 ("가설 H2 의 가격 진입장벽 검증" 같은 식).

가이드가 제공되지 않으면 transcript 만 보고 판단합니다.

출력은 정의된 JSON 스키마만. 그 외 텍스트 금지.`;

/* ──────────────────────────────────────────────────────────────────────
   Stage 1 — focus 라벨링.

   transcript 최근 30초 + 가이드의 가설/의도 ID·라벨 목록을 받고, "지금
   응답자가 어느 가설/의도를 건드리고 있나" 를 짧게 라벨링합니다. Stage 2
   가 이 결과만 prompt 에 박아 sonnet 호출 비용을 줄이고 모델의 관심을
   하나에 집중시킵니다.

   응답 토큰 < 300 — haiku 1-2 초.
   ──────────────────────────────────────────────────────────────────── */

export const probingFocusSchema = z.object({
  relevant_hypothesis_ids: z
    .array(z.string())
    .max(5)
    .describe('현재 응답자의 발화와 가장 관련 있는 가설 id (최대 3개 권장).'),
  relevant_intent_ids: z
    .array(z.string())
    .max(5)
    .describe('현재 응답자의 발화와 가장 관련 있는 질문 의도 id (최대 3개 권장).'),
  focus_summary: z
    .string()
    .max(160)
    .describe(
      '한 줄 요약. "지금 응답자가 ~에 대해 말하는 중" 형태. 인터뷰어가 위젯에서 그대로 읽을 수 있어야 함.',
    ),
});

export type ProbingFocus = z.infer<typeof probingFocusSchema>;

export const PROBING_FOCUS_SYSTEM = `당신은 인터뷰 진행 보조 시스템의 라벨링 단계입니다. 라이브 인터뷰의 최근 30초 transcript 와 사전에 등록된 조사 가설/의도 목록을 보고, **지금 응답자가 어느 가설/의도를 건드리고 있는지** 짧게 라벨링합니다.

원칙:
- 가설 id 와 의도 id 는 입력으로 받은 목록 안에 있는 것만 사용. 없는 id 를 만들지 마세요.
- 관련성이 약하면 빈 배열 반환. 무리하게 라벨링하지 마세요.
- 보통 0~3개. 4개 이상이 명확히 관련 있으면 그대로 표시.
- focus_summary 는 한 줄 (한국어 50자 이내 권장). 인터뷰어가 위젯에서 그대로 읽습니다. "지금 응답자가 ~에 대해 말하고 있어요" 같은 자연어.
- transcript 가 빈약하면 빈 배열 + focus_summary 에 "발화 부족" 류 한 줄.

출력은 정의된 JSON 스키마만. 그 외 텍스트 금지.`;

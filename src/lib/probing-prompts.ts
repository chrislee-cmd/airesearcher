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

   PR-14: 호출 단위를 5초 × 1 질문 → 30초 × 3 질문 으로 전환. 시스템
   프롬프트를 "기법 분배" 중심에서 "why 깊이 / 맥락 hook / sharpness"
   중심으로 재작성. 약한 일반 follow-up ("조금 더 말씀해 주세요" 류)
   을 명시적으로 차단하고, 각 질문에 \`why_sharp\` 메타 (어떤 발화 신호
   를 hook 하는지) 를 부여해 인터뷰어가 sharpness 를 즉시 검증 가능.

   schema 는 streamObject 의 출력 형식. 클라이언트가 partial JSON 으로
   parsing 하면서 카드 stream 표시. questions 의 핵심 (text + technique
   + why_sharp) 이 먼저 emit 되고 intents 가 사후 emit 되도록 schema key
   순서 고정 — 인터뷰어가 핵심 질문을 빠르게 받고 의도는 부가로 따라오는
   UX.
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

// PR-13/14: 한 호출당 질문 갯수 동적화. PR-14 부터 위젯은 30초 주기로 3 질문씩
// 받도록 max_questions=3 을 보낸다. 기존 1q / 풀-기법 5q 호출도 그대로 지원 —
// count 가 PROBING_TECHNIQUES 길이 초과면 안전하게 clamp.
//
// 같은 schema key 순서 (questions 먼저, intents 나중) 는 partial JSON parse
// 의 UX (질문 본문이 먼저 채워지고 의도가 사후) 라 그대로 유지.
//
// why_sharp (PR-14) — 각 질문이 응답자의 어느 발화 신호 (구체 단어 / 표현 /
// 망설임 / 모순) 를 hook 하는지 한 줄 메타. optional — 모델이 transcript 가
// 너무 짧아 hook 신호를 명시할 수 없는 경우 생략 가능. 인터뷰어가 sharpness
// 를 즉시 검증할 수 있도록 client 가 DB row.why 에 그대로 저장.
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
          why_sharp: z
            .string()
            .optional()
            .describe(
              '이 질문이 응답자의 어느 발화 신호 (구체 단어 / 표현 / 망설임 / 모순) 를 hook 하는지 한 줄 설명. 인터뷰어가 sharpness 를 즉시 검증 가능해야 함. transcript 가 너무 짧아 hook 신호를 명시할 수 없으면 생략.',
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
          : `probing 질문 ${n}개 — transcript / 가이드 에 가장 정합되는 sharp probing 질문.`,
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

/* ────────────────────────────────────────────────────────────────────
   Reflection agent (좌패널) — PR: probing-two-pane-reflection.

   기존 30s/3q 단일 에이전트를 좌(성찰) + 우(질문) 두 에이전트로 분리.
   좌패널은 transcript 누적을 읽어 응답자에 대한 **판단·성찰** 텍스트를
   세 섹션으로 출력한다:
     1. 응답자 (지금까지의 단서)
     2. 니즈 / 페인포인트
     3. 응답 동기 / 사고 흐름

   우패널은 이 성찰을 컨텍스트로 받아 검증 / probing 질문을 제안한다
   (기존 buildProbingSuggestionSchema 재사용).
   ──────────────────────────────────────────────────────────────────── */

export const probingReflectionSchema = z.object({
  respondent: z
    .string()
    .min(1)
    .describe(
      '응답자 (지금까지의 단서) — 발화에서 드러난 인구통계 / 직무 / 맥락 단서를 1~3개 bullet 으로. 추측은 (추정) 으로 표시. 단서가 부족하면 "단서 부족" 으로 1줄.',
    ),
  needs_painpoints: z
    .string()
    .min(1)
    .describe(
      '응답자가 발화 안에서 드러낸 니즈 / 페인포인트 / 미충족 욕구를 1~3개 bullet. "비싸다 / 안 된다 / 답답하다" 류의 직접 신호와 망설임 / 반복 어휘 / 모순 같은 간접 신호 모두 포함. 단서가 부족하면 "단서 부족".',
    ),
  motivation: z
    .string()
    .min(1)
    .describe(
      '응답자가 왜 저런 응답 / 생각을 하는지 — 행동의 숨겨진 동기, 비교 기준점, 의사결정 권한, 무의식적 가정에 대한 가설을 1~3개 bullet. 각 가설은 transcript 의 어느 발화에서 끌어왔는지 짧게 인용. 단서가 부족하면 "단서 부족".',
    ),
});

export type ProbingReflection = z.infer<typeof probingReflectionSchema>;

// 좌패널 — Reflection Agent system prompt. why_sharp / sharpness 룰은 우패널의
// 질문 agent 가 처리하므로 여기선 "응답자 이해" 한 가지에 집중. 전체 transcript
// (또는 누적 window) 를 읽고 세 섹션 markdown bullet 으로만 출력.
export const PROBING_REFLECTION_SYSTEM = `당신은 질적 인터뷰의 응답자 분석가입니다. 라이브 인터뷰의 누적 transcript 를 읽고 **지금 응답자가 어떤 사람이고, 무엇을 원하고, 왜 저렇게 응답·사고하는지** 를 인터뷰어가 한눈에 보도록 정리합니다.

## 절대 원칙
- **응답자 발화에만 기반** — transcript 에 없는 사실을 단정하지 마세요. 추측은 항상 "(추정)" 으로 표시.
- **응답자 1인칭 관점** — 일반 사용자 / 시장 일반론이 아니라 **이 응답자** 가 보이는 신호만.
- **신호 인용** — 가설 옆에 transcript 의 어느 발화 / 어휘 / 망설임 신호에서 끌어왔는지 짧게 인용 ("'어쨌든' 두 번 반복" / "'비싸다' 직후 침묵 1초").
- **transcript 가 빈약하면 "단서 부족"** 으로 솔직히 표기 — 빈 bullet 채우려고 일반 follow-up 가설을 만들지 마세요.
- **닫힌 결론 금지** — 인터뷰어가 다음 질문으로 검증할 수 있는 **가설** 로 표현. "이 응답자는 X 다" 가 아니라 "X 일 가능성".

## 출력 형식
정확히 세 필드만 채웁니다 (JSON 스키마 그대로):
1. **respondent** — 응답자 (지금까지의 단서). 1~3 bullet.
2. **needs_painpoints** — 니즈 / 페인포인트 / 미충족 욕구. 1~3 bullet.
3. **motivation** — 응답 / 사고 동기 — 숨겨진 가정, 비교 기준점, 의사결정 권한 등. 1~3 bullet.

각 필드는 markdown bullet (- ) 으로 시작하는 텍스트. bullet 끝에 신호 인용을 짧게 덧붙이세요.

## 가이드 활용
사용자가 제공한 **interview_guide** 가 있으면 — 가이드의 조사 의도 / 가설 / RQ 가 이해의 방향을 잡습니다. 가이드에 명시된 가설이 transcript 에서 확인 / 반증되는지 흐름을 우선 잡으세요. 가이드가 비어 있으면 transcript 만 보고 추론합니다.

## 언어
**transcript 의 주 언어** (한국어 / 영어 / 일본어 등) 그대로 응답하세요.

출력은 정의된 JSON 스키마만. 그 외 텍스트 금지.${ISOLATION_NOTICE}`;

// PR-14: PROBING_SYSTEM 재작성 — 5초 × 1q 의 "10 기법 균등 분배" 가 표면적
// follow-up 으로 흐른다는 사용자 평가에 대응. 30초 × 3q 로 호흡을 늘리고
// **why 깊이 / 맥락 hook / sharpness** 를 최우선 룰로 박는다. 기법은 angle
// 풀로만 사용 (선택 가능, 강제 분배 X).
//
// 한국어 디폴트 — transcript 의 주 언어를 모델이 감지해서 응답 언어를 그대로
// 따라가도록 명시. 영어/일본어 인터뷰여도 카드가 자연스럽게 표시됨.
export const PROBING_SYSTEM = `당신은 숙련된 질적 인터뷰 코치입니다. 인터뷰어가 라이브 인터뷰를 진행하는 동안, **응답자의 최근 30초 발화** 를 듣고 **바로 다음에 던질 날카로운 follow-up 질문 (sharp probing question)** 을 제안합니다.

## 절대 원칙 (모든 질문에 동시에 적용)
- **why 의 깊이 추구** — 표면적 "왜?" 가 아니라, 응답자가 방금 말한 행동 / 감정 / 판단의 **숨겨진 동기 / 무의식적 가정 / 모순 / 비교 기준점** 을 끌어내는 질문이어야 합니다.
- **맥락 관련성 최우선** — 직전 30초 발화의 **구체 단어 / 표현 / 망설임 / 반복된 어휘** 에 직접 hook 되어야 합니다. 발화와 분리된 일반 follow-up ("조금 더 말씀해 주세요" / "그게 어떤 의미일까요?" 류) 은 금지.
- **날카로움 (sharpness)** — 응답자가 "음… 그건 생각 안 해봤어요" 또는 "사실은…" 같은 **깊은 회상 / 인지 균열** 을 트리거할 수준이어야 합니다. 안전한 일반 질문은 약하다고 간주.
- **응답자의 직전 발화** 를 받아서 더 깊이 파고듭니다. 새 주제로 점프 X.
- **닫힌 질문 (yes/no) 금지**. 항상 open-ended.
- **유도 질문 (leading) 금지** — "그래서 불편하셨겠네요?" 같은 결론 강요 X.
- **두 가지 묻기 (double-barreled) 금지** — 한 질문에 한 의도만.
- **추측 / 감정 단정 금지** — 응답자가 말하지 않은 감정 / 판단을 단정해서 묻지 마세요.
- **1인칭 응답자 관점** — "고객이 보통…" 이 아니라 "본인은 그때…".

## 약한 질문 vs 날카로운 질문 (예시 — 패턴 학습용)

약함 (X): "왜 그렇게 하셨어요?"
강함 (O): "방금 'A 가 더 자연스럽다' 고 하셨는데, 그 '자연스러움' 의 기준이 과거의 어떤 경험에서 만들어진 건지 떠올려 보면요?"

약함 (X): "조금 더 말씀해 주세요."
강함 (O): "방금 '어쨌든 그냥' 이라는 표현을 두 번 쓰셨는데, 그 망설임 뒤에 있는 갈등이 뭐예요?"

약함 (X): "그게 중요한가요?"
강함 (O): "지금 'X 가 있어야 한다' 고 단정하셨는데, X 가 없을 때 실제로 어떤 일이 벌어지는지 가장 최근에 떠오르는 한 장면이 있어요?"

약함 (X): "어떻게 느꼈어요?"
강함 (O): "방금 '괜찮긴 한데' 라고 하셨는데, '괜찮다' 와 '괜찮긴 한데' 의 차이가 본인 안에서는 뭐예요?"

## 기법 풀 (angle 후보 — 강제 분배 X)
아래 5개 기법은 sharp 한 angle 을 만드는 카탈로그입니다. 각 질문이 어느 angle 에 가까운지 \`technique\` 에 표기하되, **기법 채우기보다 위의 why / hook / sharpness 룰이 항상 우선**합니다.

1. **contrast** — 비교로 차이 끌어내기. "이전에는 어땠어요?" / "다른 도구와 비교하면?"
2. **devils_advocate** — 반대 시각 / 반박 가설 제시. "다른 시각에서는 X 일 수도 있는데, 그 경우엔요?"
3. **balance_game** — trade-off 사이 양자택일 강제. "A 와 B 중 하나만 골라야 한다면 어느 쪽이고, 그 이유는요?"
4. **clarification** — 모호한 지시어 / 단어 / 표현 / 망설임 명확화. "방금 '그것' / '어쨌든' 이 정확히 무엇을 가리켰어요?"
5. **timeline** — 시점 / 순서 / 변화. "처음 그렇게 느낀 게 언제부터인가요? 그 사이에 뭐가 달라졌어요?"

기법 분배 규칙:
- 같은 호출 안에서 같은 기법 반복은 가능하나 **angle 이 겹치지 않게** 다른 hook 신호를 잡으세요.
- 가능하면 서로 다른 기법으로 3 질문이 다른 각도를 짚도록 — 단 약한 질문을 만들면서까지 기법 다양화를 강요하지 마세요.

## 각 질문에 붙는 메타
- \`text\` — 응답자에게 그대로 던질 수 있는 한 문장.
- \`technique\` — 위 5개 enum 중 하나 (가장 가까운 angle).
- \`why_sharp\` — **이 질문이 응답자의 어느 발화 신호 (구체 단어 / 표현 / 망설임 / 모순) 를 hook 하는지** 한 줄. 인터뷰어가 sharpness 를 즉시 검증 가능해야 합니다. 예: "응답자가 '어쨌든' 을 두 번 반복한 망설임 신호" / "'자연스럽다' 라는 평가어가 기준점을 가린 신호".
- \`guide_reference\` — 가이드가 제공된 경우만, 가이드의 어느 부분과 정합되는지 1~2 문장 (가이드 없으면 생략).

## 출력 순서 (중요)
- 먼저 \`questions\` 배열에 각 질문의 핵심 (text → technique → why_sharp → guide_reference) 을 모두 emit.
- 그 다음 \`intents\` 배열에 각 질문의 의도를 같은 인덱스 순서로 emit (1~2문장).
- 클라이언트가 partial JSON 으로 받아 핵심 질문을 먼저 보여주고 의도를 사후 노출하는 UX 라, 이 순서를 반드시 지켜야 합니다.

## 가이드 활용 (가장 중요)
사용자가 제공한 **interview_guide** 가 비어있지 않으면 — 그 가이드가 모든 제안의 1순위 기준입니다 (transcript 보다 우선):
- **모든 제안 질문은 가이드의 핵심 컨셉 / 가설 / 의도 / RQ 의 검증 또는 심화 흐름에 정합되어야 합니다.** transcript 의 직전 발화는 가이드의 의도를 확인할 진입점일 뿐, 그 자체로 질문 방향을 결정하지 않습니다.
- 가이드에 "사용자가 X 를 어떻게 인식하는지" 같은 의도가 명시되어 있으면, 응답자의 발화를 그 의도에 대한 답변 신호로 해석하고 신호를 더 풀어내는 후속 질문을 디자인하세요.
- 가이드의 키워드 / 가설을 질문 본문에 자연스럽게 인용 가능 (응답자가 이해할 수 있는 한).
- 가이드와 응답자 발화가 모순될 때 — 모순을 가시화하는 질문을 우선 (주로 contrast 기법).
- 각 질문의 \`guide_reference\` 필드에 그 질문이 가이드의 어느 부분과 정합되는지 1~2 문장으로 명시하세요 (예: "가이드의 'X 인식' 의도 검증", "가이드 H2 가설의 반례 확인").

가이드가 비어 있으면 transcript 만 보고 sharp probing 질문을 생성합니다 (\`guide_reference\` 는 생략).

## 언어
**transcript 의 주 언어** (한국어 / 영어 / 일본어 등) 를 그대로 따라 응답하세요. 한국어 인터뷰는 한국어로, 영어 인터뷰는 영어로.

## transcript 가 빈약할 때
직전 30초가 너무 짧거나 의미 파악이 어려우면, **약한 일반 follow-up 으로 채우는 것보다 hook 신호를 가진 한두 질문을 우선** 잡고, 나머지는 가장 가까운 발화 단서에서 출발한 sharp 각도로 만드세요. 약한 일반 질문 ("조금 더 자세히…" / "예를 들어 주세요" / "왜 그럴까요?") 은 절대 출력하지 마세요.

출력은 정의된 JSON 스키마만. 그 외 텍스트 금지.${ISOLATION_NOTICE}`;

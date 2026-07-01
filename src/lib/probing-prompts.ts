import { z } from 'zod';
import { ISOLATION_NOTICE } from '@/lib/llm/sanitize';

/* ────────────────────────────────────────────────────────────────────
   출력 언어 (outputLang) — 분석 결과를 사용자가 고른 언어로 강제.

   PR (probing-output-lang-select): 프로빙 어시스턴트의 분석 출력 언어를
   입력 (STT transcript) 언어와 독립적으로 선택 가능하게. 예: 한국어
   인터뷰 → 영어 분석 (해외 PM 공유). translate 의 LANGS 6종과 동일.

   `buildProbing*System(outputLang)` 3 함수가 각 system prompt 의 "## 언어"
   섹션을 이 값으로 치환한다. outputLang 미전달 (undefined) 시 옛 동작 —
   transcript 의 주 언어 자동 추론 — 그대로 보존 (backward compat).
   ──────────────────────────────────────────────────────────────────── */

export const PROBING_OUTPUT_LANGS = [
  'ko',
  'en',
  'ja',
  'zh',
  'es',
  'th',
] as const;

export type ProbingOutputLang = (typeof PROBING_OUTPUT_LANGS)[number];

const PROBING_LANG_LABEL: Record<ProbingOutputLang, string> = {
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  zh: '中文',
  es: 'Español',
  th: 'ไทย',
};

// outputLang 코드 → 프롬프트에 박을 사람 친화 라벨. enum 밖 값 / undefined 는
// null → 호출부가 자동 추론 fallback 으로 분기.
function outputLangLabel(outputLang?: string): string | null {
  if (!outputLang) return null;
  return PROBING_LANG_LABEL[outputLang as ProbingOutputLang] ?? null;
}

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
   Persona agent (좌패널) — PR: probing-persona-panels.

   초기 PR (probing-two-pane-reflection) 의 3 섹션 (respondent /
   needs_painpoints / motivation) 단순 markdown bullet 모델을 **페르소나
   한판 8 패널** 구조로 재편한다. 인터뷰가 끝났을 때 응답자의 완성된
   페르소나가 한눈에 정리되는 것이 목표.

   8 섹션:
     1. demographics         — 인구통계 (성별/연령/지역/직무/가족구성 추정)
     2. values               — 가치관 / 추구 방향
     3. preferences          — 선호 (브랜드/스타일/미디어 등)
     4. needs                — Jobs-to-be-done
     5. painpoints           — 좌절 / 미충족 / 비용 / 인지 부담
     6. brand_perception     — 브랜드 / 카테고리 인식
     7. decision_drivers     — 행동을 가르는 요인
     8. behavioral_patterns  — 일상 / 소비 / 미디어 습관

   각 섹션 = summary(1~2문장) + signals(<=5, bullet + 선택적 quote) +
   confidence (high/medium/low/insufficient). insufficient 면 패널이
   placeholder 톤으로 표시 — UI 가 의도된 빈 칸임을 시각화.
   ──────────────────────────────────────────────────────────────────── */

export const PROBING_PERSONA_SECTION_KEYS = [
  'demographics',
  'values',
  'preferences',
  'needs',
  'painpoints',
  'brand_perception',
  'decision_drivers',
  'behavioral_patterns',
] as const;

export type ProbingPersonaSectionKey =
  (typeof PROBING_PERSONA_SECTION_KEYS)[number];

const personaSectionSchema = z.object({
  summary: z
    .string()
    .describe(
      '1~2문장 요약 — 이 섹션의 핵심 가설. confidence=insufficient 면 빈 문자열 가능.',
    ),
  signals: z
    .array(
      z.object({
        bullet: z
          .string()
          .describe(
            '관찰 신호 한 줄. 어떤 발화 / 어휘 / 망설임에서 끌어왔는지 짧게 적기.',
          ),
        quote: z
          .string()
          .optional()
          .describe('직접 인용한 transcript 구절 (있을 때만).'),
      }),
    )
    .max(5)
    .describe(
      '관찰 신호 0~5개. confidence=insufficient 면 빈 배열. 외엔 가능한 한 transcript 인용 포함.',
    ),
  confidence: z
    .enum(['high', 'medium', 'low', 'insufficient'])
    .describe(
      "신호 강도. high=다출처 일치 / medium=단일 발화 / low=추정 위주 / insufficient=transcript 신호 0.",
    ),
});

export const probingPersonaSchema = z.object({
  demographics: personaSectionSchema.describe(
    '인구통계 — 발화에서 드러나는 성별 / 연령대 / 지역 / 직업 / 가족구성 / 거주환경 단서.',
  ),
  values: personaSectionSchema.describe(
    '가치관 / 추구 방향 — 안정 vs 도전, 가성비 vs 경험, 개인 vs 가족 등 무엇을 중요시하는가.',
  ),
  preferences: personaSectionSchema.describe(
    '선호 — 좋아하는 브랜드 / 미디어 / 스타일 / 음식 / 음악 / 활동.',
  ),
  needs: personaSectionSchema.describe(
    '니즈 / Jobs-to-be-done — 인터뷰 주제 안에서 응답자가 충족하고자 하는 욕구.',
  ),
  painpoints: personaSectionSchema.describe(
    '페인포인트 — 미충족 / 좌절 / 답답함 / 비용 / 시간 / 인지 부담.',
  ),
  brand_perception: personaSectionSchema.describe(
    '브랜드 인식 — 특정 브랜드 / 카테고리 / 경쟁사 인식 구조 (첫 떠올림, 평가어, 비교 기준).',
  ),
  decision_drivers: personaSectionSchema.describe(
    '의사결정 요인 — 행동을 가르는 가격 / 시간 / 신뢰 / 추천 / 친환경 등 결정 요인.',
  ),
  behavioral_patterns: personaSectionSchema.describe(
    '행동 패턴 — 일상 / 소비 / 미디어 습관 / 의사결정 빈도.',
  ),
});

export type ProbingPersona = z.infer<typeof probingPersonaSchema>;
export type ProbingPersonaSection = z.infer<typeof personaSectionSchema>;

export function buildProbingPersonaSystem(outputLang?: string): string {
  const label = outputLangLabel(outputLang);
  const langSection = label
    ? `**반드시 ${label} 로 응답하세요.** transcript 의 언어와 무관하게 summary / signals 의 모든 문장을 ${label} 로 작성합니다. ("(추정)" 같은 메타 표기도 ${label} 의 자연스러운 표현으로.)`
    : `**transcript 의 주 언어** (한국어 / 영어 / 일본어 등) 그대로 응답하세요. summary / signals 가 자연스러운 문장이 되도록.`;
  return `당신은 질적 인터뷰의 응답자 페르소나 분석가입니다. 라이브 인터뷰의 누적 transcript 를 읽고 **이 응답자의 완성된 페르소나 한 판** 을 8 섹션 (demographics / values / preferences / needs / painpoints / brand_perception / decision_drivers / behavioral_patterns) 으로 구조화합니다.

## 절대 원칙
- **응답자 발화에만 기반** — transcript 에 없는 사실을 단정하지 마세요. 추측은 항상 confidence='low' 로 표기하고 summary 안에 "(추정)" 을 명시.
- **응답자 1인칭 관점** — 일반 사용자 / 시장 일반론이 아니라 **이 응답자** 가 보이는 신호만.
- **닫힌 결론 금지** — 인터뷰어가 다음 질문으로 검증할 수 있는 **가설** 로 표현 ("X 일 가능성", "X 를 중시할 수도").
- **빈약 섹션 = insufficient** — transcript 에 그 섹션의 신호가 없으면 confidence='insufficient' + summary 비움 + signals 빈 배열. 빈 칸을 일반론으로 채우지 마세요.
- **모든 8 섹션을 반드시 출력** — insufficient 라도 객체는 채워야 합니다 (스키마 강제).

## 섹션별 신호 가이드
1. **demographics** — 성별 / 연령대 / 지역 / 직업 / 가족구성 / 거주환경. 발화 어휘 (방언, 세대 표현, 직무 용어) 와 직접 언급에서.
2. **values** — 안정 vs 도전 / 가성비 vs 경험 / 개인 vs 가족 / 효율 vs 의미 등 추구 방향.
3. **preferences** — 브랜드 / 미디어 / 스타일 / 음식 / 활동 등 좋아한다고 명시 또는 선택 흔적.
4. **needs** — Jobs-to-be-done. 인터뷰 주제 안에서 응답자가 충족하려는 것.
5. **painpoints** — 좌절 / 미충족 / 비용 / 인지 부담. "비싸다 / 안 된다 / 답답하다" 직접 신호 + 망설임 / 반복 어휘 / 모순 간접 신호.
6. **brand_perception** — 특정 브랜드 / 카테고리 / 경쟁사를 어떻게 인식하는지 (첫 떠올림, 평가어, 비교 기준).
7. **decision_drivers** — 무엇이 결정을 가르는가 — 가격 / 시간 / 신뢰 / 추천 / 친환경 / 사회적 시선 등.
8. **behavioral_patterns** — 일상 / 소비 / 미디어 습관 / 의사결정 빈도.

## 각 섹션의 출력 모양
- \`summary\` — 1~2문장. 이 섹션의 핵심 가설. confidence=insufficient 면 빈 문자열.
- \`signals\` — 0~5개의 관찰. 각 신호:
  - \`bullet\` — 한 줄로 "어떤 발화 / 어휘 / 망설임에서 어떤 가설이 나오는지". (필수)
  - \`quote\` — transcript 의 짧은 직접 인용. 있을 때만 포함 (선택).
- \`confidence\` — 다음 룰:
  - **high** — 다출처 신호 일치 (직접 발화 + 간접 신호 모두 같은 방향)
  - **medium** — 단일 발화 또는 약한 신호
  - **low** — 추정 위주, 인용 신호 약함 (summary 안에 (추정) 명시)
  - **insufficient** — transcript 에 그 섹션의 신호 0. summary 빈 문자열, signals 빈 배열.

## 가이드 활용
사용자가 제공한 **interview_guide** 가 있으면 — 가이드의 조사 의도 / 가설 / RQ 가 페르소나 해석의 방향을 잡습니다. 가이드의 가설이 transcript 에서 확인 / 반증되는지를 우선 보세요. 가이드가 비어 있으면 transcript 만 보고 추론합니다.

## 언어
${langSection}

출력은 정의된 JSON 스키마만. 그 외 텍스트 금지.${ISOLATION_NOTICE}`;
}

// 기존 호출자 호환 — outputLang 미지정 = 자동 추론 (옛 동작).
export const PROBING_PERSONA_SYSTEM = buildProbingPersonaSystem();

/* ────────────────────────────────────────────────────────────────────
   Legacy reflection agent (3 섹션) — 호환용으로만 유지.

   초기 PR 의 위젯 코드는 모두 페르소나 8 패널로 전환됐다. 외부에서
   importing 하는 곳이 없으면 다음 PR 에서 제거 예정. 새 코드는
   probingPersonaSchema / PROBING_PERSONA_SYSTEM 을 사용.
   ──────────────────────────────────────────────────────────────────── */

export const probingReflectionSchema = z.object({
  respondent: z.string().min(1),
  needs_painpoints: z.string().min(1),
  motivation: z.string().min(1),
});

export type ProbingReflection = z.infer<typeof probingReflectionSchema>;

export const PROBING_REFLECTION_SYSTEM = PROBING_PERSONA_SYSTEM;

// PR-14: PROBING_SYSTEM 재작성 — 5초 × 1q 의 "10 기법 균등 분배" 가 표면적
// follow-up 으로 흐른다는 사용자 평가에 대응. 30초 × 3q 로 호흡을 늘리고
// **why 깊이 / 맥락 hook / sharpness** 를 최우선 룰로 박는다. 기법은 angle
// 풀로만 사용 (선택 가능, 강제 분배 X).
//
// 한국어 디폴트 — transcript 의 주 언어를 모델이 감지해서 응답 언어를 그대로
// 따라가도록 명시. 영어/일본어 인터뷰여도 카드가 자연스럽게 표시됨.
export function buildProbingSystem(outputLang?: string): string {
  const label = outputLangLabel(outputLang);
  const langSection = label
    ? `**반드시 ${label} 로 응답하세요.** transcript 의 언어와 무관하게 질문 본문 (text) / why_sharp / guide_reference / intents 를 모두 ${label} 로 작성합니다.`
    : `**transcript 의 주 언어** (한국어 / 영어 / 일본어 등) 를 그대로 따라 응답하세요. 한국어 인터뷰는 한국어로, 영어 인터뷰는 영어로.`;
  return `당신은 숙련된 질적 인터뷰 코치입니다. 인터뷰어가 라이브 인터뷰를 진행하는 동안, **응답자의 최근 30초 발화** 를 듣고 **바로 다음에 던질 날카로운 follow-up 질문 (sharp probing question)** 을 제안합니다.

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
${langSection}

## transcript 가 빈약할 때
직전 30초가 너무 짧거나 의미 파악이 어려우면, **약한 일반 follow-up 으로 채우는 것보다 hook 신호를 가진 한두 질문을 우선** 잡고, 나머지는 가장 가까운 발화 단서에서 출발한 sharp 각도로 만드세요. 약한 일반 질문 ("조금 더 자세히…" / "예를 들어 주세요" / "왜 그럴까요?") 은 절대 출력하지 마세요.

출력은 정의된 JSON 스키마만. 그 외 텍스트 금지.${ISOLATION_NOTICE}`;
}

// 기존 호출자 호환 — outputLang 미지정 = 자동 추론 (옛 동작).
export const PROBING_SYSTEM = buildProbingSystem();

/* ────────────────────────────────────────────────────────────────────
   Think agent — PR (probing-question-thinking-flow).

   우패널을 4-layer (입력 / AI 사고 흐름 / 질문 popup / history) 로
   재편하면서 도입하는 새 agent. 기존 `suggest` (transcript-window
   driven, 3 질문 batch) 와 별도 endpoint 로 분리. 이쪽은:

   1. 사용자가 입력한 **research_context** (조사 목적 / 핵심 가설 /
      Key Research Question) 를 1순위 컨텍스트로.
   2. 누적 transcript 를 보며 **실시간으로 사고** (THINK 라인 스트림).
   3. 사고 흐름 중 가설 검증 / KRQ 정합 / 응답자의 인지 균열이 감지
      되면 **emit** 으로 즉시 던질 질문을 popup 으로 push.

   출력 형식 = NDJSON-like 라인 스트림. 각 라인:
     - `THINK: <한국어 사고 한 문장>`
     - `EMIT: <json one-line>` — popup question payload

   클라이언트는 서버의 text stream 을 raw 로 받아 줄 단위 buffer +
   `THINK:` / `EMIT:` prefix 로 dispatch. JSON object schema 보다
   라인-단위 prefix 가 partial streaming UX 에 자연 (`streamObject` 는
   JSON 트리가 다 닫혀야 의미 있게 partial parse 됨 — 사고 흐름의 한
   줄 한 줄을 즉시 보여주려면 line-stream 이 필요).
   ──────────────────────────────────────────────────────────────────── */

export const PROBING_THINK_IMPORTANCE = ['high', 'medium', 'low'] as const;
export type ProbingThinkImportance = (typeof PROBING_THINK_IMPORTANCE)[number];

// popup 카드에 표시할 한 질문 payload. EMIT 라인의 JSON 모양과 1:1.
// client 는 이 schema 로 EMIT 라인을 검증해서 유효한 popup 만 push.
export const probingThinkEmitSchema = z.object({
  text: z
    .string()
    .min(1)
    .max(500)
    .describe('인터뷰어가 그대로 던질 한 문장 질문 (한국어 권장).'),
  technique: z
    .enum(PROBING_TECHNIQUES)
    .describe('probing 기법 분류. PROBING_TECHNIQUES 중 하나.'),
  rationale: z
    .string()
    .min(1)
    .max(500)
    .describe(
      '왜 지금 이 질문이 필수인가 — 1~2 문장. 사용자 입력 (조사 목적 / 가설 / KRQ) 중 어느 부분과 연결되는지 명시.',
    ),
  importance: z
    .enum(PROBING_THINK_IMPORTANCE)
    .describe(
      "high=가설 검증의 결정적 신호 + 응답자가 곧 화제 바꿀 위험; medium=KRQ 와 직접 정합 + 깊이 있는 follow-up; low=보조적, 시간 여유 있을 때 좋음.",
    ),
});

export type ProbingThinkEmit = z.infer<typeof probingThinkEmitSchema>;

// PROBING_THINK_SYSTEM — AI 가 NDJSON-like 라인 스트림으로 응답.
// "사고 + 비주기적 emit" 을 한 호출 안에서 동시 처리. emit 은 0~5개,
// 강한 신호 1개로도 충분.
export function buildProbingThinkSystem(outputLang?: string): string {
  const label = outputLangLabel(outputLang);
  const langSection = label
    ? `**반드시 ${label} 로 응답하세요.** transcript 의 언어와 무관하게 THINK / EMIT 의 본문 (사고 문장 / text / rationale) 을 모두 ${label} 로 작성합니다. (\`THINK:\` / \`EMIT:\` prefix 자체는 그대로 유지.)`
    : `**transcript 의 주 언어** (한국어 / 영어 / 일본어) 를 그대로 따라 응답하세요. THINK / EMIT 의 본문 (text / rationale) 도 transcript 와 같은 언어.`;
  return `당신은 깊이 있는 질적 인터뷰 코치입니다. 사용자가 제공한 **조사 컨텍스트** (조사 목적 / 핵심 가설 / Key Research Question) 와 **누적 transcript** 를 보며 인터뷰어 옆에서 실시간으로 사고합니다.

## 출력 형식 (절대 위반 금지)
각 줄을 정확히 다음 두 형식 중 하나로 출력하세요. 다른 prefix / 빈 줄 / 코드 펜스 금지.

- \`THINK: <한국어 사고 한 문장>\`
  - 자유 흐름의 사고. 응답자의 발화에서 무엇이 관찰되는지, 어느 가설과 연결되는지, 응답자가 곧 다른 주제로 넘어갈 위험은 없는지 등을 한 문장으로.
  - 한 호출에 보통 10~30 줄.

- \`EMIT: <json one-line>\`
  - 사용자에게 **지금 즉시** popup 으로 보여줄 필수 질문. 다음 JSON 스키마를 정확히 따르고 한 줄에 모두 적어야 합니다 (개행 금지):
    \`\`\`
    {"text": "...", "technique": "...", "rationale": "...", "importance": "..."}
    \`\`\`
  - text: 인터뷰어가 그대로 던질 한 문장 질문.
  - technique: contrast / devils_advocate / balance_game / clarification / timeline 중 하나.
  - rationale: 왜 지금 이 질문이 필수인가. 사용자 입력 (조사 목적 / 가설 / KRQ) 중 어느 부분과 연결되는지 명시 (1~2 문장).
  - importance: high (가설 검증의 결정적 신호 + 응답자가 곧 화제 바꿀 위험) / medium (KRQ 와 직접 정합 + 깊이 있는 follow-up) / low (보조적, 시간 여유 있을 때).
  - 한 호출에 0~5개. 신호가 강하면 1개로도 충분. 약한 일반 follow-up ("조금 더 말씀해 주세요" 류) 는 절대 emit 금지.

## emit 판단 룰
- **검증 가능성** — 가설 / KRQ 와 응답자의 발화가 연결됐을 때, 더 깊은 검증 / 반증을 끌어낼 sharp 질문이 떠오르면 즉시 emit.
- **인지 균열** — 응답자가 "음… 그건 생각 안 해봤어요" / "사실은…" 류의 망설임 / 모순을 드러냈고 그걸 파고들 sharp 질문이 보이면 즉시 emit.
- **화제 이탈 위험** — 응답자가 곧 다른 주제로 넘어갈 것 같은데 현재 화제에서 중요한 미답 신호가 있으면 즉시 emit.
- **단순 반복 / 일반론 금지** — transcript 의 직전 발화에 hook 되지 않은 일반 follow-up 은 emit X. THINK 로만 흐름.

## 사고 흐름 가이드 (THINK 라인)
- "응답자가 'X' 를 두 번 언급. Y 가설 검증 신호로 해석." 처럼 발화 → 가설 매핑을 짧게.
- "직전 발화의 '어쨌든' 망설임이 더 강한 결정 신호 — 즉시 질문 후보." 처럼 emit 의 트리거 시점을 가시화.
- 사고는 1인칭 코치 톤 ("…로 보임", "…같음"). 단정 X.

## 사용자 입력 (research_context) 활용
- **research_goal** — 이 인터뷰의 최상위 목적. 모든 사고와 emit 의 1순위 기준.
- **hypotheses** — 검증 / 반증 대상. 응답자의 발화가 어느 가설을 지지 / 반박 하는지 항상 점검.
- **key_research_question (KRQ)** — 이 인터뷰가 답해야 할 핵심 질문. 응답자의 답이 KRQ 의 어느 부분을 channel 하는지 본 뒤, 부족한 부분을 emit 으로 메우는 흐름이 이상적.

조사 컨텍스트가 비어 있으면 transcript 만 보고 진행하되, 그 경우에도 emit 은 sharp 질문만 — 일반론 금지.

## 기법 풀 (technique enum)
- contrast — 비교로 차이 끌어내기.
- devils_advocate — 반대 시각 / 반박 가설 제시.
- balance_game — trade-off 사이 양자택일 강제.
- clarification — 모호한 지시어 / 단어 / 표현 / 망설임 명확화.
- timeline — 시점 / 순서 / 변화.

## 언어
${langSection}

## transcript 가 빈약할 때
hook 신호가 약하면 THINK 로만 짧게 흐르고 emit 은 보류. 약한 일반 emit 으로 채우지 마세요.

라인 스트림 외의 텍스트 (헤더 / 코드 펜스 / JSON 트리 등) 는 절대 출력하지 마세요. 매 줄이 반드시 \`THINK: \` 또는 \`EMIT: \` 로 시작해야 합니다.${ISOLATION_NOTICE}`;
}

// 기존 호출자 호환 — outputLang 미지정 = 자동 추론 (옛 동작).
export const PROBING_THINK_SYSTEM = buildProbingThinkSystem();


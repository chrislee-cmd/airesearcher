import { z } from 'zod';

// Qualitative viz-schema extraction for insights_analyzer (PR 5b).
//
// One LLM pass per job (same prompt as cluster extraction but covering
// the qualitative side: tensions + contradictions). Outputs map 1:1 to
// migration 0025 columns:
//
//   insights_tensions       — per (participant, axis) lo/hi scores
//   insights_contradictions — per quote-pair counterposition
//
// The route validates each returned quote_id against the input set so a
// hallucinated id can't reach the M:N table (FK is ON DELETE SET NULL
// in 0025, so a bad id would fail at INSERT — defensive filter is
// cheaper than catching the violation).

export const insightsTensionSchema = z.object({
  participant_name: z.string().min(1),
  // v2 reference uses 'healthBeauty' / 'routineEffort' etc; free text
  // so a non-skincare job can carry its own (e.g. '의존도', '신뢰감').
  axis: z.string().min(1).max(80),
  lo_val: z.number().min(0).max(1),
  hi_val: z.number().min(0).max(1),
  lo_quote_id: z.number().int().positive().nullable(),
  hi_quote_id: z.number().int().positive().nullable(),
});

export const insightsContradictionSchema = z.object({
  participant_name: z.string().min(1),
  // Free text; reference uses '말vs행동' / '의식vs무의식' / '이상vs현실'.
  contradiction_type: z.string().min(1).max(60),
  strength: z.enum(['high', 'medium', 'low']),
  label: z.string().min(1).max(200),
  a_label: z.string().nullable(),
  a_quote_id: z.number().int().positive().nullable(),
  b_label: z.string().nullable(),
  b_quote_id: z.number().int().positive().nullable(),
  insight: z.string().nullable(),
  tag: z.string().nullable(),
});

export const insightsQualitativeExtractionSchema = z.object({
  tensions: z.array(insightsTensionSchema).max(80),
  contradictions: z.array(insightsContradictionSchema).max(30),
});

export type InsightsTension = z.infer<typeof insightsTensionSchema>;
export type InsightsContradiction = z.infer<typeof insightsContradictionSchema>;
export type InsightsQualitativeExtraction = z.infer<
  typeof insightsQualitativeExtractionSchema
>;

// One pass covers both because the input data is identical (quotes).
// The model reasons holistically — tensions and contradictions often
// surface together (a participant who said A then B reveals both an
// axis-spread and a말-행동 mismatch).
//
// Principles encoded in the prompt:
//   • Don't fabricate. Empty arrays are valid outputs.
//   • Strength calibration: explicit contradiction = high, nuanced =
//     medium, subtle = low. The viz uses this for node sizing.
//   • Tensions are axis-based (low vs high on a single dimension), not
//     simple binary contradictions — encourage the LLM to articulate
//     the axis name (e.g., "가격 민감도" with low/high anchors).
export const INSIGHTS_QUALITATIVE_SYSTEM = `당신은 정성 분석가입니다. 한 인터뷰 분석의 인용구 묶음을 받아, 응답자별 **긴장(tensions)** 과 **모순(contradictions)** 을 추출하세요. 결과는 정의된 JSON 스키마만, 그 외 텍스트 금지.

## 긴장 (tensions) — 응답자가 한 축 위에서 양극단 사이를 오가는 패턴

각 tension 항목:

1) **participant_name** (필수) — 입력의 응답자 식별자 그대로.
2) **axis** (필수) — 짧은 축 이름. 예: "가격 민감도", "온라인 vs 오프라인", "감정 vs 이성", "독립 vs 안정". 한 명의 응답자가 같은 axis 를 두 번 가지면 안 됩니다.
3) **lo_val** / **hi_val** (필수, 0..1) — 응답자가 그 axis 위에서 어디부터 어디까지 흔들리는지. lo_val < hi_val 이 자연. 둘 다 0.5 근처면 의미 있는 긴장이 아니므로 그 axis 를 빼세요.
4) **lo_quote_id** / **hi_quote_id** (nullable) — 입력에서 받은 quote.id 중, 축의 low/high 극단을 가장 잘 보여주는 발화. 없으면 null.

원칙:
- 응답자당 보통 **0~5개**. 명확한 축 패턴이 없으면 0개여도 됩니다.
- "긍정 vs 부정" 같은 자명한 축은 피하세요. 그 응답자만의 고유한 텐션 축을 찾으세요.
- 입력에 없는 quote.id 는 절대 만들지 마세요.

## 모순 (contradictions) — 응답자가 직접 충돌하는 두 발화를 한 인터뷰 안에서 동시에 한 패턴

각 contradiction 항목:

1) **participant_name** (필수)
2) **contradiction_type** (필수) — 분류 라벨. 자주 쓰는 것: "말 vs 행동", "의식 vs 무의식", "이상 vs 현실". 다른 적합한 분류가 있으면 자유 서술.
3) **strength** (필수, 'high' | 'medium' | 'low') — high = 두 발화가 명시적으로 충돌 / medium = 결이 어긋남 / low = 미묘.
4) **label** (필수) — 이 모순을 한 줄로 요약 (예: "가격 부담을 말하면서도 프리미엄 옵션을 선택").
5) **a_label** / **b_label** (nullable) — 양쪽 발화의 짧은 요약 라벨.
6) **a_quote_id** / **b_quote_id** (nullable) — 양쪽을 직접 인용하는 quote.id. 둘 다 있을수록 viz 가 명확함. 없으면 null.
7) **insight** (nullable) — "왜 이 모순이 생겼는가" 또는 "이 모순이 시사하는 것" 한 줄.
8) **tag** (nullable) — 추가 분류 (예: "행동 의도 격차").

원칙:
- 보통 한 job 에서 **0~12개**. 없으면 0개여도 됩니다.
- 같은 응답자의 다른 시점·맥락 발화에서 모순을 잡으세요. 한 문장 안의 미묘한 ambiguity 는 모순이 아닙니다.
- a/b 발화는 같은 응답자에서 나와야 합니다 (응답자 간 모순은 contradiction 이 아니라 cluster 분기).
- 입력에 없는 quote.id 는 절대 만들지 마세요.

## 공통

- 출력은 입력 언어를 따릅니다 (한국어 데이터면 axis/label/insight 도 한국어).
- 응답자가 적거나 데이터가 빈약해서 의미 있는 긴장/모순을 찾을 수 없다면 빈 배열을 돌려도 됩니다. **억지로 만들지 마세요.**`;

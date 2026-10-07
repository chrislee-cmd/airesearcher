// LLM 모델별 토큰 단가 — 생성 1회당 비용 실측 미터링의 est_cost 계산 전용.
//
// 왜 상수인가: Anthropic 은 per-request 비용을 응답에 주지 않는다(토큰 수만 준다).
// cost_report Admin API 는 org 전체 $ 만 줘 기능 분해가 안 된다. 그래서 토큰
// 실측(ground truth) × 공개 단가로 **서버가 est_cost 를 계산**한다. 토큰 수는
// 정확하고, 비용은 이 표에서 파생되므로 단가가 바뀌면 이 표 한 곳만 갱신한다.
//
// 단가 출처(필수 주석): Anthropic 공개 가격 — claude-api 스킬 모델표(cached
// 2026-06-24) 기준. USD / 1M tokens.
//   - claude-opus-4-8   (탑라인 reduce 종합): input $5.00,  output $25.00
//   - claude-sonnet-4-6 (탑라인 map 추출):    input $3.00,  output $15.00
// 변동 시 여기만 수정. 신규 모델은 아래 표에 추가(없으면 estCostUsd 가 0 처리
// + 경고 — 비용 과소계상을 조용히 묻지 않게).
export const MODEL_PRICING_USD_PER_MTOK: Record<
  string,
  { input: number; output: number }
> = {
  'claude-opus-4-8': { input: 5.0, output: 25.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
};

/** 모델 1종의 토큰 사용량 — map/reduce 각각 이 shape 로 누적된다. */
export type LlmCallUsage = {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  model: string;
};

/**
 * 토큰 사용량(input/output) → USD 비용. 단가표에 없는 모델은 0 을 반환하되
 * 경고를 남긴다(과소계상이 조용히 묻히지 않게 — 단가표 갱신 신호). 토큰이 정확
 * 집계값이므로 비용은 결정적으로 파생된다.
 */
export function estCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = MODEL_PRICING_USD_PER_MTOK[model];
  if (!price) {
    console.warn(
      `[llm-pricing] no price for model "${model}" — est_cost counted as 0 (update MODEL_PRICING_USD_PER_MTOK)`,
    );
    return 0;
  }
  return (
    (inputTokens / 1_000_000) * price.input +
    (outputTokens / 1_000_000) * price.output
  );
}

/**
 * map + reduce 누적 사용량의 총 est_cost(USD). 각 단계를 자기 모델 단가로
 * 계산해 합산한다 — map(Sonnet)·reduce(Opus) 단가가 다르므로 단계별로 가른다.
 */
export function estRunCostUsd(map: LlmCallUsage, reduce: LlmCallUsage): number {
  return (
    estCostUsd(map.model, map.input_tokens, map.output_tokens) +
    estCostUsd(reduce.model, reduce.input_tokens, reduce.output_tokens)
  );
}

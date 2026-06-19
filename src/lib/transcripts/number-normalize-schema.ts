import { z } from 'zod';

// Korean number normalization prompt + schema.
//
// ElevenLabs Scribe v2 transcribes Korean numbers as text (e.g. "삼 년",
// "오천만 원", "스무 살") rather than digits. For interview analysis that
// hurts readability and downstream search ("3년" vs "삼 년" don't match).
//
// This pass finds spans of text-form Korean numerals and proposes digit
// equivalents, preserving Korean unit suffixes (만/억/년/월/일/시/분/세/
// 명/번/...). It runs AFTER cleanup and term-normalize so the input is
// already disfluency-free and terminologically consistent.
//
// Output style (option α — Korean unit suffix preserved):
//   "오천만 원"   → "5천만 원"
//   "백만 원"     → "100만 원"
//   "이천이십육 년" → "2026년"
//   "삼십 분"     → "30분"
//   "스무 살"     → "20살"
//   "두 명"       → "2명"
//
// We deliberately DO NOT convert:
//   - Figurative use: "백만 가지 이유" (million-of-X idiom)
//   - Ordinal/poetic: "삼국지", "오감", "백서"
//   - Embedded in proper nouns / brand names
//   - Cases where the LLM is uncertain — prefer leaving original

export const NUMBER_NORMALIZE_SYSTEM = `당신은 한국어 인터뷰 전사록의 숫자 표기 정규화 전문가입니다.

배경:
ElevenLabs Scribe v2 는 한국어 숫자를 텍스트로 받아적습니다 — "삼 년", "오천만 원", "스무 살", "이천이십육 년" 등. 인터뷰 분석/검색을 위해 가능한 곳은 디지트 + 한국식 단위로 변환합니다.

당신의 역할:
전사록에서 **숫자 의미가 명확한** 텍스트형 숫자 표현을 찾아, 디지트 + 단위 형태로 변환할 spans 을 반환.

원칙:
1. **확신이 안 서면 변환하지 마세요**. 모호하면 원본 유지. false-positive 가 false-negative 보다 비용 큼.
2. **한국식 단위 유지**. "오천만 원" → **"5천만 원"** (만/억/조 같은 large unit 어휘는 보존). 풀 디지트 ("50,000,000원") 로 만들지 마세요.
3. **단위 어휘는 단어 그대로 붙임**. 년/월/일/시/분/초/세/살/명/번/개/등/대/시간 등.
4. **figurative / 관용 표현 변환 금지**:
   - "백만 가지 이유" — 막연한 "many" 라 변환 X
   - "천만 다행" — 관용구라 변환 X
   - "삼국지/오감/백서/구미호/삼겹살" — 고유명사·관용어 변환 X
5. **고유명사 / 브랜드명 안 숫자 변환 금지**.
6. **연도는 적극 변환**. "이천이십육 년" → "2026년", "구십년대" → "90년대".
7. **나이는 변환**. "스무 살" → "20살", "서른 살" → "30살", "마흔 살" → "40살" (native Korean numerals 도 변환).
8. **시간 / 기간은 변환**. "세 시간" → "3시간", "삼십 분" → "30분", "이주일" → "2주일".
9. **금액**: "백만 원" → "100만 원", "오천만 원" → "5천만 원", "일억" → "1억", "삼천억" → "3천억". **만/억 단위 어휘는 그대로**.
10. **원본 span 은 전사록에 실제로 등장하는 정확한 부분 문자열**. 띄어쓰기 포함해서 그대로. 추정·재구성 금지.
11. **정규화된 형태는 자연스러운 한국어**. 띄어쓰기는 원본 패턴 따라가되, "3년" / "3 년" 중 자연스러운 쪽 선택.

판단 시그널:
- **단위가 붙어있으면 거의 확실히 숫자**: "삼 년", "오 분", "백만 원", "두 명" — 변환.
- **서수/수량 맥락에서 native Korean numeral**: "두 번째", "다섯 사람", "스무 살" — 변환.
- **수가 명확한 sino-Korean**: "오천", "삼천", "백만", "일억" 단독 + 단위 — 변환.
- **단위 없이 단독 등장 시 신중**: "삼이라는 숫자가" — 변환 OK. "삼겹살을 먹었어요" — 명사 일부, 변환 X.
- **확신 없으면 빈 spans 반환**. 한 span 이라도 100% 확신 없으면 그 span 통째로 제외.`;

export const numberSpanSchema = z.object({
  original: z
    .string()
    .min(1)
    .describe(
      '전사록에 등장하는 텍스트형 숫자 표현 그대로 (띄어쓰기·단위 포함). 추정 금지.',
    ),
  normalized: z
    .string()
    .min(1)
    .describe(
      '디지트 + 한국식 단위 형태. 예: "5천만 원", "2026년", "30분", "20살".',
    ),
  kind: z
    .enum(['year', 'duration', 'time', 'age', 'count', 'money', 'date', 'other'])
    .describe('변환된 숫자의 의미 종류 (감사 로그용).'),
  reason: z
    .string()
    .max(120)
    .describe('이 변환을 선택한 근거 (한 줄).'),
});

export const numberNormalizeSchema = z.object({
  spans: z
    .array(numberSpanSchema)
    .describe(
      '변환 후보 spans. 확신 없으면 빈 배열 — false-positive 가 false-negative 보다 비용 큼.',
    ),
  reasoning: z
    .string()
    .max(300)
    .describe('전체 작업 한 줄 요약 (감사 로그용).'),
});

export type NumberSpan = z.infer<typeof numberSpanSchema>;
export type NumberNormalizeDecision = z.infer<typeof numberNormalizeSchema>;

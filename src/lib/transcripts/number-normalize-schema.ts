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

// English variant — same span schema, applied to Deepgram nova-3 transcripts
// where text-form numerals ("three years", "five hundred dollars",
// "twenty-three percent") want digit replacements with the unit word kept.
export const NUMBER_NORMALIZE_SYSTEM_EN = `You normalize text-form English numerals to digit form in an interview transcript (Deepgram nova-3 output).

Background:
Deepgram transcribes spoken numbers as words ("three years", "five hundred dollars", "twenty-three percent"). For analysis and search, convert to digit forms while preserving the unit/currency word.

Your role:
Find spans where the **numeric meaning is unambiguous** and propose a digit replacement.

Principles:
1. **When uncertain, do not convert.** Ambiguous → leave the original. False-positives are more costly than false-negatives.
2. **Preserve the unit word.** "three years" → **"3 years"** (keep "years" as-is). Do not strip or rewrite the unit.
3. **Common units** to preserve verbatim: years/year, months/month, weeks/week, days/day, hours/hour, minutes/minute, seconds/second, dollars/dollar, cents/cent, percent, percentage, people, times, kilometers, miles, kilograms, pounds, grams, megabytes, gigabytes, etc.
4. **CRITICAL — the unit word must already appear in the original span**:
   - "three years" → "3 years" ✅ ("years" appears in original)
   - "three" → "3 years" ❌ **forbidden** — global substitution would mangle unrelated "three" occurrences ("Big Three", "three of them", etc.)
   - **Rule: any unit word in normalized must literally appear in original.** Bare numbers without an attached unit are auto-rejected by the guard — do not propose them.
5. **Skip figurative / idiomatic**:
   - "a thousand reasons" — figurative many, skip.
   - "in a million years" — idiom, skip.
   - "twenty-twenty hindsight" — fixed expression.
6. **Skip proper-noun / brand-name internal numbers** ("Big Three", "Catch-22", "Forty-Two") and movie/book titles.
7. **Years are good targets.** "the year two thousand twenty-six" → "the year 2026", "nineteen ninety-nine" → "1999". For decades, "the nineties" → "the 90s".
8. **Ages and durations.** "twenty-three years old" → "23 years old", "thirty minutes" → "30 minutes", "five hours" → "5 hours".
9. **Money.** Prefer "$N" form when the original has "dollars" trailing: "five hundred dollars" → "$500" (drop "dollars"). Large-unit words stay: "two million dollars" → "$2 million". Cents: "five cents" → "5 cents".
10. **Counts.** "twenty-three people" → "23 people", "five times" → "5 times", "three children" → "3 children".
11. **Original span = exact substring in the transcript** (whitespace included). No paraphrasing.
12. **Normalized form reads naturally**. Hyphens like "twenty-three" → "23". Sentence-leading numbers stay digits ("3 years ago, ...").
13. **No duplicate (original → normalized) pairs.** Deduped downstream.

Decision signals:
- **Unit attached → almost certainly numeric**: "three years", "five dollars", "twenty minutes" → convert.
- **Multi-word ordinal/cardinal**: "twenty-three", "one hundred and twenty" → convert.
- **Compound year**: "two thousand twenty-six", "nineteen ninety" → convert.
- **Bare single word without unit → be cautious**: skip "three" alone unless context makes it unambiguous.
- **No confidence → empty spans.** 100% sure or skip.`;

export const NUMBER_NORMALIZE_SYSTEM = `당신은 한국어 인터뷰 전사록의 숫자 표기 정규화 전문가입니다.

배경:
ElevenLabs Scribe v2 는 한국어 숫자를 텍스트로 받아적습니다 — "삼 년", "오천만 원", "스무 살", "이천이십육 년" 등. 인터뷰 분석/검색을 위해 가능한 곳은 디지트 + 한국식 단위로 변환합니다.

당신의 역할:
전사록에서 **숫자 의미가 명확한** 텍스트형 숫자 표현을 찾아, 디지트 + 단위 형태로 변환할 spans 을 반환.

원칙:
1. **확신이 안 서면 변환하지 마세요**. 모호하면 원본 유지. false-positive 가 false-negative 보다 비용 큼.
2. **한국식 단위 유지**. "오천만 원" → **"5천만 원"** (만/억/조 같은 large unit 어휘는 보존). 풀 디지트 ("50,000,000원") 로 만들지 마세요.
3. **단위 어휘는 단어 그대로 붙임**. 년/월/일/시/분/초/세/살/명/번/개/등/대/시간 등.
4. **CRITICAL — 단위 어휘를 original 에 반드시 포함하세요**:
   - "오백만 원" → "500만 원" ✅ (단위 "만 원" 이 original 에 있음)
   - "오백" → "500만 원" ❌ **절대 금지**. 이유: 짧은 "오백" 은 "오백만 원" 같은 더 긴 표현의 substring 으로 들어가 있어서, 전 문서 치환 시 "오백만 원" → "500만 원만 원" 같은 깨진 텍스트가 됨.
   - "삼" → "3" ❌ **절대 금지**. "삼" 은 "삼겹살", "삼국지" 같은 고유명사·일반명사의 일부일 수 있음.
   - **규칙: normalized 가 갖는 모든 한국어 단위 글자(만/억/조/년/원/...) 는 original 에도 반드시 그대로 들어있어야 함.** 단위 없는 짧은 숫자 단어는 절대 제안하지 마세요 — 가드에서 자동 폐기됨.
5. **figurative / 관용 표현 변환 금지**:
   - "백만 가지 이유" — 막연한 "many" 라 변환 X
   - "천만 다행" — 관용구라 변환 X
   - "삼국지/오감/백서/구미호/삼겹살" — 고유명사·관용어 변환 X
6. **고유명사 / 브랜드명 안 숫자 변환 금지**.
7. **연도는 적극 변환**. "이천이십육 년" → "2026년", "구십년대" → "90년대".
8. **나이는 변환**. "스무 살" → "20살", "서른 살" → "30살", "마흔 살" → "40살" (native Korean numerals 도 변환).
9. **시간 / 기간은 변환**. "세 시간" → "3시간", "삼십 분" → "30분", "이주일" → "2주일".
10. **금액**: "백만 원" → "100만 원", "오천만 원" → "5천만 원", "일억" → "1억", "삼천억" → "3천억". **만/억 단위 어휘는 그대로**.
11. **원본 span 은 전사록에 실제로 등장하는 정확한 부분 문자열**. 띄어쓰기 포함해서 그대로. 추정·재구성 금지.
12. **정규화된 형태는 자연스러운 한국어**. 띄어쓰기는 원본 패턴 따라가되, "3년" / "3 년" 중 자연스러운 쪽 선택.
13. **같은 (original → normalized) 쌍을 반복해서 제안하지 마세요**. 중복 spans 은 폐기됨.

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
  // .max() 제거: 영어 LLM 이 한국어보다 길게 reason 을 작성해서 캡으로
  // schema validation 실패 → 전체 패스 폐기됐던 회귀 (PR #350 진단).
  // audit 전용 필드라 길이 제약 무의미.
  reason: z.string().describe('이 변환을 선택한 근거.'),
});

export const numberNormalizeSchema = z.object({
  spans: z
    .array(numberSpanSchema)
    .describe(
      '변환 후보 spans. 확신 없으면 빈 배열 — false-positive 가 false-negative 보다 비용 큼.',
    ),
  reasoning: z.string().describe('전체 작업 요약 (감사 로그용).'),
});

export type NumberSpan = z.infer<typeof numberSpanSchema>;
export type NumberNormalizeDecision = z.infer<typeof numberNormalizeSchema>;

import { z } from 'zod';

// Cross-turn terminology normalization prompt + schema.
//
// The per-chunk cleanup pass cannot fix inconsistent STT spellings of the
// SAME word across the document (it only sees 20 turns at a time and is
// explicitly forbidden from touching proper nouns). Example: a 1-hour
// interview where "스피커폰" gets transcribed as 스피커폰 / 스피카폰 /
// 스피크폰 / 스피커 폰 across 5 mentions — each chunk sees a single
// instance and assumes it's correct.
//
// This pass takes the full cleaned markdown and asks the LLM to identify
// clusters of variants that are clearly the same word, then return the
// canonical form. The route applies the substitutions only when each
// variant appears ≥2 times AND length-drift across the doc stays under
// a hard cap — defending against an over-eager LLM merging genuinely
// different words.

export const TERM_NORMALIZE_SYSTEM = `당신은 한국어 인터뷰 전사록의 고유명사·전문용어 일관성 정규화 전문가입니다.

배경:
ElevenLabs Scribe v2 는 같은 단어를 인터뷰 안에서 매번 같은 표기로 들려주지 않습니다. 한 사람이 "스피커폰" 을 5번 말했어도 각각 [스피커폰 / 스피카폰 / 스피크폰 / 스피커 폰 / 스피카 폰] 으로 다르게 표기될 수 있습니다.

당신의 역할:
전사록 전체를 보고 **같은 단어의 다른 STT 표기 클러스터** 를 찾아내, 각 클러스터마다 정답 표기 (canonical) 를 결정.

원칙:
1. **확신이 안 서면 빈 배열 반환**. 한 클러스터라도 100% 같은 단어인지 모르겠으면 그 클러스터는 통째로 제외.
2. **명백한 STT 변형만 묶기**. 음성학적으로 매우 가깝고 (예: 받침 차이, 모음 차이 1자, 띄어쓰기 차이) 같은 문맥에서 등장.
3. **다른 단어를 같은 단어로 묶지 마세요**. "공항" 과 "공장" 은 음성학적으로 가깝지만 의미가 다른 단어 — 묶지 마세요.
4. **일반 명사·동사·형용사는 손대지 마세요**. "그래서/그러니까/근데" 같은 흔한 단어, "보다/하다/먹다" 같은 동사, "좋다/예쁘다" 같은 형용사는 대상 X. **고유명사 (사람·브랜드·제품·장소·서비스 이름) 와 전문용어 (technical jargon) 에만 집중**.
5. **각 variant 는 전사록에 실제로 등장해야 함**. 추정·재구성 금지.
6. **각 variant 는 최소 1번 등장**. 1번만 나오는 표기여도 다른 표기가 ≥2번 나오면 포함 가능 (그 1번을 정답으로 통일하는 게 가치 있음).
7. **canonical 은 클러스터 안 variant 중 하나여야 함**. 새 단어 만들지 마세요.
8. **변형 폭 제한**. canonical 과 variant 의 길이 차이는 보통 ±2자 이내. 차이가 크면 같은 단어가 아닐 가능성이 높음.

판단 시그널:
- **받침 차이**: 스피커폰/스피커펀 — 받침 ㄴ/ㄴ 동일이라 무변동, 모음 ㅓ/ㅓ 동일.
- **모음 1자 차이**: 스피커폰/스피카폰 — 모음 ㅓ → ㅏ.
- **자음 1자 차이**: 핸드폰/한드폰 — 첫자음 ㅎ → ㅎ 동일이지만 모음 ㅐ → ㅏ.
- **띄어쓰기**: 스피커폰/스피커 폰 — 같은 단어 거의 확실.
- **외래어 표기 흔들림**: 아이폰/아이펀, 메시지/메세지, 마케팅/마켓팅.
- **같은 문장 맥락에서 등장**: "스피커폰 으로 통화" 와 "스피카폰 이 작아서" — 둘 다 비슷한 디바이스 맥락.

출력:
- clusters: 변형 그룹들의 배열. 확신 없으면 빈 배열.
- reasoning: 한 줄짜리 전체 근거 (어떤 종류 클러스터를 찾았는지). 감사 로그용.`;

export const termClusterSchema = z.object({
  canonical: z
    .string()
    .min(1)
    .describe(
      '정답 표기. 클러스터 안 variant 중 하나여야 함. 새 단어 만들기 금지.',
    ),
  variants: z
    .array(z.string().min(1))
    .min(2)
    .describe(
      '같은 단어로 묶이는 다른 STT 표기들 (canonical 자체 포함 가능). 최소 2개 이상.',
    ),
  reason: z
    .string()
    .max(120)
    .describe('이 클러스터가 같은 단어라고 판단한 근거 (한 줄).'),
});

export const termNormalizeSchema = z.object({
  clusters: z
    .array(termClusterSchema)
    .describe(
      '발견된 변형 클러스터들. 확신 없으면 빈 배열 — false-positive 가 false-negative 보다 비용 큼.',
    ),
  reasoning: z
    .string()
    .max(300)
    .describe('전체 정규화 작업 한 줄 요약 (감사 로그용).'),
});

export type TermCluster = z.infer<typeof termClusterSchema>;
export type TermNormalizeDecision = z.infer<typeof termNormalizeSchema>;

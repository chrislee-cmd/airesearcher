// AI 동시통역 — 사후 post-process 보정 (Layer D).
//
// revise (translate-revise.ts) 와의 차이:
//   - revise   : source (kind='input') 행을 처음부터 batch 재번역 →
//                input.revised_text 에 per-row 저장.
//   - postprocess: 실시간 통역 OUTPUT (kind='output') 전사록 *전체* 를 한
//                번에 LLM 으로 검토해 단어 융합 / 인명 표기 흔들림 /
//                고유명사 soundalike / 의미 압축을 교정하고, 불확실 구간은
//                임의 복원하지 않고 플래그(⟦?⟧ 류)를 남긴 markdown artifact
//                를 생성. source 행은 SSOT 로 유지 (덮어쓰지 않음).
//
// 프롬프트는 사용자 제공 범용 프롬프트를 그대로 사용한다 (도메인/제품 종속
// 0). 인명/고유명사 정규화는 host 가 입력한 glossary 를 우선 hint 로 쓰되,
// glossary 가 비어 있으면 "첫 등장 표기로 통일 + 플래그" 로 폴백한다.
//
// 이 모듈은 LLM-facing 레이어. route
// (src/app/api/translate/sessions/[id]/postprocess/route.ts) 가 auth /
// credit gating / DB 읽기·쓰기를 담당하고 실제 호출은 여기에 위임한다.

import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { ZERO_RETENTION } from './llm/config';
import { languageLabel } from './translate-instructions';

// Claude Sonnet 4-6 — revise 와 동일. 의미 보존 정확도(환각 회피) 가
// 핵심이라 Haiku 보다 Sonnet 을 택한다 (spec 사용자 결정 C).
const MODEL = 'claude-sonnet-4-6';
export const POST_PROCESS_MODEL_LABEL = MODEL;

// 한 번의 LLM 호출로 전사록 전체를 본다. 16k output token 은 30분 세션
// (~300줄) 의 교정 결과 + 교정 로그를 담기에 충분. 그보다 긴 세션은 길이
// 초과 시 잘릴 수 있으나, 보정은 best-effort 옵션 기능이라 허용한다.
const MAX_OUTPUT_TOKENS = 16000;

export type PostProcessOptions = {
  smooth: 'on' | 'off';
  canonical_name?: string;
};

export type PostProcessSessionMeta = {
  session_id: string;
  date: string; // YYYY-MM-DD
  src: string; // source lang code
  tgt: string; // target lang code
  speakers: number;
};

export type PostProcessResult = {
  correctedMarkdown: string;
  flagsCount: number;
};

// 사용자 제공 프롬프트의 정적(지시) 부분. 역할 / 절대원칙 / 보정영역 /
// 출력형식 — 도메인 예시 0. 출력형식 안의 `{...}` placeholder 는 모델이
// 채울 프론트매터 템플릿이므로 치환하지 않고 그대로 둔다.
const POST_PROCESS_SYSTEM = `# 전사록 보정 프롬프트 (ko→en Translate/Interpretation Transcript Post-Processing)

## 역할
너는 정성 리서치 전사 감수자다. 입력 영어 전사록은 한국어(또는 타 언어) 음성을 실시간 통역하거나
기계번역한 결과라 **2단계 오류**(통역/번역 + ASR)가 누적돼 있다.
임무는 **명백한 전사·번역 오류만 정확히 교정**하고, 불확실하거나 의미가 붕괴된 구간은
**임의로 복원하지 말고 플래그**하는 것이다.

## 절대 원칙 (위반 시 작업 무효)
1. **환각 금지.** 원문에 없는 사실·문장·수치를 만들어내지 않는다. "그럴듯하게" 채우지 않는다.
   - 근거가 모호한 턴은 추측하지 말고 앞에 \`⟦화자?⟧\`를 붙인다.
2. **2차 전사본**(reference)이 네이티브 화자 라벨을 가지면 그것을 정답지로 경계를 맞춘다.

## 보정 영역

### 1. 화자 식별 / 턴 경계 (Speaker & Turn)
- 화자 misattribution 식별 + 정정
- 한 줄 두 화자 혼합 분리

### 2. 발화 경계 / 단어 융합 복구 (Turn & Word-Fusion Repair)
- 공백 없이 들러붙은 단어 분리 (단어 추가/삭제 없이 끊어 읽기만 복구)
- 예: \`there's alsoOnce\` → \`there's also. Once\`
- 예: \`the main hubthe key tool\` → \`the main hub, the key tool\`
- 예: \`sayanything\` → \`say anything\`
- 한 줄 두 화자 뭉친 경우 턴 분리

### 3. 인명·고유 식별자 표기 통일 (Name Normalization)
- 같은 인물·조직의 음차 흔들림 → 정규 표기로 통일 (glossary 우선)
- glossary 에 없으면 첫 등장 표기로 통일 + \`⟦표기확인필요⟧\` 플래그
- options.canonical_name 가 있으면 그것 강제

### 4. 도구·고유명사 soundalike 교정 (Term Soundalike)
- 글로서리 표준형 우선
- reference / 오디오로 확인되면 교정 후 \`⟦교차검증: 출처⟧\`
- 둘 다 아니면 치환 X + \`⟦용어?⟧\` 플래그
- 문맥 게이트 — 같은 음차의 의미 분기 시 모호하면 플래그
- 일관성 — 확정 표준형 전 구간 동일 적용 (게이트 통과 출현만)

### 5. 의미 압축 / 탈락 복원 (Compression Recovery)
- LLM/통역이 압축하다 핵심 절 탈락 → 임의 복원 금지
- reference 에 대응 구간 명확하면 교정 + \`⟦교차검증: 출처⟧\`
- 없으면 \`⟦의미불명⟧\` 플래그 + 원문 보존

### 6. (선택) 번역체 다듬기 (Fluency Smoothing) — 기본 OFF
- options.smooth='on' 시만 활성
- 의미 변경 0, 어색한 번역체만 다듬기
- 수치 / 고유명사 / 인용 핵심 문장 손대지 0

## 출력 형식

\`\`\`
---
session: {session_id}
date: {date}
source_target: {src} -> {tgt}
speakers: {N}
roles: {roles}
corrections_applied: [speaker, fusion, name, term, ...]
flags_count: {N}
---

**[HH:MM:SS] {Role}:** …
**[HH:MM:SS] {Role}:** …

## 교정 로그
| 타임스탬프 | 원문 | 교정 | 근거/플래그 |
|---|---|---|---|
| ... | ... | ... | ... |
\`\`\`

플래그 종류:
- \`⟦?⟧\` (애매)
- \`⟦화자?⟧\` (화자 추정 불가)
- \`⟦의미불명⟧\` (의미 압축 손실)
- \`⟦표기확인필요⟧\` (glossary 없음)
- \`⟦교차검증: {출처}⟧\` (reference / 오디오 확인)

반드시 위 출력 형식만 반환한다. 코드펜스 없이 frontmatter(---) 로 시작한다.`;

// glossary / reference / options / transcript 를 명시적으로 구분된 입력
// 블록으로 조립한다. 사용자 프롬프트의 `<glossary>/<reference>/<options>/
// <transcript>` 주입 메커니즘을 그대로 따른다.
function buildInputBlock(args: {
  rawTranscript: string;
  glossary: string[];
  reference?: string;
  options: PostProcessOptions;
  sessionMeta: PostProcessSessionMeta;
}): string {
  const { rawTranscript, glossary, reference, options, sessionMeta } = args;
  const glossaryList =
    glossary.length > 0
      ? glossary.map((g) => `- ${g}`).join('\n')
      : '(비어있음 — 자유 정규화: 첫 등장 표기로 통일 + 플래그)';
  return [
    '## 세션 메타 (frontmatter 작성에 사용)',
    `session_id: ${sessionMeta.session_id}`,
    `date: ${sessionMeta.date}`,
    `source_target: ${languageLabel(sessionMeta.src)} -> ${languageLabel(sessionMeta.tgt)}`,
    `speakers: ${sessionMeta.speakers}`,
    '',
    '## 입력',
    '',
    '<glossary>',
    glossaryList,
    '</glossary>',
    '',
    '<reference>',
    reference?.trim() ? reference.trim() : '(없음)',
    '</reference>',
    '',
    '<options>',
    `smooth: ${options.smooth}`,
    `canonical_name: ${options.canonical_name?.trim() || '(미지정)'}`,
    '</options>',
    '',
    '<transcript>',
    rawTranscript,
    '</transcript>',
  ].join('\n');
}

// frontmatter 의 flags_count 를 우선 신뢰하되, 없거나 파싱 실패 시 본문의
// 플래그 마커(⟦…⟧) 출현 수로 폴백한다. 사용자 후 QA 시 "확인 필요" 줄
// 수를 빠르게 보여주기 위한 메타.
export function countFlags(markdown: string): number {
  const fm = /flags_count:\s*(\d+)/.exec(markdown);
  if (fm) {
    const n = Number.parseInt(fm[1], 10);
    if (Number.isFinite(n)) return n;
  }
  const markers = markdown.match(/⟦[^⟧]*⟧/gu);
  return markers ? markers.length : 0;
}

export async function postProcessTranscript(args: {
  rawTranscript: string;
  glossary: string[];
  reference?: string;
  options: PostProcessOptions;
  sessionMeta: PostProcessSessionMeta;
}): Promise<PostProcessResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('missing_anthropic_key');
  if (!args.rawTranscript.trim()) throw new Error('transcript_empty');

  const anthropic = createAnthropic({ apiKey });
  const result = await generateText({
    model: anthropic(MODEL),
    system: POST_PROCESS_SYSTEM,
    prompt: buildInputBlock(args),
    // 0.1 — 보정 작업. 환각 회피, 거의 결정적. revise(0.2) 보다 더 낮춘다:
    // 여기서는 새 번역이 아니라 기존 출력의 명백한 오류만 손대므로.
    temperature: 0.1,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    providerOptions: ZERO_RETENTION,
  });

  const correctedMarkdown = result.text.trim();
  if (!correctedMarkdown) throw new Error('postprocess_empty_response');
  return {
    correctedMarkdown,
    flagsCount: countFlags(correctedMarkdown),
  };
}

// Shared building blocks across the four report-type prompts. Anything
// that is identical between design / marketing / strategy / findings
// lives here so a token rename or output-rule tweak hits all variants.

// Voice rules. Injected into every system prompt (both normalize and
// generate, plus enhance) so the report reads like an editorial story a
// non-specialist can follow, not a bureaucratic memo. Three pillars:
//   1) 존대말 (해요체) — friendly, respectful Korean.
//   2) Plain Korean — avoid 한자식 표현/전문 용어 when a 표준 한글
//      equivalent exists. Translate the term inline when unavoidable.
//   3) Narrative — stitch findings into a story arc with connectives
//      (그래서 / 흥미롭게도 / 반대로) instead of dry bullets only.
export const WRITING_TONE_BLOCK = `## 글의 톤·표현 규칙 (절대 규칙)

1. **존대말로 작성하세요.** 모든 본문·헤드라인·카드 설명·시사점·관찰을 **"~합니다 / ~했어요 / ~보였어요 / ~할 수 있어요"** 같은 해요체 또는 합쇼체로 씁니다.
   - ✗ "사용자는 가격에 민감하다." → ✓ "사용자분들은 가격에 민감했어요."
   - ✗ "도입이 필요하다." → ✓ "도입을 검토해 볼 수 있어요."
   - 차트 라벨이나 표 헤더(\`AM\`, \`72%\`) 같은 짧은 라벨은 예외.

2. **누구나 한 번에 이해하는 평이한 한국어**를 쓰세요. 한자어/전문 용어 대신 표준 한글 표현을 우선합니다.
   - ✗ 도출 → ✓ 끌어냈어요 / 찾아냈어요
   - ✗ 시사점 → ✓ 우리가 배운 점 / 눈여겨볼 부분
   - ✗ 페인포인트 → ✓ 사용자가 답답해하는 지점
   - ✗ 인사이트 → ✓ 발견한 점
   - ✗ 정성/정량 → ✓ 인터뷰에서 나온 이야기 / 숫자로 본 흐름
   - ✗ 코호트, 세그먼트 → ✓ 비슷한 사용자 그룹
   - ✗ 우선순위화 → ✓ 어떤 것부터 할지 정하기
   - ✗ 활용도 → ✓ 얼마나 자주 쓰는지
   - 영어 약어는 풀어 쓰거나 한 번 설명 후 사용 (\`MoM(전월 대비)\`).
   - 영어로만 의미가 통하는 디자인 토큰(eyebrow, verbatim, KPI)은 그대로 둬도 됩니다.

3. **스토리텔링 내러티브로 풀어 쓰세요.**
   - 챕터 헤더(\`lede\`) 한 단락은 **장면·인물·갈등이 보이는 도입**으로. 예: "처음에는 단순히 가격 때문에 망설인다고 생각했는데, 실제로 들어 보니 이유가 조금 달랐어요."
   - Findings는 bullet만 나열하지 말고, bullet 위에 **연결되는 한두 문장의 흐름 글**을 둡니다.
   - 연결어를 자연스럽게 사용: \`그래서\`, \`흥미롭게도\`, \`반대로\`, \`결국\`, \`다시 말해\`, \`눈에 띄는 건\`.
   - Verbatim 인용 앞뒤로 **왜 이 말이 중요한지** 한두 문장으로 풀어 줍니다.
   - Executive Summary는 "이 보고서를 처음 받아 본 사람도 흐름이 보이도록" 짧은 이야기처럼 이어 씁니다 (각 카드 자체는 그래도 한 문장 헤드라인 + 두세 문장 설명).
   - Recommendations 또는 Observations은 "왜 이걸 해야 하는지(또는 왜 이렇게 보이는지)" 짧은 사연을 먼저, 그 뒤에 액션/관찰을 둡니다.

4. **너무 단정 짓지 말기.** 자료가 약한 부분은 \`아직 자료가 부족해 보이지만\`, \`일부 응답에서만 확인됐어요\` 같은 식으로 강도를 조절하세요. 추정은 \`(추정)\`으로 표시합니다.

5. **이모지·과한 수사 금지.** 친근하되 차분한 출판물 톤을 유지합니다. 느낌표 남발 금지.`;

// Strict output rules that every normalize stage must obey. Each variant
// appends its own schema after this.
export const STRICT_MD_OUTPUT = `엄격한 출력 규칙:
- 출력은 **순수 Markdown 한 개만**. 코드펜스, 머리말, 설명 금지.
- 섹션 헤더는 **반드시 아래 스키마 순서·표기 그대로** 사용. 빠뜨리지 말 것.
- 입력 자료에 명시적으로 없는 사실/숫자/인용을 만들지 말 것. 자료가 부족한 섹션은 \`(자료 미흡)\` 한 줄로 표기.
- 모든 정성 인용은 \`> "원문 그대로"\` blockquote + 다음 줄에 \`— 화자/세그먼트 (출처파일명)\` 표기.

${WRITING_TONE_BLOCK}`;

// Strict output rules every generate (HTML) stage must obey.
export const STRICT_HTML_OUTPUT = `**출력은 순수 HTML 한 개만.** 코드펜스(\`\`\`)·설명·머리말 없이 곧바로 \`<!doctype html>\`로 시작하세요. 외부 CSS/JS/이미지/폰트 참조 금지 — 모든 스타일은 \`<head>\` 안 \`<style>\`에 인라인. **\`<script>\` 태그·인라인 이벤트 핸들러(onclick 등)·SVG 안의 \`<script>\` 모두 금지** — 페이지는 정적이어야 합니다. 막대 차트는 \`<div>\` + CSS \`width:%%\`로만 표현하세요.

${WRITING_TONE_BLOCK}`;

// Editorial design tokens + base typography. Every generate variant
// concatenates this so the four report types share an instantly
// recognizable visual identity even though their content shapes differ.
export const DESIGN_TOKENS_BLOCK = `## 디자인 토큰 (필수, 정확히 이 값 사용)

\`\`\`css
:root {
  --amore: #1F5795;       /* primary accent */
  --amore-soft: #3d72ad;
  --amore-bg: #eaf0f8;
  --pacific: #001C58;
  --ink: #000000;
  --ink-2: #1a1a1a;
  --mute: #5a5a5a;
  --mute-soft: #9b9b9b;
  --line: #e1e3e8;
  --line-soft: #f1f3f6;
  --paper: #ffffff;
  --paper-soft: #fafafb;
}
body {
  font-family: 'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo', system-ui, sans-serif;
  background: var(--paper);
  color: var(--ink-2);
  margin: 0;
  -webkit-font-smoothing: antialiased;
}
.page { max-width: 1120px; margin: 0 auto; padding: 56px 32px 96px; }
\`\`\`

## 디자인 원칙 (반드시 지키기)
1. **Editorial, not Dashboard** — 출판물 톤. 본문 max-width 1120px, 한 컬럼 흐름.
2. **타이포그래피로 위계** — 색·그림자·아이콘 최소화.
3. **UPPERCASE eyebrow** — 모든 챕터/카드 위에 \`font-size:10–11px; letter-spacing:.22em; text-transform:uppercase; color:var(--amore); font-weight:600\` 라벨을 둠. 앞에는 \`width:24px; height:1px; background:var(--amore)\` 짧은 액센트 라인.
4. **얇은 선, 작은 라운드** — 카드 \`border-radius:4px; border:1px solid var(--line)\`. **그림자 절대 금지**. 라운드 4px 초과 금지.
5. **단일 액센트** — \`--amore\` 한 색만. 빨강/초록 신호색·이모지·그라디언트 배경 금지.
6. **그리드는 2 또는 3 컬럼만** — \`display:grid; gap:20px; grid-template-columns:1fr 1fr\` 또는 \`1fr 1fr 1fr\`.
7. **본문 line-height ≥ 1.6**, 본문 12.5–13px, mute 색.

## 타입 스케일 (정확히)
- H1 Cover Title: 36px / 700 / -0.025em
- H2 Chapter Title: 20px / 700 / -0.018em
- H3 Card Title: 17px / 600 / -0.005em
- Section Title: 18px / 700 / -0.02em
- Body: 12.5–13px / 400 / line-height 1.7
- Body Small: 11.5px / 400 / 0.02em
- Caption: 11px / 400
- Stat Big: 42px / 700 / -0.01em
- Eyebrow: 10–11px / 600–700 / 0.22em UPPERCASE
- Verbatim 인용: italic, 12px, var(--mute), \`— 화자\` 주석은 \`font-style:normal; color:var(--mute-soft)\`.

## 챕터 헤더 시그니처 (모든 챕터 시작)
\`\`\`html
<header class="chapter-header">
  <div class="eyebrow"><span class="eyebrow-line"></span><span>Chapter 01</span><span class="eyebrow-sub">· 부제</span></div>
  <h2>챕터 제목</h2>
  <p class="lede">한 단락 리드 (max-width 820px, line-height 1.75, color: var(--mute))</p>
</header>
\`\`\`

## 인라인 막대 (정량 시각화)
\`\`\`html
<div class="bar-row">
  <span class="bar-label">AM</span>
  <div class="bar"><div class="bar-fill" style="width:72%"></div></div>
  <span class="bar-pct">72%</span>
</div>
\`\`\`
막대 height 4px, 배경 var(--line-soft), 채움은 var(--amore) 단색. 우측 % 라벨 11px var(--mute-soft).

## Verbatim 인용 (정성)
\`\`\`html
<blockquote class="verbatim">
  "원문 발화를 그대로"
  <cite>— 30대 여 · 민감성 (파일명.docx)</cite>
</blockquote>
\`\`\`
italic 12px var(--mute), \`<cite>\`는 \`font-style:normal; color:var(--mute-soft); margin-left:6px\`. 좌측 1px var(--amore) 보더.

## Don't
- ✗ 그림자, 그라디언트 배경, glassmorphism
- ✗ radius 4px 초과
- ✗ 빨강/초록/노랑 신호 컬러 차트
- ✗ 이모지·아이콘 폰트
- ✗ 4컬럼 이상 그리드
- ✗ 입력 자료에 없는 사실/숫자 만들어내기 — 추론은 "추정" 표시`;

// Schema preamble for the normalize stage — shared frontmatter.
export const NORMALIZE_FRONTMATTER_BLOCK = `---
title: <리포트 제목>
subtitle: <한 줄 부제>
period: <자료 수집 기간 또는 추정>
sample: <응답자 수·구성 요약>
sources: <파일 수>
---`;

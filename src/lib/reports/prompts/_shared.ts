// Shared building blocks across the four report-type prompts. Anything
// that is identical between design / marketing / strategy / findings
// lives here so a token rename or output-rule tweak hits all variants.

// Strict output rules that every normalize stage must obey. Each variant
// appends its own schema after this.
export const STRICT_MD_OUTPUT = `엄격한 출력 규칙:
- 출력은 **순수 Markdown 한 개만**. 코드펜스, 머리말, 설명 금지.
- 섹션 헤더는 **반드시 아래 스키마 순서·표기 그대로** 사용. 빠뜨리지 말 것.
- 입력 자료에 명시적으로 없는 사실/숫자/인용을 만들지 말 것. 자료가 부족한 섹션은 \`(자료 미흡)\` 한 줄로 표기.
- 모든 정성 인용은 \`> "원문 그대로"\` blockquote + 다음 줄에 \`— 화자/세그먼트 (출처파일명)\` 표기.`;

// Strict output rules every generate (HTML) stage must obey.
export const STRICT_HTML_OUTPUT = `**출력은 순수 HTML 한 개만.** 코드펜스(\`\`\`)·설명·머리말 없이 곧바로 \`<!doctype html>\`로 시작하세요. 외부 CSS/JS/이미지/폰트 참조 금지 — 모든 스타일은 \`<head>\` 안 \`<style>\`에 인라인. **\`<script>\` 태그·인라인 이벤트 핸들러(onclick 등)·SVG 안의 \`<script>\` 모두 금지** — 페이지는 정적이어야 합니다. 막대 차트는 \`<div>\` + CSS \`width:%%\`로만 표현하세요.`;

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

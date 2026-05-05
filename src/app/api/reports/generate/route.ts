import { NextResponse } from 'next/server';
import { z } from 'zod';
import { streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { spendCredits } from '@/lib/credits';
import { FEATURE_COSTS } from '@/lib/features';

export const maxDuration = 300;

const MAX_MARKDOWN_CHARS = 200_000;

const Body = z.object({
  markdown: z.string().min(1).max(MAX_MARKDOWN_CHARS),
  sources: z.array(z.string()).max(50).default([]),
});

// Embed the design system spec directly in the system prompt so the model
// produces a self-contained HTML doc that already matches our editorial
// tone (Pretendard sans, 4px radius, 1px lines, single amore accent,
// uppercase eyebrow labels). Source: design-system.md.
const SYSTEM = `당신은 시니어 UX·마케팅 리서처이자 에디토리얼 디자이너입니다. 업로드된 인터뷰/리서치 자료들을 종합해서 한 편의 완성된 HTML 리포트 문서를 작성합니다.

**출력은 순수 HTML 한 개만.** 코드펜스(\`\`\`)·설명·머리말 없이 곧바로 \`<!doctype html>\`로 시작하세요. 외부 CSS/JS/이미지/폰트 참조 금지 — 모든 스타일은 \`<head>\` 안 \`<style>\`에 인라인. **\`<script>\` 태그·인라인 이벤트 핸들러(onclick 등)·SVG 안의 \`<script>\` 모두 금지** — 페이지는 정적이어야 합니다. 막대 차트는 \`<div>\` + CSS \`width:%%\`로만 표현하세요.

## 디자인 토큰 (필수, 정확히 이 값 사용)

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

## 필수 문서 구조 (이 순서)
1. **Cover** — 워드마크 → 1px 액센트 라인 → \`SKINCARE RESEARCH · YYYY\` 식 UPPERCASE 캡션 → H1 제목 → 한 줄 부제 → 4-stat 메타 그리드 (METHOD / SAMPLE / PERIOD / CHAPTERS).
2. **Methodology** — 자료 출처 파일 수·종류, 요약된 분석 절차.
3. **Executive Summary** — 핵심 인사이트 3–5개, 2 또는 3 컬럼 그리드 카드. 각 카드 상단에 \`border-top: 2px solid var(--amore)\`.
4. **Persona / Segment** — 응답자 그룹 카드.
5. **Chapter I, II, III, ...** — 테마별. 각 챕터 안에 발견점 + Verbatim 인용 + 정량 신호(있으면 인라인 막대) + 시사점.
6. **Cross-Analysis (선택)** — 4-quadrant 또는 비교 테이블.
7. **Recommendations** — 실행 가능한 권장 액션 목록.
8. **Appendix** — 출처 파일 목록.

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

## Q→A→Verbatim 트리플 (정성 분석 시그니처)
좌측 1px var(--line) 보더로 묶인 블록 안에 Q (eyebrow 톤), A (본문), Verbatim 1줄 순서.

## Do
- ✓ 모든 챕터 위 UPPERCASE eyebrow + 24px 액센트 라인
- ✓ 카드 border 1px var(--line), radius 4px
- ✓ KPI 숫자는 42px 700 (Stat-Big)
- ✓ Verbatim은 italic + 화자 출처 명시
- ✓ 정성 인용을 풍부하게 (입력 자료에 그대로 존재하는 발화만)

## Don't
- ✗ 그림자, 그라디언트 배경, glassmorphism
- ✗ radius 4px 초과
- ✗ 빨강/초록/노랑 신호 컬러 차트
- ✗ 이모지·아이콘 폰트
- ✗ 4컬럼 이상 그리드
- ✗ 입력 자료에 없는 사실/숫자 만들어내기 — 추론은 "추정" 표시
- ✗ 본문 1500단어 미만 (충분히 길게)

한국어로 작성. 출력은 \`<!doctype html>\` HTML 한 개만.`;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { markdown, sources } = parsed.data;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  const anthropic = createAnthropic({ apiKey });

  const inputSummary = sources.length > 0 ? sources.join(', ') : '(normalized markdown)';

  // Stream the HTML directly to the client so the user sees the report
  // building in real time. Credit spend + DB write happen in onFinish so
  // an aborted stream doesn't charge the user — we only persist a fully
  // generated report.
  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system: SYSTEM,
    prompt: `다음은 1차 정리된 표준 양식 Markdown입니다. 이 내용을 그대로 보존하면서, 위 디자인 토큰과 구조 규칙을 따르는 단일 HTML 리포트를 작성하세요. Markdown의 섹션 헤더(\`# Cover\`, \`## Methodology\`, \`## Executive Summary\`, \`## Persona\`, \`## Chapter ...\`, \`## Recommendations\`, \`## Appendix\`)는 HTML 챕터 구조에 1:1로 매핑하세요.\n\n${markdown}`,
    temperature: 0.4,
    maxOutputTokens: 48000,
    onFinish: async ({ text }) => {
      let html = text.trim();
      if (html.startsWith('```')) {
        html = html.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '').trim();
      }
      if (!/<!doctype html|<html/i.test(html)) {
        html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>리포트</title></head><body>${html}</body></html>`;
      }
      try {
        const { data: gen, error: insertErr } = await supabase
          .from('generations')
          .insert({
            org_id: org.org_id,
            user_id: user.id,
            feature: 'reports',
            input: inputSummary,
            output: html,
            credits_spent: FEATURE_COSTS.reports,
          })
          .select('id')
          .single();
        if (insertErr || !gen) {
          console.error('[reports/generate] db insert failed', insertErr);
          return;
        }
        const spend = await spendCredits(org.org_id, 'reports', gen.id);
        if (!spend.ok) {
          await supabase.from('generations').delete().eq('id', gen.id);
          console.error('[reports/generate] credit spend failed', spend.reason);
        }
      } catch (e) {
        console.error('[reports/generate] onFinish error', e);
      }
    },
  });

  return result.toTextStreamResponse();
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import OpenAI from 'openai';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { spendCredits } from '@/lib/credits';
import { FEATURE_COSTS } from '@/lib/features';
import { crawlSource, dedupeArticles } from '@/lib/desk-crawl';
import type { DeskArticle, DeskSourceId } from '@/lib/desk-sources';

export const maxDuration = 300;

const SOURCE_IDS = ['google_news', 'hacker_news', 'reddit'] as const;

const Body = z.object({
  keyword: z.string().min(1).max(200),
  sources: z.array(z.enum(SOURCE_IDS)).min(1).max(SOURCE_IDS.length),
  locale: z.enum(['ko', 'en']).optional(),
});

const EXPAND_SYSTEM = `당신은 데스크 리서치를 위해 사용자가 입력한 키워드의 검색 적합 유사 키워드를 만드는 보조자입니다.
- 의미가 가깝거나 함께 검색되는 변형을 4개 제시합니다.
- 한국어 입력이면 한국어 위주, 영어 입력이면 영어 위주로 작성하되 통용되는 영문/한글 표기는 섞어도 됩니다.
- 결과는 콤마(,)로만 구분된 한 줄로 출력. 따옴표/번호/설명 금지.`;

const REPORT_SYSTEM = `당신은 데스크 리서치 보고서를 작성하는 전문 리서처입니다.
입력으로 키워드, 유사 키워드, 그리고 여러 출처에서 수집한 기사 헤드라인/요약 목록을 받습니다.
- 한국어 Markdown으로 작성합니다 (요청 언어가 영어인 경우 영어).
- 다음 섹션을 포함하세요:
  1. \`# 데스크 리서치 요약\` 표지 라인 (키워드 표기)
  2. \`## 핵심 요약 (TL;DR)\` — 5개 이내 불릿
  3. \`## 주요 흐름 / 트렌드\` — 패턴, 반복 등장 토픽, 상반된 시각
  4. \`## 출처별 관찰\` — google_news / hacker_news / reddit 별 한 단락씩, 각 출처에서 어떤 톤·관점이 나오는지
  5. \`## 주목할 기사\` — 가장 시그널이 강한 기사 5~8개, \`- [제목](URL) — 한 줄 요약 (출처·날짜)\` 형식
  6. \`## 한계 / 추가 조사 제안\` — 데이터 부족, 후속 리서치 아이디어
- 인용은 가능한 항상 링크로 연결. 사실을 임의로 추가하지 말고 제공된 자료에 근거.`;

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('missing_openai_key');
  return new OpenAI({ apiKey });
}

async function expandKeywords(openai: OpenAI, keyword: string): Promise<string[]> {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: EXPAND_SYSTEM },
        { role: 'user', content: keyword },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? '';
    return raw
      .split(/[,\n]/)
      .map((s) => s.trim().replace(/^["'`]+|["'`]+$/g, ''))
      .filter(Boolean)
      .filter((k) => k.toLowerCase() !== keyword.toLowerCase())
      .slice(0, 4);
  } catch (err) {
    console.error('[desk] expandKeywords failed', err);
    return [];
  }
}

function formatArticleListForLLM(articles: DeskArticle[]): string {
  return articles
    .map((a, i) => {
      const lines = [
        `${i + 1}. [${a.source}] ${a.title}`,
        `   url: ${a.url}`,
        a.origin ? `   origin: ${a.origin}` : '',
        a.publishedAt ? `   published: ${a.publishedAt}` : '',
        a.keyword ? `   matched_keyword: ${a.keyword}` : '',
        a.snippet ? `   snippet: ${a.snippet.slice(0, 280)}` : '',
      ].filter(Boolean);
      return lines.join('\n');
    })
    .join('\n\n');
}

async function summarize(
  openai: OpenAI,
  keyword: string,
  similar: string[],
  articles: DeskArticle[],
  locale: 'ko' | 'en',
): Promise<string> {
  const userMsg = [
    `요청 언어: ${locale === 'ko' ? '한국어' : 'English'}`,
    `메인 키워드: ${keyword}`,
    `유사 키워드: ${similar.length ? similar.join(', ') : '(없음)'}`,
    `수집 기사 수: ${articles.length}`,
    '',
    '--- 기사 목록 ---',
    formatArticleListForLLM(articles),
  ].join('\n');

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    messages: [
      { role: 'system', content: REPORT_SYSTEM },
      { role: 'user', content: userMsg },
    ],
  });
  return completion.choices[0]?.message?.content?.trim() ?? '';
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { keyword, sources, locale = 'ko' } = parsed.data;

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const openai = (() => {
    try {
      return getOpenAI();
    } catch {
      return null;
    }
  })();
  if (!openai) {
    return NextResponse.json({ error: 'missing_openai_key' }, { status: 500 });
  }

  // 1) Reserve a generation row + spend credits up front.
  const { data: generation, error: insertError } = await supabase
    .from('generations')
    .insert({
      org_id: org.org_id,
      user_id: user.id,
      feature: 'desk',
      input: JSON.stringify({ keyword, sources, locale }),
      output: null,
      credits_spent: FEATURE_COSTS.desk,
    })
    .select('id')
    .single();
  if (insertError || !generation) {
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  const spend = await spendCredits(org.org_id, 'desk', generation.id);
  if (!spend.ok) {
    await supabase.from('generations').delete().eq('id', generation.id);
    return NextResponse.json({ error: spend.reason }, { status: 402 });
  }

  // 2) Expand keywords via LLM.
  const similar = await expandKeywords(openai, keyword);
  const allKeywords = [keyword, ...similar];

  // 3) Crawl each (keyword × source) in parallel.
  const tasks: Promise<DeskArticle[]>[] = [];
  for (const kw of allKeywords) {
    for (const src of sources as DeskSourceId[]) {
      tasks.push(crawlSource(src, kw, locale));
    }
  }
  const settled = await Promise.allSettled(tasks);
  const collected: DeskArticle[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') collected.push(...r.value);
  }
  const articles = dedupeArticles(collected).slice(0, 60);

  if (articles.length === 0) {
    const output = `# 데스크 리서치 요약\n\n키워드 \`${keyword}\` 로 수집된 기사가 없습니다. 다른 키워드 또는 다른 소스를 선택해 보세요.`;
    await supabase.from('generations').update({ output }).eq('id', generation.id);
    return NextResponse.json({
      output,
      generation_id: generation.id,
      similar_keywords: similar,
      articles: [],
    });
  }

  // 4) LLM summary report.
  let output = '';
  try {
    output = await summarize(openai, keyword, similar, articles, locale);
  } catch (err) {
    console.error('[desk] summarize failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'summarize_failed' },
      { status: 502 },
    );
  }

  await supabase.from('generations').update({ output }).eq('id', generation.id);

  return NextResponse.json({
    output,
    generation_id: generation.id,
    similar_keywords: similar,
    articles,
  });
}

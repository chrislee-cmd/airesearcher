import { NextResponse } from 'next/server';
import { z } from 'zod';
import OpenAI from 'openai';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { spendCredits } from '@/lib/credits';
import { FEATURE_COSTS } from '@/lib/features';
import { crawlSource, dedupeArticles, sourceMissingKey } from '@/lib/desk-crawl';
import type { DeskDateRange } from '@/lib/desk-crawl';
import {
  DESK_SOURCES,
  type DeskArticle,
  type DeskSourceId,
} from '@/lib/desk-sources';

export const maxDuration = 300;

const SOURCE_IDS = [
  'naver_news',
  'naver_blog',
  'naver_cafe',
  'naver_kin',
  'kakao_web',
  'kakao_blog',
  'kakao_cafe',
  'youtube',
  'google_news',
  'hacker_news',
  'reddit',
] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const Body = z.object({
  keywords: z.array(z.string().min(1).max(120)).min(1).max(10),
  sources: z.array(z.enum(SOURCE_IDS)).min(1),
  locale: z.enum(['ko', 'en']).optional(),
  dateFrom: z.string().regex(ISO_DATE).optional(),
  dateTo: z.string().regex(ISO_DATE).optional(),
});

const EXPAND_SYSTEM = `당신은 데스크 리서치를 위해 사용자가 입력한 키워드의 검색 적합 유사 키워드를 만드는 보조자입니다.
- 의미가 가깝거나 함께 검색되는 변형을 4개 제시합니다.
- 한국어 입력이면 한국어 위주, 영어 입력이면 영어 위주로 작성하되 통용되는 영문/한글 표기는 섞어도 됩니다.
- 결과는 콤마(,)로만 구분된 한 줄로 출력. 따옴표/번호/설명 금지.`;

const REPORT_SYSTEM = `당신은 데스크 리서치 보고서를 작성하는 전문 리서처입니다.
입력으로 키워드, 유사 키워드, 그리고 여러 출처에서 수집한 기사/포스트/영상 헤드라인 + 요약 목록을 받습니다.
- 한국어 Markdown으로 작성합니다 (요청 언어가 영어인 경우 영어).
- 다음 섹션을 포함하세요:
  1. \`# 데스크 리서치 요약\` — 키워드를 표지에 표기
  2. \`## 핵심 요약 (TL;DR)\` — 5개 이내 불릿
  3. \`## 주요 흐름 / 트렌드\` — 반복 등장 토픽, 상반된 시각, 톤
  4. \`## 채널별 관찰\` — 네이버(뉴스/블로그/카페/지식인), 카카오·다음, 유튜브, 글로벌(구글뉴스/HN/Reddit) 중 데이터가 있는 채널만 한 단락씩
  5. \`## 주목할 항목\` — 시그널이 강한 6~10개, \`- [제목](URL) — 한 줄 요약 (출처·날짜)\` 형식
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
  keywords: string[],
  similar: string[],
  range: DeskDateRange,
  articles: DeskArticle[],
  locale: 'ko' | 'en',
): Promise<string> {
  const userMsg = [
    `요청 언어: ${locale === 'ko' ? '한국어' : 'English'}`,
    `메인 키워드: ${keywords.join(', ')}`,
    `유사 키워드: ${similar.length ? similar.join(', ') : '(없음)'}`,
    `수집 기간: ${range.from || range.to ? `${range.from ?? '전체'} ~ ${range.to ?? '오늘'}` : '제한 없음'}`,
    `수집 항목 수: ${articles.length}`,
    '',
    '--- 항목 목록 ---',
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

function sourceLabelKo(id: DeskSourceId): string {
  return DESK_SOURCES.find((s) => s.id === id)?.label ?? id;
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
  const { keywords, sources, locale = 'ko', dateFrom, dateTo } = parsed.data;
  const range: DeskDateRange = { from: dateFrom, to: dateTo };

  if (range.from && range.to && range.from > range.to) {
    return NextResponse.json({ error: 'invalid_date_range' }, { status: 400 });
  }

  const cleanKeywords = Array.from(
    new Set(keywords.map((k) => k.trim()).filter(Boolean)),
  ).slice(0, 10);
  if (cleanKeywords.length === 0) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

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

  const skipped: { source: DeskSourceId; missing: string }[] = [];
  const usable: DeskSourceId[] = [];
  for (const s of sources as DeskSourceId[]) {
    const missing = sourceMissingKey(s);
    if (missing) skipped.push({ source: s, missing });
    else usable.push(s);
  }
  if (usable.length === 0) {
    return NextResponse.json(
      { error: 'no_usable_sources', skipped },
      { status: 400 },
    );
  }

  const { data: generation, error: insertError } = await supabase
    .from('generations')
    .insert({
      org_id: org.org_id,
      user_id: user.id,
      feature: 'desk',
      input: JSON.stringify({ keywords: cleanKeywords, sources, locale, dateFrom, dateTo }),
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

  // ─── Streaming work loop ───────────────────────────────────────────────
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      const thought = (text: string) => send({ kind: 'thought', text });

      try {
        const kwLabel = cleanKeywords.map((k) => `‘${k}’`).join(', ');
        thought(
          `키워드 ${cleanKeywords.length}개를 받았어요${cleanKeywords.length > 1 ? ` (${kwLabel})` : ` — ${kwLabel}`}. 검색 준비할게요.`,
        );

        let similar: string[] = [];
        if (cleanKeywords.length === 1) {
          thought('한 키워드라 비슷한 표현도 같이 찾으면 더 풍부하겠어요. AI한테 4개 더 받아올게요…');
          similar = await expandKeywords(openai, cleanKeywords[0]);
          if (similar.length) {
            thought(`유사 키워드: ${similar.map((k) => `‘${k}’`).join(', ')} — 이 표현들도 함께 검색합니다.`);
          } else {
            thought('유사 키워드는 못 만들었어요. 입력 키워드만으로 갑니다.');
          }
        } else {
          thought('여러 키워드라 사용자가 직접 큐레이션한 걸로 보고, 유사 키워드 확장은 건너뜁니다.');
        }

        const allKeywords = [...cleanKeywords, ...similar];
        const totalTasks = allKeywords.length * usable.length;
        const sourceList = Array.from(new Set(usable.map(sourceLabelKo))).join(', ');
        thought(`이제 ${allKeywords.length}개 키워드 × ${usable.length}개 소스 = ${totalTasks}회 검색을 동시에 돌릴게요. (${sourceList})`);
        if (range.from || range.to) {
          thought(`기간은 ${range.from ?? '전체'} ~ ${range.to ?? '오늘'} 으로 좁혀서 봅니다.`);
        }

        // Fire all tasks. Each task emits a thought when it lands so the
        // panel feels alive — order is by completion, not start.
        const collected: DeskArticle[] = [];
        const tasks = allKeywords.flatMap((kw) =>
          usable.map((src) =>
            crawlSource(src, kw, locale, range).then(
              (items) => {
                thought(`${sourceLabelKo(src)} · ‘${kw}’ — ${items.length}건 가져왔어요.`);
                collected.push(...items);
              },
              (err) => {
                thought(`${sourceLabelKo(src)} · ‘${kw}’ — 실패했어요 (${err instanceof Error ? err.message : 'unknown'}).`);
              },
            ),
          ),
        );
        await Promise.all(tasks);

        const articles = dedupeArticles(collected).slice(0, 80);
        thought(`수집 끝났습니다. 중복 정리하고 ${articles.length}건으로 추렸어요.`);

        if (articles.length === 0) {
          const output = `# 데스크 리서치 요약\n\n키워드 \`${cleanKeywords.join(', ')}\` 로 수집된 항목이 없습니다. 키워드·기간·소스 조합을 바꿔 보세요.`;
          await supabase.from('generations').update({ output }).eq('id', generation.id);
          send({
            kind: 'final',
            data: {
              output,
              generation_id: generation.id,
              similar_keywords: similar,
              articles: [],
              skipped,
            },
          });
          controller.close();
          return;
        }

        thought('이제 GPT한테 한 편의 데스크 리서치 보고서로 묶어 달라고 요청할게요…');
        let output = '';
        try {
          output = await summarize(openai, cleanKeywords, similar, range, articles, locale);
        } catch (err) {
          console.error('[desk] summarize failed', err);
          send({
            kind: 'error',
            error: err instanceof Error ? err.message : 'summarize_failed',
          });
          controller.close();
          return;
        }

        await supabase.from('generations').update({ output }).eq('id', generation.id);
        thought('보고서 받았어요. 화면에 띄울게요.');

        send({
          kind: 'final',
          data: {
            output,
            generation_id: generation.id,
            similar_keywords: similar,
            articles,
            skipped,
          },
        });
        controller.close();
      } catch (err) {
        console.error('[desk] stream failed', err);
        send({
          kind: 'error',
          error: err instanceof Error ? err.message : 'stream_failed',
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}

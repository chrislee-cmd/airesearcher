import { NextResponse } from 'next/server';
import { z } from 'zod';
import { streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { spendCredits } from '@/lib/credits';
import { FEATURE_COSTS } from '@/lib/features';
import { REPORT_TYPES, DEFAULT_REPORT_TYPE } from '@/lib/reports/types';
import { getReportPrompts } from '@/lib/reports/prompts';

export const maxDuration = 800;

const MAX_MARKDOWN_CHARS = 200_000;

const Body = z.object({
  markdown: z.string().min(1).max(MAX_MARKDOWN_CHARS),
  sources: z.array(z.string()).max(50).default([]),
  // Report direction selected in the UI. The four types share the same
  // design tokens but produce structurally different reports (different
  // chapters, different signature visualizations). Default keeps the
  // pre-chooser behavior for any caller that omits the field.
  reportType: z.enum(REPORT_TYPES).default(DEFAULT_REPORT_TYPE),
});

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
  const { markdown, sources, reportType } = parsed.data;
  const prompts = getReportPrompts(reportType);

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
    system: prompts.GENERATE_SYSTEM,
    prompt: `다음은 1차 정리된 표준 양식 Markdown입니다(보고서 유형: ${reportType}). 이 내용을 그대로 보존하면서, 위 디자인 토큰과 이 유형의 챕터 구조 규칙을 따르는 단일 HTML 리포트를 작성하세요. Markdown 섹션 헤더는 HTML 챕터 구조에 1:1로 매핑하세요.\n\n${markdown}`,
    temperature: prompts.TEMPERATURE.generate,
    maxOutputTokens: 64000,
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

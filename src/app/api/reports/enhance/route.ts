import { NextResponse } from 'next/server';
import { z } from 'zod';
import { streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import {
  ContextPayload,
  renderContextForPrompt,
} from '@/lib/reports/context-payload';
import {
  enhanceSystemPrompt,
  enhanceUserPrompt,
} from '@/lib/reports/enhance-prompts';
import {
  REPORT_ENHANCE_COST,
  getVersion,
  nextVersionNumber,
} from '@/lib/reports/versions';

export const maxDuration = 800;

const Body = z.object({
  report_id: z.string().uuid(),
  parent_version: z.number().int().nonnegative(),
  payload: ContextPayload,
});

// Reuses the existing /api/reports/generate prompt indirectly: enhance
// returns markdown only, then we call generate-as-a-library to re-render
// HTML from that markdown. To avoid duplicating the long design-system
// system prompt we just POST to the local /api/reports/generate path.
async function renderHtmlFromMarkdown(
  origin: string,
  cookieHeader: string | null,
  markdown: string,
  sources: string[],
): Promise<string> {
  const res = await fetch(`${origin}/api/reports/generate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    body: JSON.stringify({ markdown, sources, skip_persist: true }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error ?? `render_failed_${res.status}`);
  }
  const text = await res.text();
  let html = text.trim();
  if (html.startsWith('```')) {
    html = html.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  if (!/<!doctype html|<html/i.test(html)) {
    html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>리포트</title></head><body>${html}</body></html>`;
  }
  return html;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', issues: parsed.error.flatten() }, { status: 400 });
  }
  const { report_id, parent_version, payload } = parsed.data;

  // Load parent version's markdown as the base. Without RLS access we'd
  // 404 here naturally.
  const parent = await getVersion(supabase, report_id, parent_version);
  if (!parent) {
    return NextResponse.json({ error: 'parent_not_found' }, { status: 404 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  const anthropic = createAnthropic({ apiKey });

  const system = enhanceSystemPrompt(payload.mode);
  const userPrompt = enhanceUserPrompt({
    mode: payload.mode,
    baseMarkdown: parent.markdown,
    contextBlock: renderContextForPrompt(payload),
  });

  // Stream the enhanced markdown to the client (chat-style preview).
  // After the model finishes we re-render HTML and persist a new row.
  // Credit spend happens after a successful insert so an aborted stream
  // never charges.
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const cookieHeader = request.headers.get('cookie');

  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system,
    prompt: userPrompt,
    temperature: 0.4,
    maxOutputTokens: 64000,
    onFinish: async ({ text }) => {
      let markdown = text.trim();
      if (markdown.startsWith('```')) {
        markdown = markdown
          .replace(/^```(?:markdown|md)?\s*/i, '')
          .replace(/```\s*$/i, '')
          .trim();
      }
      if (!markdown) {
        console.error('[reports/enhance] empty model output');
        return;
      }

      let html: string;
      try {
        html = await renderHtmlFromMarkdown(origin, cookieHeader, markdown, []);
      } catch (e) {
        console.error('[reports/enhance] html re-render failed', e);
        return;
      }

      try {
        const version = await nextVersionNumber(supabase, report_id);
        const { data: inserted, error: insertErr } = await supabase
          .from('report_versions')
          .insert({
            report_id,
            version,
            parent_version,
            enhancement: payload.mode,
            markdown,
            html,
            context_payload: payload,
            credits_spent: REPORT_ENHANCE_COST,
            created_by: user.id,
          })
          .select('id')
          .single();
        if (insertErr || !inserted) {
          console.error('[reports/enhance] insert failed', insertErr);
          return;
        }

        // Move the head pointer + materialize latest on report_jobs so
        // legacy readers keep seeing the latest content.
        await supabase
          .from('report_jobs')
          .update({ markdown, html, head_version: version })
          .eq('id', report_id);

        const { data: spent, error: spendErr } = await supabase.rpc(
          'spend_credits',
          {
            p_org_id: org.org_id,
            p_amount: REPORT_ENHANCE_COST,
            p_feature: 'reports_enhance',
            p_generation_id: null,
          },
        );
        if (spendErr || !spent) {
          console.error('[reports/enhance] credit spend failed', spendErr ?? 'insufficient');
        }
      } catch (e) {
        console.error('[reports/enhance] onFinish error', e);
      }
    },
  });

  return result.toTextStreamResponse();
}

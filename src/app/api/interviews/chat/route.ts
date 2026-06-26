import { NextResponse } from 'next/server';
import { z } from 'zod';
import { streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { ZERO_RETENTION } from '@/lib/llm/config';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { checkLlmRateLimit } from '@/lib/rate-limit';
import {
  searchChunks,
  hitToCitation,
  type ChatCitation,
  type InterviewSearchHit,
} from '@/lib/interview-search';

// PR-2 — interview corpus chat.
//
// POST: stream a Claude Sonnet answer grounded in the top-K cosine-
// nearest interview chunks for `interview_job_id`. The full conversation
// (UI-side state) rides along in the request body so this handler is
// stateless wrt history. Both the question and the streamed reply are
// persisted to interview_chat_messages so a refresh / cross-device
// revisit can restore the thread via the GET handler.
//
// GET: load conversation rows for `?job_id=`. Pure read — RLS on
// interview_chat_messages does the gating.

export const maxDuration = 120;

// Retrieval K — 12 chunks × ~500 tokens = ~6k tokens of evidence, well
// inside Sonnet's context once you add the conversation tail.
const TOP_K = 12;

// Cosine similarity threshold below which a hit is treated as "the
// corpus didn't really have this". Anything weaker is dropped from the
// evidence block so the model doesn't anchor on noise — and the system
// prompt then tells it to say "코퍼스에서 찾을 수 없음".
const MIN_SIMILARITY = 0.2;

const Message = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(20_000),
});

const PostBody = z.object({
  interview_job_id: z.string().uuid(),
  // Full conversation including the message the user just submitted.
  // The last entry MUST be a fresh user turn — the handler treats its
  // content as the retrieval query.
  conversation: z.array(Message).min(1).max(100),
});

const INTERVIEW_CHAT_SYSTEM = `당신은 인터뷰 코퍼스 분석가입니다. 사용자의 질문에 대해 아래 "근거 청크"만을 사실 근거로 사용해 한국어로 답하세요.

규칙:
- 항상 한국어로 답합니다.
- 사실 진술은 반드시 청크에서 가져옵니다. 청크에 없는 내용은 추측하지 말고 "코퍼스에서 찾을 수 없음" 으로 명시하세요.
- 답변 본문 안에서 인용할 때는 [N] (예: [1], [3]) 형태로 청크 번호를 붙입니다.
- 답변 마지막에 반드시 "**근거**" 섹션을 추가합니다. 형식:
  **근거**
  - [1] filename § heading_path
  - [2] filename § heading_path
- heading_path 는 청크 메타데이터의 heading 경로를 " > " 로 이어 표시합니다 (없으면 "(루트)").
- 인용하지 않은 청크는 근거 섹션에서 빼세요. 한 청크를 여러 번 인용해도 근거 목록에는 한 번만 적습니다.
- 간결한 표·불릿이 도움이 되면 사용하되, 사실 없이 형식만 채우지 마세요.`;

function formatEvidence(hits: InterviewSearchHit[]): string {
  if (hits.length === 0) {
    return '(검색된 청크 없음 — 답변 본문에서 "코퍼스에서 찾을 수 없음" 을 명시하세요.)';
  }
  return hits
    .map((h, i) => {
      const heading =
        h.heading_path.length > 0 ? h.heading_path.join(' > ') : '(루트)';
      const tag = h.is_quote ? '인용' : '본문';
      return (
        `[${i + 1}] ${h.filename} § ${heading} · ${tag} · sim=${h.similarity.toFixed(3)}\n` +
        '```\n' +
        h.content +
        '\n```'
      );
    })
    .join('\n\n');
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const org = await getActiveOrg();
  if (!org?.org_id) {
    return NextResponse.json({ error: 'no_org' }, { status: 403 });
  }

  const limited = await checkLlmRateLimit(user.id, org.org_id);
  if (limited) return limited;

  const parsed = PostBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { interview_job_id, conversation } = parsed.data;

  const last = conversation[conversation.length - 1];
  if (last.role !== 'user') {
    return NextResponse.json(
      { error: 'last_message_must_be_user' },
      { status: 400 },
    );
  }

  // Verify the job belongs to the requester's org before doing any
  // retrieval work. RLS would also block downstream reads, but a clean
  // 404 is a friendlier signal than empty hits.
  const { data: jobRow, error: jobErr } = await supabase
    .from('interview_jobs')
    .select('id, org_id, index_status')
    .eq('id', interview_job_id)
    .eq('org_id', org.org_id)
    .maybeSingle();
  if (jobErr || !jobRow) {
    return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  }
  if (jobRow.index_status !== 'done') {
    return NextResponse.json(
      { error: 'not_indexed', status: jobRow.index_status },
      { status: 409 },
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  }

  // Admin client for the heavy reads (RPC retrieval + chunk insert).
  // Authorization already happened above.
  const admin = createAdminClient();

  let hits: InterviewSearchHit[] = [];
  try {
    const raw = await searchChunks({
      client: admin,
      jobId: interview_job_id,
      query: last.content,
      k: TOP_K,
    });
    hits = raw.filter((h) => h.similarity >= MIN_SIMILARITY);
  } catch (e) {
    console.error('[interviews/chat] search failed', e);
    return NextResponse.json({ error: 'search_failed' }, { status: 500 });
  }

  const citations: ChatCitation[] = hits.map(hitToCitation);
  const evidenceBlock = formatEvidence(hits);

  // Persist the user turn before streaming starts. If the streaming call
  // dies mid-response, at least the question survives so the user can
  // see what they asked and retry. The assistant row lands in onFinish.
  await admin.from('interview_chat_messages').insert({
    org_id: org.org_id,
    interview_job_id,
    user_id: user.id,
    role: 'user',
    content: last.content,
    citations: null,
  });

  const anthropic = createAnthropic({ apiKey });
  const systemPrompt = `${INTERVIEW_CHAT_SYSTEM}\n\n## 근거 청크\n${evidenceBlock}`;

  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system: systemPrompt,
    messages: conversation.map((m) => ({ role: m.role, content: m.content })),
    temperature: 0.2,
    maxOutputTokens: 4096,
    providerOptions: ZERO_RETENTION,
    onFinish: async ({ text }) => {
      try {
        await admin.from('interview_chat_messages').insert({
          org_id: org.org_id,
          interview_job_id,
          user_id: user.id,
          role: 'assistant',
          content: text,
          citations,
        });
      } catch (e) {
        console.error('[interviews/chat] persist assistant failed', e);
      }
    },
  });

  const response = result.toTextStreamResponse();
  // Ship citations in a header so the UI can render the source list
  // immediately, before the stream finishes. URI-encode to keep header
  // bytes safe across proxies.
  response.headers.set(
    'x-citations',
    encodeURIComponent(JSON.stringify(citations)),
  );
  return response;
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const org = await getActiveOrg();
  if (!org?.org_id) {
    return NextResponse.json({ error: 'no_org' }, { status: 403 });
  }

  const url = new URL(req.url);
  const jobId = url.searchParams.get('job_id');
  if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) {
    return NextResponse.json({ error: 'invalid_job_id' }, { status: 400 });
  }

  // Existence check — keeps the response shape predictable (404 vs
  // empty list) and avoids leaking job-existence through the RLS-empty
  // case.
  const { data: jobRow, error: jobErr } = await supabase
    .from('interview_jobs')
    .select('id')
    .eq('id', jobId)
    .eq('org_id', org.org_id)
    .maybeSingle();
  if (jobErr || !jobRow) {
    return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  }

  const { data: rows, error } = await supabase
    .from('interview_chat_messages')
    .select('id, role, content, citations, created_at')
    .eq('interview_job_id', jobId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) {
    console.error('[interviews/chat] history fetch failed', error);
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
  }

  return NextResponse.json({ messages: rows ?? [] });
}

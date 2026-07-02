import { NextResponse } from 'next/server';
import { z } from 'zod';
import { streamObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { env } from '@/env';
import { ZERO_RETENTION } from '@/lib/llm/config';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { checkLlmRateLimit } from '@/lib/rate-limit';
import { sanitizeUserInput } from '@/lib/llm/sanitize';
import {
  searchInterviewV2Chunks,
  type InterviewV2Hit,
} from '@/lib/interview-v2/pgvector-query';
import {
  SEARCH_SYSTEM,
  NO_ANSWER_MD,
  searchAnswerSchema,
  formatEvidence,
} from '@/lib/interview-v2/search-prompt';
import type { Citation } from '@/lib/interview-v2/types';

// Interview V2 search — retrieval-grounded, streamed markdown + citations.
//
// POST: embed the question, pull the top-K cosine-nearest interview_chunks
// across a project (or cross-project when project_id is omitted) already
// filtered by the similarity floor, inject them as evidence, and stream a
// Sonnet answer with inline [chunk_id] citations via streamObject. On
// finish the question + authoritative citations are logged to
// interview_search_queries (audit).
//
// Hallucination guard is layered: (1) retrieval-first system prompt,
// (2) score_threshold drops weak chunks server-side (in the RPC), (3) the
// streamObject schema forces a citations array, (4) empty evidence
// short-circuits to a no_answer response, (5) onFinish rebuilds the
// persisted citations from the retrieved chunk set, dropping any
// chunk_id the model invented.
//
// Scope note (spec vs schema): the spec's example SQL filters by
// documents.user_id, but interview_documents/interview_chunks carry no
// user_id — they are org-scoped with has_org_role RLS. Every other
// interview route scopes by getActiveOrg()→org_id, so this route does the
// same; org_id is the isolation boundary. project_id is an optional
// documents.project_id narrowing (left-joined to interview_projects for
// the display name).

export const maxDuration = 120;

const Body = z.object({
  question: z.string().trim().min(1).max(2_000),
  // Deprecated single-project scope, kept for backward compat. Newer clients
  // send project_ids (multi-select). When both are present project_ids wins.
  project_id: z.string().uuid().optional(),
  // Multi-select cross-project scope. undefined/null ⇒ fall back to
  // project_id; [] ⇒ all projects (whole-org); [id...] ⇒ that set.
  project_ids: z.array(z.string().uuid()).max(100).optional().nullable(),
  top_k: z.number().int().min(1).max(50).optional().default(12),
  score_threshold: z.number().min(0).max(1).optional().default(0.7),
});

// Build the authoritative Citation[] from the model's cited chunk_ids,
// keeping only ids that were actually retrieved (layer 5) and sourcing
// document_id/filename/project_name/score from the retrieval result
// rather than trusting the model to echo them faithfully.
function reconstructCitations(
  modelCitations: Array<{ chunk_id?: string; excerpt?: string }> | undefined,
  hits: InterviewV2Hit[],
): Citation[] {
  const byId = new Map(hits.map((h) => [String(h.chunk_id), h]));
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of modelCitations ?? []) {
    const id = String(c?.chunk_id ?? '').trim();
    const hit = byId.get(id);
    if (!hit || seen.has(id)) continue;
    seen.add(id);
    const excerpt =
      typeof c?.excerpt === 'string' && c.excerpt.trim()
        ? c.excerpt.trim().slice(0, 2_000)
        : hit.content.slice(0, 2_000);
    out.push({
      chunk_id: id,
      document_id: hit.document_id,
      filename: hit.filename,
      project_name: hit.project_name ?? undefined,
      excerpt,
      score: hit.score,
    });
  }
  return out;
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

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { question, project_id, project_ids, top_k, score_threshold } =
    parsed.data;

  // project_ids present (not undefined/null) ⇒ multi-project cross-search.
  // The audit row's single project_id column can't represent a set, so it's
  // stored null in that mode (matches the cross-project semantics).
  const useMultiProject = project_ids !== undefined && project_ids !== null;
  const auditProjectId = useMultiProject ? null : project_id ?? null;

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  }

  // Retrieval via the admin client (RLS bypassed for perf); the RPC's
  // org_id predicate is the isolation boundary — same pattern as the chat
  // route. Authorization already happened above.
  const admin = createAdminClient();

  let hits: InterviewV2Hit[] = [];
  try {
    hits = await searchInterviewV2Chunks({
      client: admin,
      orgId: org.org_id,
      projectId: project_id ?? null,
      // undefined ⇒ lib stays on the single-project path; null/[]/[id...] ⇒
      // lib switches to the _multi RPC.
      projectIds: useMultiProject ? project_ids : undefined,
      query: question,
      k: top_k,
      scoreThreshold: score_threshold,
    });
  } catch (e) {
    console.error('[interviews/v2/search] retrieval failed', e);
    return NextResponse.json({ error: 'search_failed' }, { status: 500 });
  }

  // Candidate sources for the UI to render a source list immediately,
  // before the stream resolves which chunks the answer actually cited.
  const candidates: Citation[] = hits.map((h) => ({
    chunk_id: String(h.chunk_id),
    document_id: h.document_id,
    filename: h.filename,
    project_name: h.project_name ?? undefined,
    excerpt: h.content.slice(0, 2_000),
    score: h.score,
  }));
  const citationsHeader = encodeURIComponent(JSON.stringify(candidates));

  // Layer 4 — no evidence above threshold ⇒ no_answer without burning a
  // model call. Same JSON shape as the streamed path so the client parses
  // both uniformly.
  if (hits.length === 0) {
    await admin
      .from('interview_search_queries')
      .insert({
        org_id: org.org_id,
        user_id: user.id,
        project_id: auditProjectId,
        question,
        answer_md: NO_ANSWER_MD,
        citations: [],
      })
      .then(
        () => {},
        (e) => console.error('[interviews/v2/search] audit insert failed', e),
      );
    return new Response(
      JSON.stringify({ answer_md: NO_ANSWER_MD, citations: [], no_answer: true }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-citations': citationsHeader,
        },
      },
    );
  }

  // Injection detect + wrap the question (evidence lives in the system
  // prompt; the question is untrusted user input so it's wrapped and any
  // injection pattern is logged — not blocked, to avoid search UX regressions).
  const questionSan = await sanitizeUserInput(question, 'search_question', {
    endpoint: '/api/interviews/v2/search',
    user_id: user.id,
    org_id: org.org_id,
    actor_email: user.email ?? null,
    input_length: question.length,
    input_label: 'search_question',
  });

  const anthropic = createAnthropic({ apiKey });
  const systemPrompt = `${SEARCH_SYSTEM}\n\n## 근거 청크\n${formatEvidence(hits)}`;

  const result = streamObject({
    model: anthropic('claude-sonnet-4-6'),
    schema: searchAnswerSchema,
    system: systemPrompt,
    prompt: `## 질문\n${questionSan.wrapped}\n\n위 근거 청크만 사용해 질문에 답하세요.`,
    temperature: 0.1,
    providerOptions: ZERO_RETENTION,
    onFinish: async ({ object }) => {
      try {
        const citations = reconstructCitations(object?.citations, hits);
        await admin.from('interview_search_queries').insert({
          org_id: org.org_id,
          user_id: user.id,
          project_id: auditProjectId,
          question,
          answer_md: object?.answer_md ?? '',
          citations,
        });
      } catch (e) {
        console.error('[interviews/v2/search] audit insert failed', e);
      }
    },
  });

  const response = result.toTextStreamResponse();
  response.headers.set('x-citations', citationsHeader);
  return response;
}

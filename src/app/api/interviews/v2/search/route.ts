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
import { type InterviewV2Hit } from '@/lib/interview-v2/pgvector-query';
import {
  hybridSearch,
  type HybridScope,
} from '@/lib/interview-v2/hybrid-search';
import {
  SEARCH_SYSTEM,
  NO_ANSWER_MD,
  searchAnswerSchema,
  formatEvidence,
  type SearchAnswer,
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
  // Single-document scope (file-detail search). When present, retrieval is
  // narrowed to this one interview document — supersedes any project scope
  // (a file always lives in a single project). Wins over project_ids.
  document_id: z.string().uuid().optional(),
  top_k: z.number().int().min(1).max(50).optional().default(12),
  // Was 0.7, which returned zero chunks despite a 200 (prod incident
  // 2026-07-03). Measured against real prod data the cosine scores top out
  // at ~0.31 and cluster in 0.20–0.31 for EVERY query — the interview corpus
  // is English text embedded with text-embedding-3-small while questions are
  // Korean, so cross-lingual similarity is structurally low and the score
  // barely separates relevant from irrelevant. 0.4 (and even 0.3) still
  // returned nothing; 0.2 is the floor that reliably surfaces on-topic
  // chunks while dropping the clearly-orthogonal tail (~0.19). Relevance is
  // then gated by the retrieval-first prompt's no_answer path, not this
  // threshold. Tune off the [v2/search] chunks_count logs.
  score_threshold: z.number().min(0).max(1).optional().default(0.2),
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

// Server-side re-verify of the model's structured artifacts (decision #4 —
// aggregation accuracy). Every value must be grounded in the retrieved chunk
// set; ungrounded rows/quotes are dropped (fail-tolerant — the text answer is
// unaffected). The verified set + created/dropped counts are logged so the
// artifact grounding rate is observable from the Function logs.
//
// Note: InterviewV2Hit carries no respondent_id, so a table's respondent_ids
// are grounded against the retrieved chunk_id/document_id set (the closest
// available key). interview_search_queries has no artifacts column, so this
// pass validates + logs rather than persisting a verified copy.
type RawArtifact = NonNullable<SearchAnswer['artifacts']>[number];

function verifyArtifacts(
  artifacts: RawArtifact[] | undefined,
  hits: InterviewV2Hit[],
): { verified: RawArtifact[]; created: number; dropped: number } {
  const raw = artifacts ?? [];
  const chunkIds = new Set(hits.map((h) => String(h.chunk_id)));
  const docIds = new Set(hits.map((h) => h.document_id));
  const norm = (s: string) => s.replace(/\s/g, '');
  const verified: RawArtifact[] = [];
  for (const a of raw) {
    if (a.type === 'table') {
      const validIds = a.respondent_ids.filter(
        (id) => chunkIds.has(id) || docIds.has(id),
      );
      // <3 grounded rows ⇒ not a real "3+ respondent" table — drop it.
      if (validIds.length < 3) continue;
      verified.push(a);
    } else if (a.type === 'quote_list') {
      const validQuotes = a.quotes.filter((q) => {
        if (!q.quote.trim()) return false;
        const hit = hits.find((h) => String(h.chunk_id) === q.chunk_id);
        if (!hit) return false;
        // Fuzzy substring — the quote's leading ~50 chars must appear in the
        // cited chunk (whitespace-insensitive), so paraphrased/invented
        // quotes drop while faithful excerpts survive minor spacing drift.
        return norm(hit.content).includes(norm(q.quote).slice(0, 50));
      });
      if (validQuotes.length < 3) continue;
      verified.push({ ...a, quotes: validQuotes });
    } else if (a.type === 'chart') {
      // Re-verify each series against the retrieved chunk set: keep only
      // grounded respondent_ids and recompute count from them (the model's
      // count is a hint, not authority). Drop empty series, then drop the
      // whole chart if fewer than 3 categories survive (text is enough).
      let totalDropped = 0;
      const verifiedSeries = a.series
        .map((s) => {
          const validIds = s.respondent_ids.filter(
            (id) => chunkIds.has(id) || docIds.has(id),
          );
          totalDropped += s.count - validIds.length;
          return { ...s, respondent_ids: validIds, count: validIds.length };
        })
        .filter((s) => s.count > 0);
      console.info('[v2/search] chart_reverify', {
        title: a.title,
        dropped: totalDropped,
        series_kept: verifiedSeries.length,
      });
      if (verifiedSeries.length < 3) continue;
      verified.push({ ...a, series: verifiedSeries });
    }
  }
  return {
    verified,
    created: raw.length,
    dropped: raw.length - verified.length,
  };
}

// Expand a whole-org cross-project search (project_ids: []) into the concrete
// set of the requester's project ids, so the per-project top-K loop below has
// real targets. interview_projects carries user_id (unlike the org-scoped
// documents), so scope by org + user — matching the "own project rw" RLS.
async function getAllUserProjects(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  userId: string,
): Promise<string[]> {
  const { data, error } = await admin
    .from('interview_projects')
    .select('id')
    .eq('org_id', orgId)
    .eq('user_id', userId);
  if (error) throw new Error(`getAllUserProjects: ${error.message}`);
  return (data ?? []).map((r) => r.id as string);
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
  const { question, project_id, project_ids, top_k, score_threshold, document_id } =
    parsed.data;

  // A document_id (file-detail search) forces single-document scope regardless
  // of any project_ids — a file lives in exactly one project, so the narrower
  // scope wins. project_ids present (not undefined/null) ⇒ multi-project
  // cross-search. The audit row's single project_id column can't represent a
  // set, so it's stored null in that mode (matches the cross-project semantics).
  const useMultiProject =
    !document_id && project_ids !== undefined && project_ids !== null;
  const auditProjectId = useMultiProject ? null : project_id ?? null;

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  }

  // Retrieval via the admin client (RLS bypassed for perf); the RPC's
  // org_id predicate is the isolation boundary — same pattern as the chat
  // route. Authorization already happened above.
  const admin = createAdminClient();

  // Hybrid retrieval (spec C — decisions 1–3): vector ⊕ keyword fused with RRF
  // (recovers exact tokens the cosine path misses), a per-document coverage
  // floor (respondent diversity), then small-to-big parent expansion (the LLM
  // sees whole Q&A pairs, not mid-answer fragments). All three live in
  // hybridSearch; the route resolves the retrieval scope and forwards it.
  //
  // Scope resolution preserves the prod-incident-2026-07-03 anti-pollution
  // rule: a concrete multi-project selection loops per project rather than one
  // flat top-K across all of them (which let an unrelated project outrank the
  // on-topic chunks). single/whole-org paths are already narrow.
  let scope: HybridScope;
  let strategy: string;
  let projectsScanned: number;
  if (useMultiProject) {
    const targetIds =
      project_ids && project_ids.length > 0
        ? project_ids
        : await getAllUserProjects(admin, org.org_id, user.id).catch((e) => {
            console.error('[interviews/v2/search] getAllUserProjects failed', e);
            return [] as string[];
          });
    if (targetIds.length === 0) {
      // No explicit selection and no projects (or only legacy null-project
      // docs) — whole-org _multi so those legacy docs stay searchable.
      scope = { kind: 'whole_org_multi' };
      strategy = 'multi_whole_org_fallback';
      projectsScanned = 0;
    } else {
      scope = { kind: 'per_project', projectIds: targetIds };
      strategy = 'per_project_loop';
      projectsScanned = targetIds.length;
    }
  } else {
    scope = {
      kind: 'single',
      projectId: project_id ?? null,
      documentId: document_id ?? null,
    };
    strategy = document_id ? 'single_document' : 'single';
    projectsScanned = 1;
  }

  let hits: InterviewV2Hit[] = [];
  let hybridDebug: Record<string, number> = {};
  try {
    const res = await hybridSearch({
      admin,
      orgId: org.org_id,
      scope,
      query: question,
      topK: top_k,
      scoreThreshold: score_threshold,
    });
    // Parent-expanded evidence is what the model reads (small-to-big).
    hits = res.parents;
    hybridDebug = res.debug;
  } catch (e) {
    console.error('[interviews/v2/search] retrieval failed', e);
    return NextResponse.json({ error: 'search_failed' }, { status: 500 });
  }

  // Debug — retrieval strategy, projects scanned, effective threshold, and the
  // hybrid stage counts (vector/keyword/fused/floored/parents), so an
  // empty-citations report can be diagnosed straight from the Function logs and
  // the fusion/floor tuned off real traffic.
  console.log('[v2/search]', {
    strategy,
    projects_scanned: projectsScanned,
    threshold: score_threshold,
    top_k,
    project_id: project_id ?? null,
    project_ids: project_ids ?? null,
    document_id: document_id ?? null,
    chunks_count: hits.length,
    ...hybridDebug,
    question_preview: question.slice(0, 40),
  });

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
        // Server re-verify artifacts (validation + observability). The streamed
        // client copy is the model's retrieval-grounded output; this logs the
        // grounding pass rate so artifact quality is measurable over real
        // traffic (spec verification bullet).
        const { verified, created, dropped } = verifyArtifacts(
          object?.artifacts,
          hits,
        );
        console.log('[v2/search] artifacts', {
          artifacts_created: created,
          artifacts_dropped: dropped,
          artifacts_verified: verified.length,
        });
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

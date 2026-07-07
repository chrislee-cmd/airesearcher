// 4 메트릭 실행기 — Recall@K / Coverage / Faithfulness / Citation.
//
// 순수 평가: v2/search retrieval(pgvector-query)을 **호출만** 하고 어떤
// 프로덕션 경로도 수정하지 않는다. Faithfulness/Citation 은 검색 결과로 하네스
// 내부에서 작은 RAG 답변을 만든 뒤 LLM 판사(Sonnet)로 채점한다 — 현재
// 검색+답변 품질의 baseline 을 잡고, B(map-reduce) 머지 후 재측정해 개선을
// 수치로 비교하는 게 목적.
//
// 재현성: 표본은 결정적(generate-gold.sampleChunks), 질문 생성/판사는 낮은
// temperature 로 범위를 좁힌다. 완전 결정적은 아니므로 delta 는 "범위"로 읽는다.

import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { env } from '@/env';
import { ZERO_RETENTION } from '@/lib/llm/config';
import { searchInterviewV2Chunks } from '@/lib/interview-v2/pgvector-query';
import type { createAdminClient } from '@/lib/supabase/admin';
import {
  EVAL_MODEL,
  DEFAULT_SAMPLE_SIZE,
  MAX_SAMPLE_SIZE,
  sampleChunks,
  generateGoldSet,
} from './generate-gold';
import type {
  EvalResult,
  EvalMetrics,
  RecallMetric,
  CoverageMetric,
  FaithfulnessMetric,
  CitationMetric,
  GoldQuestion,
} from './types';

type AdminClient = ReturnType<typeof createAdminClient>;

// 집계형(전수 종합) 질문 템플릿 — Coverage 는 이들 검색 결과가 커버하는 고유
// 문서 비율. top-K RAG 는 일부만 커버(낮음)하고 map-reduce(B)는 전수(높음).
const AGGREGATE_QUERIES = [
  '전체 응답자들이 공통적으로 언급한 불편함이나 문제점은 무엇인가?',
  '사용 빈도나 이용 패턴에 대해 응답자들이 보인 종합적인 경향은?',
  '응답자들이 가장 자주 요구하거나 기대한 니즈는 무엇인가?',
];

// Coverage 검색은 RAG 에 공정한 기회를 주기 위해 넓게 가져온다(=top-K RAG 의
// 상한 커버리지). 그래도 전수에 못 미치는 게 정상 — 그게 B 로 개선될 여지.
const COVERAGE_K = 30;

const answerSchema = z.object({
  // 각 claim = 답변의 원자적 주장 + 그것을 뒷받침하는 인용 chunk_id 들.
  claims: z.array(
    z.object({
      text: z.string(),
      citations: z.array(z.number()),
    }),
  ),
});

const judgeSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number(),
      supported: z.boolean(),
    }),
  ),
});

/** 프로젝트 전체 chunk id 집합 — Citation 실재 검증용(가볍게 id 만). */
async function projectChunkIdSet(
  admin: AdminClient,
  orgId: string,
  projectId: string,
): Promise<Set<number>> {
  const { data: docs, error: docErr } = await admin
    .from('interview_documents')
    .select('id')
    .eq('org_id', orgId)
    .eq('project_id', projectId);
  if (docErr) throw new Error(`projectChunkIdSet docs: ${docErr.message}`);
  const docIds = (docs ?? []).map((d) => d.id);
  if (docIds.length === 0) return new Set();
  const { data: rows, error } = await admin
    .from('interview_chunks')
    .select('id')
    .eq('org_id', orgId)
    .in('document_id', docIds);
  if (error) throw new Error(`projectChunkIdSet chunks: ${error.message}`);
  return new Set((rows ?? []).map((r) => Number(r.id)));
}

/**
 * 1. Recall@K — self-consistency. 각 gold 질문으로 검색 → 원본 청크가 top-K
 *    에 되돌아오면 hit. recall = hits/sampled, mrr = 평균 역순위.
 */
export async function runRecall(
  admin: AdminClient,
  orgId: string,
  projectId: string,
  gold: GoldQuestion[],
  k: number,
): Promise<RecallMetric | null> {
  if (gold.length === 0) return null;
  let hits = 0;
  let reciprocalSum = 0;
  for (const g of gold) {
    const results = await searchInterviewV2Chunks({
      client: admin,
      orgId,
      projectId,
      query: g.question,
      k,
      // 평가는 순위 그대로 봐야 하므로 similarity floor 를 낮춰 top-K 를 채운다.
      scoreThreshold: 0,
    });
    const rank = results.findIndex((r) => r.chunk_id === g.chunk_id);
    if (rank >= 0) {
      hits += 1;
      reciprocalSum += 1 / (rank + 1);
    }
  }
  return {
    k,
    sampled: gold.length,
    hits,
    recall_at_k: hits / gold.length,
    mrr: reciprocalSum / gold.length,
  };
}

/**
 * 2. Coverage — 집계형 질문 검색 결과가 커버하는 고유 문서 비율.
 */
export async function runCoverage(
  admin: AdminClient,
  orgId: string,
  projectId: string,
  totalDocs: number,
): Promise<CoverageMetric | null> {
  if (totalDocs === 0) return null;
  const covered = new Set<string>();
  for (const q of AGGREGATE_QUERIES) {
    const results = await searchInterviewV2Chunks({
      client: admin,
      orgId,
      projectId,
      query: q,
      k: COVERAGE_K,
      scoreThreshold: 0,
    });
    for (const r of results) covered.add(r.document_id);
  }
  return {
    queries: AGGREGATE_QUERIES.length,
    total_docs: totalDocs,
    cited_docs: covered.size,
    coverage: covered.size / totalDocs,
  };
}

/**
 * 3 + 4. Faithfulness + Citation — 하나의 집계형 질문에 대해 검색 top-K 로
 * 작은 RAG 답변을 만들고(claim + citations), 판사가 claim 지지 여부를,
 * 그리고 인용 chunk_id 실재 여부를 채점한다. 비용 통제를 위해 질문 1개만.
 */
export async function runFaithfulnessAndCitation(
  admin: AdminClient,
  orgId: string,
  projectId: string,
  k: number,
  validChunkIds: Set<number>,
): Promise<{ faithfulness: FaithfulnessMetric | null; citation: CitationMetric | null }> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('missing_anthropic_key');
  const anthropic = createAnthropic({ apiKey });

  const question = AGGREGATE_QUERIES[0];
  const hits = await searchInterviewV2Chunks({
    client: admin,
    orgId,
    projectId,
    query: question,
    k,
    scoreThreshold: 0,
  });
  if (hits.length === 0) return { faithfulness: null, citation: null };

  const evidence = hits
    .map((h) => `[chunk_id: ${h.chunk_id}]\n${h.content.slice(0, 1500)}`)
    .join('\n\n');

  // (a) 답변 생성 — claim 마다 근거 chunk_id 를 달게 한다(제공 청크에서만).
  let answer: z.infer<typeof answerSchema>;
  try {
    const { object } = await generateObject({
      model: anthropic(EVAL_MODEL),
      schema: answerSchema,
      system:
        '너는 인터뷰 코퍼스 위에서 동작하는 RAG 답변기다. 아래 근거 청크만 근거로 질문에 답한다. 답을 원자적 claim 여러 개로 나누고, 각 claim 뒤에 그것을 뒷받침하는 chunk_id 를 근거로 단다(제공된 chunk_id 중에서만).',
      prompt: `## 질문\n${question}\n\n## 근거 청크\n${evidence}`,
      temperature: 0.2,
      maxRetries: 1,
      providerOptions: ZERO_RETENTION,
    });
    answer = object;
  } catch (e) {
    console.warn('[rag-eval] answer gen failed', e);
    return { faithfulness: null, citation: null };
  }

  const claims = answer.claims ?? [];
  if (claims.length === 0) return { faithfulness: null, citation: null };

  // (b) Citation Validity — 인용 chunk_id 가 코퍼스에 실재하는가.
  let citationTotal = 0;
  let citationValid = 0;
  for (const c of claims) {
    for (const cid of c.citations ?? []) {
      citationTotal += 1;
      if (validChunkIds.has(Number(cid))) citationValid += 1;
    }
  }
  const citation: CitationMetric | null =
    citationTotal === 0
      ? null
      : { citations: citationTotal, valid: citationValid, validity: citationValid / citationTotal };

  // (c) Faithfulness — 판사가 각 claim 이 그 인용 청크로 뒷받침되는지 판정.
  const contentById = new Map(hits.map((h) => [h.chunk_id, h.content]));
  const judgeInput = claims
    .map((c, i) => {
      const cited = (c.citations ?? [])
        .map((cid) => contentById.get(Number(cid)))
        .filter(Boolean)
        .map((t) => String(t).slice(0, 1200))
        .join('\n---\n');
      return `### claim ${i}\n주장: ${c.text}\n인용 근거:\n${cited || '(없음)'}`;
    })
    .join('\n\n');

  let faithfulness: FaithfulnessMetric | null = null;
  try {
    const { object } = await generateObject({
      model: anthropic(EVAL_MODEL),
      schema: judgeSchema,
      system:
        '너는 환각 검증 판사다. 각 claim 이 그에 딸린 인용 근거만으로 뒷받침되는지 엄격히 판정한다. 근거에 없는 정보가 조금이라도 더해졌으면 supported=false. 근거가 "(없음)" 이면 supported=false.',
      prompt: `아래 각 claim 을 판정하라.\n\n${judgeInput}`,
      temperature: 0,
      maxRetries: 1,
      providerOptions: ZERO_RETENTION,
    });
    const supported = (object.verdicts ?? []).filter((v) => v.supported).length;
    faithfulness = {
      claims: claims.length,
      supported,
      faithfulness: claims.length === 0 ? 0 : supported / claims.length,
    };
  } catch (e) {
    console.warn('[rag-eval] judge failed', e);
  }

  return { faithfulness, citation };
}

export type RunEvalOpts = {
  admin: AdminClient;
  orgId: string;
  projectId: string;
  sampleSize?: number;
  k?: number;
  gitSha: string;
};

/**
 * 4 메트릭 오케스트레이터. 개별 메트릭이 실패해도 나머지는 진행(부분 run 보존).
 * gold 생성 → Recall / Coverage / Faithfulness+Citation 순차 실행.
 */
export async function runEval(opts: RunEvalOpts): Promise<EvalResult> {
  const { admin, orgId, projectId, gitSha } = opts;
  const k = Math.max(1, Math.min(50, opts.k ?? 10));
  const sampleSize = Math.max(
    1,
    Math.min(MAX_SAMPLE_SIZE, opts.sampleSize ?? DEFAULT_SAMPLE_SIZE),
  );
  const notes: string[] = [];

  // 전체 문서 수 (Coverage 분모).
  const { count: docCount, error: docErr } = await admin
    .from('interview_documents')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('project_id', projectId);
  if (docErr) throw new Error(`runEval docCount: ${docErr.message}`);
  const totalDocs = docCount ?? 0;

  const metrics: EvalMetrics = {
    recall: null,
    coverage: null,
    faithfulness: null,
    citation: null,
  };

  // gold 표본 → Recall.
  const sampled = await sampleChunks(admin, orgId, projectId, sampleSize);
  if (sampled.length === 0) {
    notes.push('no_eligible_chunks — 프로젝트에 평가 가능한 청크가 없음');
  } else {
    const gold = await generateGoldSet(sampled);
    if (gold.length === 0) {
      notes.push('gold_generation_failed — 질문 생성 0건');
    } else {
      if (gold.length < sampled.length) {
        notes.push(`gold_partial — ${sampled.length} 중 ${gold.length} 생성`);
      }
      metrics.recall = await runRecall(admin, orgId, projectId, gold, k);
    }
  }

  // Coverage.
  if (totalDocs === 0) {
    notes.push('coverage_skipped — 문서 0');
  } else {
    if (totalDocs === 1) {
      notes.push('coverage_single_doc — 문서 1개라 coverage 상한 1.0 (신뢰 낮음)');
    }
    metrics.coverage = await runCoverage(admin, orgId, projectId, totalDocs);
  }

  // Faithfulness + Citation.
  const validIds = await projectChunkIdSet(admin, orgId, projectId);
  if (validIds.size === 0) {
    notes.push('faithfulness_skipped — 청크 0');
  } else {
    const fc = await runFaithfulnessAndCitation(admin, orgId, projectId, k, validIds);
    metrics.faithfulness = fc.faithfulness;
    metrics.citation = fc.citation;
    if (!fc.faithfulness) notes.push('faithfulness_unavailable — 답변/판정 실패');
  }

  return {
    project_id: projectId,
    sample_size: sampleSize,
    k,
    model: EVAL_MODEL,
    git_sha: gitSha,
    metrics,
    notes,
  };
}

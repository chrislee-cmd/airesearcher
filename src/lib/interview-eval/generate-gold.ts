// 자동 정답(gold) 생성 — 수작업 라벨링 0.
//
// 청크 표본을 뽑아 각 청크로 Sonnet 이 "이 청크로만 답 가능한 질문" 을
// 만든다. 그 질문으로 실제 검색했을 때 원본 청크가 되돌아오면 = 검색이
// "자기 근거" 를 되찾은 것 → Recall@K (run-eval.ts).
//
// 재현성: 표본은 정렬된 chunk id 에 대한 균등 stride 추출이라 같은
// (project, sample_size) 면 같은 청크 집합을 탄다. 질문 생성은 LLM 이라
// 완전 결정적이진 않지만 temperature 를 낮춰 범위를 좁힌다.

import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { env } from '@/env';
import { ZERO_RETENTION } from '@/lib/llm/config';
import type { createAdminClient } from '@/lib/supabase/admin';
import type { GoldQuestion } from './types';

type AdminClient = ReturnType<typeof createAdminClient>;

// LLM 판사 + 질문 생성에 쓰는 모델. 스펙 결정: Sonnet.
export const EVAL_MODEL = 'claude-sonnet-4-6';

// 비용 상한 — 표본 청크 수 cap. 청크당 질문 1문(생성) + 검색 1회(임베딩)이라
// 표본이 곧 비용이다. 기본 50, 상한 100 (스펙 "표본 수 cap 명시").
export const DEFAULT_SAMPLE_SIZE = 50;
export const MAX_SAMPLE_SIZE = 100;

// gold 질문 생성 동시성 — 프로바이더 rate limit 을 넘지 않게 소규모 풀.
const GEN_CONCURRENCY = 5;

// 질문 생성에 의미 있는 최소 청크 길이(문자). 너무 짧은 청크(헤더 조각 등)는
// "이 청크로만 답 가능한 질문" 이 성립 안 해 표본에서 제외.
const MIN_CHUNK_CHARS = 80;

type ChunkRow = {
  id: number;
  document_id: string;
  content: string;
};

/**
 * 프로젝트 전체 청크에서 표본 N개를 결정적으로 추출.
 *
 * 정렬된 청크 배열에 대해 균등 간격(stride) 으로 뽑아, 같은 입력이면 같은
 * 표본이 나오도록 한다(재현성). 짧은 청크는 사전 제외.
 */
export async function sampleChunks(
  admin: AdminClient,
  orgId: string,
  projectId: string,
  sampleSize: number,
): Promise<ChunkRow[]> {
  const { data: docs, error: docErr } = await admin
    .from('interview_documents')
    .select('id')
    .eq('org_id', orgId)
    .eq('project_id', projectId);
  if (docErr) throw new Error(`sampleChunks docs: ${docErr.message}`);
  const docIds = (docs ?? []).map((d) => d.id);
  if (docIds.length === 0) return [];

  const { data: rows, error: chunkErr } = await admin
    .from('interview_chunks')
    .select('id, document_id, content')
    .eq('org_id', orgId)
    .in('document_id', docIds)
    // 결정적 순서 — 재현성의 축.
    .order('id', { ascending: true });
  if (chunkErr) throw new Error(`sampleChunks chunks: ${chunkErr.message}`);

  const eligible: ChunkRow[] = (rows ?? [])
    .map((r) => ({
      id: Number(r.id),
      document_id: String(r.document_id),
      content: String(r.content ?? ''),
    }))
    .filter((c) => c.content.trim().length >= MIN_CHUNK_CHARS);

  if (eligible.length <= sampleSize) return eligible;

  // 균등 stride 추출 — 문서 전반이 고르게 대표되도록(정렬이 id 순이라 문서별로
  // 인접). 처음/끝 편향 없이 등간격.
  const step = eligible.length / sampleSize;
  const out: ChunkRow[] = [];
  for (let i = 0; i < sampleSize; i++) {
    out.push(eligible[Math.floor(i * step)]);
  }
  return out;
}

const goldSchema = z.object({
  // 이 청크만 읽어야 답할 수 있는, 자연스러운 사용자 질문 1문.
  question: z.string(),
});

const GEN_SYSTEM = [
  '너는 RAG 검색 품질 평가를 위한 정답셋 생성기다.',
  '주어진 인터뷰 청크(발췌) 하나를 읽고, "이 청크에 담긴 정보로만 답할 수 있는"',
  '구체적이고 자연스러운 한국어 질문 1문을 만든다.',
  '',
  '규칙:',
  '- 질문의 답이 반드시 이 청크 안에 있어야 한다(다른 청크로는 답 불가).',
  '- 청크의 표현을 그대로 베끼지 말고, 사용자가 실제로 물을 법한 방식으로 바꿔 쓴다.',
  '- "이 청크에 따르면" 같은 메타 표현 금지 — 독립적으로 성립하는 질문.',
  '- 너무 일반적(코퍼스 어디서나 답 가능)이면 안 된다. 이 청크 고유의 사실/의견을 겨냥.',
].join('\n');

/**
 * 청크 하나 → gold 질문 1문. 실패(빈 응답/에러) 시 null.
 */
async function generateOne(chunk: ChunkRow): Promise<GoldQuestion | null> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('missing_anthropic_key');
  const anthropic = createAnthropic({ apiKey });
  try {
    const { object } = await generateObject({
      model: anthropic(EVAL_MODEL),
      schema: goldSchema,
      system: GEN_SYSTEM,
      prompt: `## 청크\n${chunk.content.slice(0, 4000)}`,
      temperature: 0.2,
      maxRetries: 1,
      providerOptions: ZERO_RETENTION,
    });
    const q = object?.question?.trim();
    if (!q) return null;
    return {
      chunk_id: chunk.id,
      document_id: chunk.document_id,
      question: q,
    };
  } catch (e) {
    console.warn(`[rag-eval] gold gen failed chunk=${chunk.id}`, e);
    return null;
  }
}

/**
 * 표본 청크들 → gold 질문 집합. 소규모 동시성 풀로 실행하고, 생성 실패한
 * 청크는 조용히 제외(부분 표본도 유효한 측정).
 */
export async function generateGoldSet(chunks: ChunkRow[]): Promise<GoldQuestion[]> {
  const out: GoldQuestion[] = [];
  for (let i = 0; i < chunks.length; i += GEN_CONCURRENCY) {
    const batch = chunks.slice(i, i + GEN_CONCURRENCY);
    const results = await Promise.all(batch.map((c) => generateOne(c)));
    for (const r of results) {
      if (r) out.push(r);
    }
  }
  return out;
}

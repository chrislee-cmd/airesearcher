// 인터뷰 탑라인 보고서 — core (corpus fetch · content_hash · Opus 생성 · 검증).
//
// route(POST /api/interviews/v2/topline)와 index auto-kick 이 공유한다.
//   - computeProjectCorpus : 프로젝트 문서 셋 해시(캐시 키) + 문서/청크 카운트
//   - fetchProjectChunks   : 프로젝트 전체 chunk(컨텍스트 예산 내 per-doc 샘플)
//   - getTopline / upsertGenerating : 캐시 조회 + 'generating' 마킹
//   - runTopline           : Opus generateObject → 블록 검증 → 영속 (after() 안에서)
//
// 근거 = 프로젝트 전체 chunk (선택 영역 X — 사용자 결정 #2). 인용은 v2/search
// 와 동일하게 근거 chunk_id 집합에 대해 재검증한다(지어낸 id drop).

import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { env } from '@/env';
import { ZERO_RETENTION } from '@/lib/llm/config';
import { hashString } from '@/lib/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  TOPLINE_SYSTEM,
  toplineSchema,
  formatToplineEvidence,
  type ToplineBlockRaw,
} from '@/lib/interview-v2/topline-prompt';

export const TOPLINE_MODEL = 'claude-opus-4-8';

// Opus 4.8 입력 컨텍스트(~200k tokens) + 출력 여유를 고려한 근거 예산(문자).
// 한국어는 토큰 밀도가 높아 보수적으로 잡는다(~1자 ≈ 0.4tok → 320k자 ≈ 128k tok).
// 초과 시 문서별 균등 샘플로 줄여 **모든 문서가 교차분석에 대표되도록** 한다
// (2-pass 요약 대신 택한 보수적 under-budget 경로 — PR 본문 참고).
const MAX_EVIDENCE_CHARS = 320_000;

type AdminClient = ReturnType<typeof createAdminClient>;

/** interview_toplines row (server-side shape). */
export type InterviewToplineRow = {
  id: string;
  org_id: string;
  project_id: string;
  content_hash: string;
  blocks: ToplineBlock[];
  status: 'idle' | 'generating' | 'done' | 'error';
  error_message: string | null;
  model: string | null;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * 영속되는 블록. 생성 스키마(ToplineBlockRaw)에 서버가 안정 anchor id 를
 * 부여한 것. inserted_qa 는 후속 drag-to-ask 가 병합하는 타입(생성 X).
 */
export type ToplineBlock =
  | (ToplineBlockRaw & { id: string })
  | {
      id: string;
      type: 'inserted_qa';
      md: string;
      question?: string;
      // 사용자가 드래그로 선택한 원문 발췌 — Q 라벨에 문맥으로 표시(사용자
      // 결정 §D). 없어도 렌더는 동작(구버전 블록 호환).
      selected_excerpt?: string;
      citations: string[];
    };

export type ToplineChunk = {
  chunk_id: string;
  document_id: string;
  filename: string;
  content: string;
};

/**
 * 프로젝트 문서 셋의 해시(캐시 키) + 문서/청크 카운트.
 *
 * content_hash = 각 interview_documents.content_hash 를 정렬·결합한 것의 해시.
 * 파일 추가/삭제/교체 시 이 값이 바뀌어 기존 탑라인이 stale 로 판정된다.
 */
export async function computeProjectCorpus(
  admin: AdminClient,
  orgId: string,
  projectId: string,
): Promise<{ hash: string; docCount: number; chunkCount: number }> {
  const { data: docs, error: docErr } = await admin
    .from('interview_documents')
    .select('id, content_hash')
    .eq('org_id', orgId)
    .eq('project_id', projectId);
  if (docErr) throw new Error(`computeProjectCorpus docs: ${docErr.message}`);

  const hashes = (docs ?? [])
    .map((d) => String(d.content_hash ?? ''))
    .filter(Boolean)
    .sort();
  const hash = hashString(hashes.join('|'));

  const docIds = (docs ?? []).map((d) => d.id);
  if (docIds.length === 0) {
    return { hash, docCount: 0, chunkCount: 0 };
  }

  const { count, error: cntErr } = await admin
    .from('interview_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .in('document_id', docIds);
  if (cntErr) throw new Error(`computeProjectCorpus chunks: ${cntErr.message}`);

  return { hash, docCount: hashes.length, chunkCount: count ?? 0 };
}

/**
 * 프로젝트 전체 chunk 를 근거로 로드. 문서별로 그룹핑해(교차분석용) 반환하며,
 * 총량이 MAX_EVIDENCE_CHARS 를 넘으면 문서별 균등 샘플로 줄인다.
 */
export async function fetchProjectChunks(
  admin: AdminClient,
  orgId: string,
  projectId: string,
): Promise<ToplineChunk[]> {
  const { data: docs, error: docErr } = await admin
    .from('interview_documents')
    .select('id, filename')
    .eq('org_id', orgId)
    .eq('project_id', projectId);
  if (docErr) throw new Error(`fetchProjectChunks docs: ${docErr.message}`);
  if (!docs || docs.length === 0) return [];

  const filenameById = new Map(docs.map((d) => [d.id, String(d.filename ?? '')]));
  const docIds = docs.map((d) => d.id);

  const { data: rows, error: chunkErr } = await admin
    .from('interview_chunks')
    .select('id, document_id, content')
    .eq('org_id', orgId)
    .in('document_id', docIds)
    // 문서별로 인접하도록 정렬 — evidence 블록이 문서 단위로 묶여 모델이
    // 문서 간 대조를 하기 쉬워진다.
    .order('document_id', { ascending: true })
    .order('id', { ascending: true });
  if (chunkErr) throw new Error(`fetchProjectChunks chunks: ${chunkErr.message}`);

  const all: ToplineChunk[] = (rows ?? []).map((r) => ({
    chunk_id: String(r.id),
    document_id: String(r.document_id),
    filename: filenameById.get(r.document_id) ?? '',
    content: String(r.content ?? ''),
  }));

  return capChunksToBudget(all, MAX_EVIDENCE_CHARS);
}

/**
 * 예산 초과 시 문서별 균등 샘플. 모든 문서가 대표되도록(교차분석 유지) 각
 * 문서에서 고르게 간격을 둔 chunk 를 뽑는다. 예산 내면 원본 그대로.
 */
export function capChunksToBudget(
  chunks: ToplineChunk[],
  budget: number,
): ToplineChunk[] {
  const total = chunks.reduce((n, c) => n + c.content.length, 0);
  if (total <= budget) return chunks;

  // 문서별 그룹핑(원 순서 유지).
  const byDoc = new Map<string, ToplineChunk[]>();
  for (const c of chunks) {
    const arr = byDoc.get(c.document_id);
    if (arr) arr.push(c);
    else byDoc.set(c.document_id, [c]);
  }
  const perDocBudget = Math.floor(budget / byDoc.size);

  const out: ToplineChunk[] = [];
  for (const arr of byDoc.values()) {
    const avgLen =
      Math.max(1, arr.reduce((n, c) => n + c.content.length, 0) / arr.length);
    const keep = Math.max(1, Math.min(arr.length, Math.floor(perDocBudget / avgLen)));
    if (keep >= arr.length) {
      out.push(...arr);
      continue;
    }
    // 고르게 간격을 둔 keep 개 인덱스 선택.
    const step = arr.length / keep;
    for (let i = 0; i < keep; i++) {
      out.push(arr[Math.floor(i * step)]);
    }
  }
  return out;
}

/**
 * 프로젝트 전체 chunk 의 id 집합(문자열). drag-to-ask "유지" 시 삽입할
 * inserted_qa 의 citations 를 이 집합에 대해 재검증(무효 chunk id drop —
 * verifyBlockCitations 와 동일 원리)하는 데 쓴다. content 는 로드하지 않아
 * 가볍다.
 */
export async function getProjectChunkIds(
  admin: AdminClient,
  orgId: string,
  projectId: string,
): Promise<Set<string>> {
  const { data: docs, error: docErr } = await admin
    .from('interview_documents')
    .select('id')
    .eq('org_id', orgId)
    .eq('project_id', projectId);
  if (docErr) throw new Error(`getProjectChunkIds docs: ${docErr.message}`);
  const docIds = (docs ?? []).map((d) => d.id);
  if (docIds.length === 0) return new Set();

  const { data: rows, error: chunkErr } = await admin
    .from('interview_chunks')
    .select('id')
    .eq('org_id', orgId)
    .in('document_id', docIds);
  if (chunkErr) throw new Error(`getProjectChunkIds chunks: ${chunkErr.message}`);
  return new Set((rows ?? []).map((r) => String(r.id)));
}

/**
 * anchor 블록 바로 뒤에 inserted_qa 블록을 끼운 새 blocks 배열을 만든다
 * (drag-to-ask "유지"). anchor 가 없으면 null (호출측이 404 로 응답). 순수
 * 함수 — 검증/영속은 route 책임.
 */
export function insertQaAfterAnchor(
  blocks: ToplineBlock[],
  anchorId: string,
  qa: {
    id: string;
    md: string;
    question: string;
    selected_excerpt: string;
    citations: string[];
  },
): ToplineBlock[] | null {
  const idx = blocks.findIndex((b) => b.id === anchorId);
  if (idx === -1) return null;
  const inserted: ToplineBlock = {
    id: qa.id,
    type: 'inserted_qa',
    md: qa.md,
    question: qa.question,
    selected_excerpt: qa.selected_excerpt,
    citations: qa.citations,
  };
  return [...blocks.slice(0, idx + 1), inserted, ...blocks.slice(idx + 1)];
}

/**
 * 인용 chunk_id 집합 → 사람이 읽는 출처(문서명 + 발췌) 맵. export(docx)/공유가
 * raw chunk_id 대신 "근거: 문서명" 을 렌더하는 데 쓴다(사용자 결정 3). chunk 가
 * 이 org 소유 문서에 속할 때만 해석되므로 격리도 유지된다.
 */
export async function getCitationSources(
  admin: AdminClient,
  orgId: string,
  chunkIds: string[],
): Promise<Map<string, { filename: string; excerpt: string }>> {
  const ids = Array.from(new Set(chunkIds.map((c) => String(c).trim()))).filter(
    Boolean,
  );
  const out = new Map<string, { filename: string; excerpt: string }>();
  if (ids.length === 0) return out;

  const { data: chunks, error: chunkErr } = await admin
    .from('interview_chunks')
    .select('id, document_id, content')
    .eq('org_id', orgId)
    .in('id', ids);
  if (chunkErr) throw new Error(`getCitationSources chunks: ${chunkErr.message}`);
  if (!chunks || chunks.length === 0) return out;

  const docIds = Array.from(new Set(chunks.map((c) => String(c.document_id))));
  const { data: docs, error: docErr } = await admin
    .from('interview_documents')
    .select('id, filename')
    .eq('org_id', orgId)
    .in('id', docIds);
  if (docErr) throw new Error(`getCitationSources docs: ${docErr.message}`);
  const filenameById = new Map(
    (docs ?? []).map((d) => [String(d.id), String(d.filename ?? '')]),
  );

  for (const c of chunks) {
    out.set(String(c.id), {
      filename: filenameById.get(String(c.document_id)) ?? '',
      excerpt: String(c.content ?? '').slice(0, 240),
    });
  }
  return out;
}

/** 블록 배열에서 인용 chunk_id 전체를 중복 없이 모은다. */
export function collectCitationIds(blocks: ToplineBlock[]): string[] {
  const set = new Set<string>();
  for (const b of blocks) {
    if ('citations' in b && Array.isArray(b.citations)) {
      for (const c of b.citations) set.add(String(c));
    }
  }
  return Array.from(set);
}

/** 던져지는 에러 코드 — route 가 상태 코드로 매핑한다. */
export class ToplineNotReadyError extends Error {
  constructor() {
    super('topline_not_ready');
    this.name = 'ToplineNotReadyError';
  }
}

/**
 * 프로젝트의 저장된 탑라인 → Word(.docx) Buffer 조립. export 다운로드와 Google
 * Docs 공유가 공유하는 경로: getTopline → 인용 출처 해석 → 프로젝트명 조회 →
 * toplineBlocksToDocx. 블록이 없으면 ToplineNotReadyError.
 *
 * 소유 검증(org)은 호출측 route 가 먼저 수행한다고 가정한다.
 */
export async function assembleToplineDocx(
  admin: AdminClient,
  orgId: string,
  projectId: string,
): Promise<{ buffer: Buffer; projectName: string; generatedAt: string | null }> {
  const topline = await getTopline(admin, projectId);
  const blocks = topline?.blocks ?? [];
  if (!topline || blocks.length === 0) {
    throw new ToplineNotReadyError();
  }

  const sources = await getCitationSources(
    admin,
    orgId,
    collectCitationIds(blocks),
  );

  const { data: projectRow } = await admin
    .from('interview_projects')
    .select('name')
    .eq('id', projectId)
    .eq('org_id', orgId)
    .maybeSingle();
  const projectName = String(projectRow?.name ?? '').trim() || '탑라인 보고서';

  // docx 조립은 순수 lib(DB 무관) — 여기서 해석한 sources 맵만 주입한다.
  const { toplineBlocksToDocx } = await import(
    '@/lib/interview-v2/topline-docx'
  );
  const buffer = await toplineBlocksToDocx(blocks, {
    projectName,
    generatedAt: topline.generated_at,
    sources,
  });
  return { buffer, projectName, generatedAt: topline.generated_at };
}

/** 프로젝트의 기존 탑라인 row (없으면 null). */
export async function getTopline(
  admin: AdminClient,
  projectId: string,
): Promise<InterviewToplineRow | null> {
  const { data } = await admin
    .from('interview_toplines')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle();
  return (data as InterviewToplineRow | null) ?? null;
}

/**
 * 탑라인 row 를 'generating' 으로 upsert(프로젝트당 1건). 캐시 키(content_hash)
 * 를 현재 값으로 갱신하고 blocks 는 비우지 않는다(기존 결과를 재생성 완료 전까지
 * 유지 — UI 가 이전 보고서를 계속 보여줄 수 있게). row id 반환.
 */
export async function upsertGenerating(
  admin: AdminClient,
  opts: { orgId: string; projectId: string; hash: string },
): Promise<string> {
  const { orgId, projectId, hash } = opts;
  const { data, error } = await admin
    .from('interview_toplines')
    .upsert(
      {
        org_id: orgId,
        project_id: projectId,
        content_hash: hash,
        status: 'generating',
        error_message: null,
        model: TOPLINE_MODEL,
      },
      { onConflict: 'project_id' },
    )
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`upsertGenerating: ${error?.message ?? 'no_row'}`);
  }
  return data.id as string;
}

// 근거 chunk_id 집합에 대해 블록의 citations 를 재검증 — 지어낸 id 는 drop
// (v2/search reconstructCitations 원리). server 가 인용 무결성을 소유한다.
function verifyBlockCitations(
  blocks: ToplineBlockRaw[],
  chunks: ToplineChunk[],
): ToplineBlock[] {
  const validIds = new Set(chunks.map((c) => c.chunk_id));
  return blocks.map((b, i) => {
    const id = `blk_${String(i + 1).padStart(2, '0')}`;
    if ('citations' in b && Array.isArray(b.citations)) {
      const kept = Array.from(
        new Set(b.citations.map((c) => String(c).trim())),
      ).filter((c) => validIds.has(c));
      return { ...b, id, citations: kept } as ToplineBlock;
    }
    return { ...b, id } as ToplineBlock;
  });
}

/**
 * Opus 로 탑라인 blocks 를 생성해 row 를 'done' 으로 갱신. 실패 시 'error'.
 * after() 안에서 호출되므로 스스로 완결(예외를 밖으로 던지지 않음).
 * row 는 이미 upsertGenerating 으로 존재한다고 가정.
 */
export async function runTopline(
  admin: AdminClient,
  opts: { toplineId: string; orgId: string; projectId: string },
): Promise<void> {
  const { toplineId, orgId, projectId } = opts;
  const tag = `[v2/topline] ${projectId.slice(0, 8)}`;
  try {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('missing_anthropic_key');

    const chunks = await fetchProjectChunks(admin, orgId, projectId);
    if (chunks.length === 0) {
      await admin
        .from('interview_toplines')
        .update({ status: 'error', error_message: 'no_chunks' })
        .eq('id', toplineId);
      return;
    }

    const totalChars = chunks.reduce((n, c) => n + c.content.length, 0);
    console.log(`${tag} generating`, {
      chunks: chunks.length,
      evidence_chars: totalChars,
    });

    const anthropic = createAnthropic({ apiKey });
    const { object } = await generateObject({
      model: anthropic(TOPLINE_MODEL),
      schema: toplineSchema,
      system: `${TOPLINE_SYSTEM}\n\n## 근거 청크\n${formatToplineEvidence(chunks)}`,
      prompt:
        '위 근거 청크 전체를 분석해 6개 고정 섹션의 탑라인 보고서를 블록 배열로 작성하세요. 교차분석 인사이트 섹션과 table/quote 블록을 반드시 포함하고, 모든 사실 블록에 근거 chunk_id 를 답니다.',
      temperature: 0.2,
      maxOutputTokens: 8_000,
      maxRetries: 1,
      providerOptions: ZERO_RETENTION,
    });

    const blocks = verifyBlockCitations(object?.blocks ?? [], chunks);
    const citedTotal = blocks.reduce(
      (n, b) => n + ('citations' in b ? b.citations.length : 0),
      0,
    );
    console.log(`${tag} done`, {
      blocks: blocks.length,
      citations: citedTotal,
    });

    await admin
      .from('interview_toplines')
      .update({
        status: 'done',
        blocks: blocks as unknown as object,
        error_message: null,
        generated_at: new Date().toISOString(),
      })
      .eq('id', toplineId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'topline_failed';
    console.error(`${tag} failed`, msg);
    try {
      await admin
        .from('interview_toplines')
        .update({ status: 'error', error_message: msg })
        .eq('id', toplineId);
    } catch {
      // ignore — best-effort failure marker.
    }
  }
}

/**
 * index 완료 auto-kick 용. 캐시 히트(해시 동일 & done)이거나 이미 생성 중이면
 * skip. 그 외에는 'generating' 마킹 후 runTopline 을 await 한다(after() 안에서
 * 실행되도록 호출측이 스케줄). chunk 가 아직 없으면 skip.
 */
export async function maybeKickTopline(
  admin: AdminClient,
  opts: { orgId: string; projectId: string },
): Promise<void> {
  const { orgId, projectId } = opts;
  const { hash, chunkCount } = await computeProjectCorpus(admin, orgId, projectId);
  if (chunkCount === 0) return; // 인덱싱 전 — index 완료 시 재kick.

  const existing = await getTopline(admin, projectId);
  if (existing?.status === 'generating') return; // 이미 진행 중.
  if (existing?.status === 'done' && existing.content_hash === hash) return; // 캐시 히트 → 비용 0.

  const toplineId = await upsertGenerating(admin, { orgId, projectId, hash });
  await runTopline(admin, { toplineId, orgId, projectId });
}

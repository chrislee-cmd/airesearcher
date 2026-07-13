// 인터뷰 탑라인 보고서 — core (map-reduce 전수 포괄 · content_hash · 검증).
//
// route(POST /api/interviews/v2/topline)와 index auto-kick 이 공유한다.
//   - computeProjectCorpus   : 프로젝트 문서 셋 해시(캐시 키) + 문서/청크 카운트
//   - fetchDocumentsWithChunks : 문서별 전문 chunk (샘플링 X — 전수)
//   - getTopline / upsertGenerating : 캐시 조회 + 'generating' 마킹
//   - runTopline             : map-reduce (문서별 map 추출 → Opus reduce 종합) →
//                              블록 검증 → 영속 (after() 안에서)
//
// 왜 map-reduce (카드 #430): 탑라인/집계는 "빠짐없는 포괄"이 생명이다. 예전엔
// 전체 chunk 를 한 번의 Opus 패스에 밀어넣되 예산 초과 시 문서별로 chunk 를
// 샘플링해 응답자 발언이 유실될 수 있었다. 이제 **모든 문서(응답자)를 전용
// map 호출로 전문 순회**해 추출(유실 0)하고, reduce(Opus)가 N개 추출을 모두
// 받아 종합한다. 수치는 제공된 전수 위에서 실제로 센다(추정 아님 — 결정 #3).
//
// 근거 = 프로젝트 전체 문서 (선택 영역 X — 사용자 결정 #2). 인용은 v2/search
// 와 동일하게 근거 chunk_id 집합에 대해 재검증한다(지어낸 id drop).

import { streamObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { env } from '@/env';
import { ZERO_RETENTION } from '@/lib/llm/config';
import { hashString } from '@/lib/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  buildToplineSystem,
  TOPLINE_REDUCE_NOTICE,
  toplineSchema,
  toplineBlockSchema,
  type ToplineBlockRaw,
} from '@/lib/interview-v2/topline-prompt';
import {
  mapDocument,
  runPoolUntil,
  formatExtractsForReduce,
  docExtractSchema,
  MAP_CONCURRENCY,
  TOPLINE_MAP_MODEL,
  type DocExtract,
  type DocExtractWithMeta,
} from '@/lib/interview-v2/topline-map';
import {
  isEditableToplineBlockType,
  type ToplineBlock as ClientToplineBlock,
} from '@/lib/interview-v2/types';

export const TOPLINE_MODEL = 'claude-opus-4-8';

type AdminClient = ReturnType<typeof createAdminClient>;

/** map-reduce 에서 한 문서(응답자) = 파일명 + content_hash + 전문 chunk. */
export type ToplineDocument = {
  document_id: string;
  filename: string;
  content_hash: string;
  chunks: ToplineChunk[];
};

/** interview_toplines row (server-side shape). */
export type InterviewToplineRow = {
  id: string;
  org_id: string;
  project_id: string;
  content_hash: string;
  // 출력 언어(ko/en/ja/zh/es/th). null = 레거시 row(한국어로 취급). 캐시
  // dedup 키의 일부 — 같은 문서셋이라도 언어가 다르면 재생성한다.
  output_lang: string | null;
  // 재생성 시 사용자가 지정한 분석 방향(자유 텍스트). null = 방향 없음. 캐시
  // dedup 키의 일부 — 같은 문서셋·언어라도 방향이 다르면 재생성한다. reduce
  // system prompt 에 사용자 요청 방향으로 주입된다(근거 밖 생성은 여전히 금지).
  user_direction: string | null;
  // 산출물 출처 — 'generated'(또는 null=레거시) = 풀 파이프라인 생성물,
  // 'uploaded' = 편집전용 외부 보고서 업로드(Opus 호출 없이 md→blocks 파싱).
  // 재생성 UI 가 업로드 보고서 덮어쓰기 경고를 띄우는 판단 근거.
  source: string | null;
  blocks: ToplineBlock[];
  status: 'idle' | 'generating' | 'done' | 'error';
  error_message: string | null;
  model: string | null;
  generated_at: string | null;
  // map-reduce 진행률 — map_total = 이번 생성이 순회하는 문서 수(null=레거시),
  // map_done = 완료된 문서 수. UI 가 generating 중 "N/M 문서 분석" 을 그린다.
  map_total: number | null;
  map_done: number | null;
  // durable 재개 상태(카드 #434). phase = 현재 단계('map'|'reduce', null=레거시),
  // map_cursor = 캐시된(추출 영속된) 문서 수 = map 커서 미러, resume_count =
  // self-kick 홉 카운터(무한 루프 가드).
  phase: 'map' | 'reduce' | null;
  map_cursor: number | null;
  resume_count: number | null;
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
    }
  | {
      id: string;
      type: 'inserted_section';
      md: string;
      // 사용자가 준 자연어 지시(예: "취미 섹션 추가") — 섹션 라벨/디버깅 문맥.
      prompt?: string;
      // 삽입 지점 바로 위 블록 id(최상단 삽입이면 null). 재생성 시 best-effort
      // 재배치용 문맥(현 구현은 보고서 끝에 append — extractInsertedBlocks 주석).
      anchor_block_id?: string | null;
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
 * 프로젝트의 모든 문서를 **문서별 전문 chunk 로 그룹핑**해 로드(map-reduce map
 * 입력). 샘플링·예산 절단 없음 — 각 문서를 통째로 map 에 넣어 어떤 발언도
 * 유실되지 않게 한다(카드 #430 결정 #1). 문서 하나가 컨텍스트에 편하게 들어가는
 * 크기라 전량 로드해도 안전하다. content_hash 를 함께 실어 문서 단위 캐시 키로
 * 쓴다. filename 오름차순(안정 순서 → 진행률/로그 재현성).
 */
export async function fetchDocumentsWithChunks(
  admin: AdminClient,
  orgId: string,
  projectId: string,
): Promise<ToplineDocument[]> {
  const { data: docs, error: docErr } = await admin
    .from('interview_documents')
    .select('id, filename, content_hash')
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .order('filename', { ascending: true });
  if (docErr) throw new Error(`fetchDocumentsWithChunks docs: ${docErr.message}`);
  if (!docs || docs.length === 0) return [];

  const docIds = docs.map((d) => d.id);
  const { data: rows, error: chunkErr } = await admin
    .from('interview_chunks')
    .select('id, document_id, content')
    .eq('org_id', orgId)
    .in('document_id', docIds)
    .order('document_id', { ascending: true })
    .order('id', { ascending: true });
  if (chunkErr) throw new Error(`fetchDocumentsWithChunks chunks: ${chunkErr.message}`);

  const chunksByDoc = new Map<string, ToplineChunk[]>();
  for (const r of rows ?? []) {
    const docId = String(r.document_id);
    const chunk: ToplineChunk = {
      chunk_id: String(r.id),
      document_id: docId,
      filename: '',
      content: String(r.content ?? ''),
    };
    const arr = chunksByDoc.get(docId);
    if (arr) arr.push(chunk);
    else chunksByDoc.set(docId, [chunk]);
  }

  const out: ToplineDocument[] = [];
  for (const d of docs) {
    const id = String(d.id);
    const filename = String(d.filename ?? '');
    const chunks = (chunksByDoc.get(id) ?? []).map((c) => ({ ...c, filename }));
    // chunk 가 0 인 문서(인덱싱 지연 등)는 map 대상에서 제외 — 근거가 없다.
    if (chunks.length === 0) continue;
    out.push({
      document_id: id,
      filename,
      content_hash: String(d.content_hash ?? ''),
      chunks,
    });
  }
  return out;
}

/**
 * 문서 단위 map 추출 캐시 조회 — (document_id, content_hash) 로 이미 뽑아둔
 * 추출을 가져온다(변하지 않은 파일은 map LLM 재호출 0 — 결정 #4). content_hash
 * 가 없는(레거시) 문서는 캐시하지 않는다. 반환은 document_id → DocExtract.
 */
async function loadCachedExtracts(
  admin: AdminClient,
  orgId: string,
  docs: ToplineDocument[],
): Promise<Map<string, DocExtract>> {
  const out = new Map<string, DocExtract>();
  const hashable = docs.filter((d) => d.content_hash);
  if (hashable.length === 0) return out;

  const { data, error } = await admin
    .from('interview_topline_doc_extracts')
    .select('document_id, content_hash, extract')
    .eq('org_id', orgId)
    .in(
      'document_id',
      hashable.map((d) => d.document_id),
    );
  if (error) {
    // 캐시는 최적화일 뿐 — 조회 실패해도 map 을 새로 돌리면 되므로 삼킨다.
    console.warn('[v2/topline] extract cache read failed', error.message);
    return out;
  }
  const hashByDoc = new Map(hashable.map((d) => [d.document_id, d.content_hash]));
  for (const row of data ?? []) {
    const docId = String(row.document_id);
    // content_hash 가 현재와 같을 때만 히트(파일이 바뀌었으면 stale → 재map).
    if (hashByDoc.get(docId) !== String(row.content_hash)) continue;
    const parsed = docExtractSchema.safeParse(row.extract);
    if (parsed.success) out.set(docId, parsed.data);
  }
  return out;
}

/**
 * 문서 map 추출을 캐시에 upsert (document_id, content_hash 유니크). content_hash
 * 없는 문서는 건너뛴다(캐시 키 불가). best-effort — 실패해도 생성은 진행.
 */
async function saveExtract(
  admin: AdminClient,
  orgId: string,
  doc: ToplineDocument,
  extract: DocExtract,
): Promise<void> {
  if (!doc.content_hash) return;
  const { error } = await admin.from('interview_topline_doc_extracts').upsert(
    {
      org_id: orgId,
      document_id: doc.document_id,
      content_hash: doc.content_hash,
      extract: extract as unknown as object,
      model: TOPLINE_MAP_MODEL,
    },
    { onConflict: 'document_id,content_hash' },
  );
  if (error) console.warn('[v2/topline] extract cache write failed', error.message);
}

/**
 * 탑라인 row 의 map 진행률/재개 상태 갱신 — realtime 으로 "N/M 문서 분석" 을
 * 노출하고, 매 update 가 updated_at 트리거를 bump 해 heartbeat 이 된다(살아 있는
 * 재개 루프는 이 갱신으로 stuck 오판을 면한다 — 카드 #483).
 */
async function updateMapProgress(
  admin: AdminClient,
  toplineId: string,
  patch: {
    map_total?: number;
    map_done?: number;
    map_cursor?: number;
    phase?: 'map' | 'reduce';
  },
): Promise<void> {
  const { error } = await admin
    .from('interview_toplines')
    .update(patch)
    .eq('id', toplineId);
  if (error) console.warn('[v2/topline] progress update failed', error.message);
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
  return insertBlockAfterAnchor(blocks, anchorId, {
    id: qa.id,
    type: 'inserted_qa',
    md: qa.md,
    question: qa.question,
    selected_excerpt: qa.selected_excerpt,
    citations: qa.citations,
  });
}

/**
 * anchor 블록 바로 뒤에 임의 블록을 끼운 새 blocks 배열을 만든다 —
 * insertQaAfterAnchor(inserted_qa)와 insert_section(inserted_section)이 공유하는
 * 삽입 primitive. anchorId 가 null 이면 맨 앞에 unshift(섹션 사이 삽입 UX 의
 * "최상단 gap"). anchorId 가 주어졌는데 그 블록이 없으면 null (호출측이 409 로
 * 응답 — 그 사이 재생성 등으로 anchor 소실). 순수 함수 — 검증/영속은 route 책임.
 */
export function insertBlockAfterAnchor(
  blocks: ToplineBlock[],
  anchorId: string | null,
  block: ToplineBlock,
): ToplineBlock[] | null {
  if (anchorId === null) return [block, ...blocks];
  const idx = blocks.findIndex((b) => b.id === anchorId);
  if (idx === -1) return null;
  return [...blocks.slice(0, idx + 1), block, ...blocks.slice(idx + 1)];
}

// 사용자가 삽입한 블록 계열(드래그→Q&A · 섹션 사이 삽입). 생성 블록(blk_NN)과
// 달리 사용자 자산이라 재생성(force)에도 보존한다.
const INSERTED_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'inserted_qa',
  'inserted_section',
]);

/**
 * blocks 배열에서 사용자 삽입 블록(inserted_qa / inserted_section)만 순서대로
 * 추린다. 재생성 시 이들을 보존하려고 새 보고서에 다시 합치는 데 쓴다
 * (mergeInsertedBlocks).
 */
export function extractInsertedBlocks(blocks: ToplineBlock[]): ToplineBlock[] {
  return blocks.filter((b) => INSERTED_BLOCK_TYPES.has(b.type));
}

/**
 * 새로 생성된 보고서 블록 뒤에 보존 대상 삽입 블록을 붙여 재생성 후에도 사용자
 * 삽입분이 살아남게 한다. 재생성된 보고서는 blk_NN id 를 새로 발급하므로 원래
 * anchor(옛 blk_NN)로의 정확한 재배치는 의미가 없다 — 삽입 블록들의 상호 순서만
 * 지켜 보고서 말미에 append 한다(보수적·예측가능). id 중복은 방어적으로 제거한다.
 */
export function mergeInsertedBlocks(
  generated: ToplineBlock[],
  inserted: ToplineBlock[],
): ToplineBlock[] {
  if (inserted.length === 0) return generated;
  const genIds = new Set(generated.map((b) => b.id));
  const carry = inserted.filter((b) => !genIds.has(b.id));
  if (carry.length === 0) return generated;
  return [...generated, ...carry];
}

/**
 * 편집 대상 블록의 md 를 새 텍스트로 교체한 새 blocks 배열을 만든다(인라인
 * 편집 저장). 블록 타입/구조는 그대로 두고 md 만 갈아끼운다 — 스타일 편집 X,
 * 내용만(사용자 결정 1·3). blockId 가 없거나 편집 불가 타입(table/chart/pie)이면
 * null (호출측이 422 로 응답). 편집 가능 타입 판정은 client/server 공유 집합
 * (types.ts 의 isEditableToplineBlockType). 순수 함수 — 검증/영속은 route 책임.
 */
export function editBlockMd(
  blocks: ToplineBlock[],
  blockId: string,
  md: string,
): ToplineBlock[] | null {
  const idx = blocks.findIndex((b) => b.id === blockId);
  if (idx === -1) return null;
  const block = blocks[idx];
  if (!isEditableToplineBlockType(block.type)) return null;
  // 타입/citations/attribution 등은 유지하고 md 만 교체.
  const next = { ...block, md } as ToplineBlock;
  return [...blocks.slice(0, idx), next, ...blocks.slice(idx + 1)];
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
  opts: {
    orgId: string;
    projectId: string;
    hash: string;
    outputLang?: string;
    userDirection?: string;
  },
): Promise<string> {
  const { orgId, projectId, hash, outputLang, userDirection } = opts;
  const { data, error } = await admin
    .from('interview_toplines')
    .upsert(
      {
        org_id: orgId,
        project_id: projectId,
        content_hash: hash,
        // 이번 생성의 출력 언어 — 캐시 키의 일부. 미지정(undefined)이면 null 로
        // 저장(레거시/자동 kick = 한국어 기본 취급).
        output_lang: outputLang ?? null,
        // 이번 재생성의 사용자 방향 — 캐시 키의 일부. 빈 값/미지정이면 null
        // (방향 없음). 자동 kick(maybeKickTopline)은 방향을 안 넘겨 항상 null.
        user_direction: userDirection?.trim() || null,
        // 생성 경로임을 명시 — 업로드(uploaded) 보고서를 재생성하면 이 upsert 를
        // 타므로 source 가 다시 'generated' 로 뒤집혀 마커가 정확히 유지된다.
        source: 'generated',
        status: 'generating',
        error_message: null,
        model: TOPLINE_MODEL,
        // 진행률 리셋 — 이번 생성의 map 이 아직 시작 전(runTopline 이 문서 수를
        // 알면 map_total 을 채운다). 이전 생성의 진행률이 남지 않게 0/null 로.
        map_total: null,
        map_done: 0,
        // durable 재개 상태 리셋(카드 #434) — 새 생성이므로 map 단계부터, 커서
        // 0, 홉 카운터 0. force 재생성/언어 변경도 이 upsert 를 타므로 이전
        // 생성의 재개 상태가 남지 않는다. (extract 캐시는 content_hash 유효분을
        // 그대로 재사용 — 재map 0.)
        phase: 'map',
        map_cursor: 0,
        resume_count: 0,
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

/**
 * 편집전용 모드 — 외부 보고서에서 파싱한 blocks 를 프로젝트 탑라인 row 에
 * status='done', source='uploaded' 로 upsert(프로젝트당 1건). **생성 파이프라인
 * (Opus) 호출 없음** — 사용자가 외부에서 완성한 보고서를 그대로 영속하고 이후
 * 기존 편집 도구(edit_block/섹션 삽입/drag-to-ask)로 다듬는다.
 *
 * content_hash 는 현재 문서 셋 해시로 채워 stale 판정을 생성물과 정합시킨다
 * (문서가 없어도 안정 해시). blocks 는 파서가 부여한 blk_NN id 를 그대로 쓴다.
 * output_lang/user_direction/map_* 등 생성 전용 필드는 리셋(업로드는 무관).
 * row id 반환.
 */
export async function upsertImported(
  admin: AdminClient,
  opts: {
    orgId: string;
    projectId: string;
    hash: string;
    blocks: ClientToplineBlock[];
  },
): Promise<string> {
  const { orgId, projectId, hash, blocks } = opts;
  const { data, error } = await admin
    .from('interview_toplines')
    .upsert(
      {
        org_id: orgId,
        project_id: projectId,
        content_hash: hash,
        blocks: blocks as unknown as object,
        status: 'done',
        source: 'uploaded',
        error_message: null,
        // Opus 미호출 — 생성 모델 없음. 업로드 보고서임을 감사 로그에서 구분.
        model: null,
        generated_at: new Date().toISOString(),
        // 생성 전용 필드 리셋 — 업로드는 언어/방향/map-reduce 진행률과 무관.
        output_lang: null,
        user_direction: null,
        map_total: null,
        map_done: 0,
        phase: null,
        map_cursor: 0,
        resume_count: 0,
      },
      { onConflict: 'project_id' },
    )
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`upsertImported: ${error?.message ?? 'no_row'}`);
  }
  return data.id as string;
}

// streamObject 의 partialObjectStream 은 **검증되지 않은** 부분 객체를 흘린다
// (마지막 블록은 필드가 채워지는 중일 수 있음). 스트리밍 도중 안전하게 노출할 수
// 있는 "완성 접두 블록"만 골라낸다: 각 블록을 toplineBlockSchema 로 safeParse 해
// 성공하는 동안만 채우고, 첫 실패(= 아직 생성 중인 마지막 블록)에서 멈춘다.
// 접두만 유지하므로 index 기반 blk_NN id 가 스트리밍 내내 안정적으로 유지된다
// (중간 블록이 나중에 유효해지며 뒤 블록 id 를 밀어내는 일이 없음).
function completePrefixBlocks(rawBlocks: unknown[]): ToplineBlockRaw[] {
  const out: ToplineBlockRaw[] = [];
  for (const item of rawBlocks) {
    const parsed = toplineBlockSchema.safeParse(item);
    if (!parsed.success) break;
    out.push(parsed.data);
  }
  return out;
}

// 근거 chunk_id 집합에 대해 블록의 citations 를 재검증 — 지어낸 id 는 drop
// (v2/search reconstructCitations 원리). server 가 인용 무결성을 소유한다.
function verifyBlockCitations(
  blocks: ToplineBlockRaw[],
  validIds: Set<string>,
): ToplineBlock[] {
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

// ── durable 재개 상수 (카드 #434) ──────────────────────────────────────────
// 한 함수 호출(maxDuration=300s) 안에서 map 이 새 문서를 꺼내도 되는 마지노선.
// 이 soft-deadline 을 넘기면 진행 중 호출만 마치고 다음 홉으로 넘긴다 — 나머지
// (self-kick fetch + 최종 DB write)에 ~70s 여유를 남긴다.
const MAP_SOFT_DEADLINE_MS = 230_000;
// reduce(단일 Opus streamObject, ~100~140s)를 이 홉 안에서 시작하려면 남아 있어야
// 하는 최소 예산. 이보다 적으면 map 완료 후 reduce 를 다음 홉(신선한 300s)으로
// 미뤄 reduce 가 함수 킬에 잘리지 않게 한다.
const REDUCE_MIN_BUDGET_MS = 180_000;
// 홉의 하드 예산(참고) — 이 시각을 넘기면 새 무거운 작업(reduce)을 시작 안 함.
const HOP_HARD_BUDGET_MS = 290_000;
// self-kick 홉 최대 횟수 — 무한 재개 루프 방지 가드. 230s×30 ≈ 115분 총 예산이라
// 현실적 규모(수백 문서)도 완주하고, 넘으면 병리적 상황이라 stale-sweep 이 아니라
// 명시적 error 로 종료한다.
const MAX_RESUME_HOPS = 30;

// 재개 홉을 kick 할 배포 base URL — preview 는 자기 자신으로 라우팅되게
// deployment-specific VERCEL_URL 을 우선(transcripts/start 와 동일 패턴).
function getDeploymentBaseUrl(): string {
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  if (env.NEXT_PUBLIC_SITE_URL) return env.NEXT_PUBLIC_SITE_URL;
  return 'http://localhost:3000';
}

/** toplineId 로 row 를 직접 조회 — 재개 홉이 org/lang/상태/홉 카운터를 row 에서
 * 복원하는 데 쓴다(생성을 시작한 요청의 세션에 의존하지 않음). */
export async function getToplineById(
  admin: AdminClient,
  toplineId: string,
): Promise<InterviewToplineRow | null> {
  const { data } = await admin
    .from('interview_toplines')
    .select('*')
    .eq('id', toplineId)
    .maybeSingle();
  return (data as InterviewToplineRow | null) ?? null;
}

/**
 * 다음 재개 홉을 kick — 새 Vercel 함수 호출(신선한 300s)로 생성을 이어간다.
 * CRON_SECRET Bearer 로 인증된 내부 엔드포인트(/resume)를 호출한다(세션 없이도
 * 동작). 요청이 접수(202)될 때까지만 await 해 현재 함수가 죽기 전에 다음 홉이
 * 스케줄됐음을 보장하고 곧장 반환한다. 실패해도 치명적이지 않다 — row 는
 * generating 으로 남고, GET on-read stale-sweep(360s)이 잠금을 풀어 사용자가
 * 재생성으로 복구할 수 있다(map 은 캐시라 재개 비용 0).
 */
async function kickResume(toplineId: string, tag: string): Promise<void> {
  const base = getDeploymentBaseUrl();
  try {
    const res = await fetch(`${base}/api/interviews/v2/topline/resume`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.CRON_SECRET}`,
      },
      body: JSON.stringify({ topline_id: toplineId }),
      // kick 은 202 를 빨리 받는 가벼운 호출 — 무한 대기 방지 타임아웃.
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) console.warn(`${tag} resume kick non-ok`, res.status);
  } catch (e) {
    console.error(
      `${tag} resume kick failed`,
      e instanceof Error ? e.message : e,
    );
  }
}

/**
 * extract 캐시 + 문서 목록으로 reduce 입력(전 문서 DocExtractWithMeta[])을
 * 재구성. 캐시에 없는 문서(map 영구 실패 또는 홉 상한 강행 시 미완)는 빈
 * 추출(failed)로 채운다 — reduce 가 "그 응답자 근거 없음" 으로 표기하고
 * 파이프라인은 완주한다(단일-패스 시절과 동일한 부분 실패 처리).
 */
function buildExtractsFromCache(
  docs: ToplineDocument[],
  cached: Map<string, DocExtract>,
): DocExtractWithMeta[] {
  return docs.map((d) => {
    const hit = cached.get(d.document_id);
    if (hit) {
      return { ...hit, document_id: d.document_id, filename: d.filename };
    }
    return {
      themes: [],
      quotes: [],
      document_id: d.document_id,
      filename: d.filename,
      failed: true,
    };
  });
}

/**
 * map-reduce 로 탑라인 blocks 를 생성 — **durable 재개형**(카드 #434). 한 함수
 * 호출의 300초 벽 안에서 처리 가능한 만큼만 map 하고, 남은 작업이 있으면 스스로
 * 새 함수 호출(/resume)을 kick 해 이어간다. map 은 (document_id, content_hash)
 * 추출 캐시가 곧 커서라 재진입 시 완료분 재map 0.
 *
 *   map    : 미완 문서만 시간예산(MAP_SOFT_DEADLINE) 안에서 전용 Sonnet 호출로
 *            추출→캐시 저장(=커서 전진). 예산 소진 시 다음 홉으로 이어간다.
 *   reduce : 전 문서 map 완료 후 Opus 가 캐시된 전수 추출을 종합. 남은 예산이
 *            부족하면 reduce 를 신선한 홉으로 미뤄 함수 킬 잘림을 피한다.
 *
 * after()/resume 안에서 호출되므로 스스로 완결(예외를 밖으로 던지지 않음). row
 * 는 이미 upsertGenerating 으로 존재한다고 가정. 매 진행 update 가 updated_at
 * (heartbeat)을 bump 해 살아 있는 홉은 stuck 오판을 면한다.
 */
export async function runTopline(
  admin: AdminClient,
  opts: {
    toplineId: string;
    orgId: string;
    projectId: string;
    // 출력 언어(ko/en/ja/zh/es/th). 미지정 시 buildToplineSystem 이 옛 동작
    // (한국어)으로 fallback. reduce(최종 보고서)만 언어를 강제 — map 추출은 중립.
    outputLang?: string;
    // 재생성 방향(자유 텍스트). 미지정/빈 값이면 방향 절 없음(옛 동작). reduce
    // system prompt 에만 주입 — map 추출은 방향 무관(전 문서 중립 추출 유지).
    userDirection?: string;
  },
): Promise<void> {
  const startMs = Date.now();
  const { toplineId, orgId, projectId, outputLang, userDirection } = opts;
  const tag = `[v2/topline] ${projectId.slice(0, 8)}`;
  try {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('missing_anthropic_key');

    // 재개 홉 — row 로 현재 상태/홉 카운터 확보. status!=='generating' 이면
    // (취소/완료/다른 생성으로 대체) 이 홉을 조용히 종료해 유령 재개를 막는다.
    const row = await getToplineById(admin, toplineId);
    if (!row) {
      console.warn(`${tag} row gone — abort hop`);
      return;
    }
    if (row.status !== 'generating') {
      console.log(`${tag} status=${row.status} — abort hop`);
      return;
    }
    const resumeCount = row.resume_count ?? 0;

    // 재생성 보존 — 현재 row 의 사용자 삽입 블록(inserted_qa/inserted_section)을
    // 스냅샷해, 새 보고서로 blocks 를 덮어쓸 때(부분 flush + 최종 write) 다시
    // 합친다. upsertGenerating 은 이전 blocks 를 지우지 않고, map 단계는 blocks
    // 를 안 건드리므로 이 시점의 row.blocks = 직전 완료 보고서(삽입 포함)다.
    // reduce 의 매 flush 가 삽입 블록을 계속 포함시켜, 스트리밍 중에도 보이고
    // 재개 홉이 row 를 다시 읽어도 삽입분이 살아 있는다(누락 방지). 근거: 사용자
    // 핵심 요구 = 삽입 섹션이 재생성 후에도 유지.
    const preservedInserted = extractInsertedBlocks(
      (row.blocks ?? []) as ToplineBlock[],
    );

    // 홉 상한 초과 — 병리적 재개 루프(정상 프로젝트는 절대 도달 안 함). 무한
    // kick 을 끊고 error 로 명시 종료(사용자는 재생성으로 캐시 위에서 복구 가능).
    if (resumeCount > MAX_RESUME_HOPS) {
      console.error(`${tag} resume hops exhausted (${resumeCount}) — error`);
      await admin
        .from('interview_toplines')
        .update({ status: 'error', error_message: 'resume_exhausted' })
        .eq('id', toplineId);
      return;
    }

    // ── 전 문서 로드 (샘플링 X — 전수) ──
    const docs = await fetchDocumentsWithChunks(admin, orgId, projectId);
    if (docs.length === 0) {
      await admin
        .from('interview_toplines')
        .update({ status: 'error', error_message: 'no_chunks' })
        .eq('id', toplineId);
      return;
    }

    // 인용 재검증용 전체 chunk_id 집합(전수 — 샘플 아님).
    const validIds = new Set<string>();
    let totalChunks = 0;
    for (const d of docs) {
      for (const c of d.chunks) validIds.add(c.chunk_id);
      totalChunks += d.chunks.length;
    }

    const anthropic = createAnthropic({ apiKey });

    // ── MAP: 캐시(=커서) 기준으로 미완 문서만 시간예산 안에서 추출 ──
    // 진입 시 캐시된 문서 = 이전 홉들이 이미 map 한 것(재map 0 — LLM 0). 진행률
    // 분모 = 문서 수, 시작점 = 캐시 크기(재개해도 0 리셋 안 됨).
    let cached = await loadCachedExtracts(admin, orgId, docs);
    const cacheHits = cached.size; // 이 홉이 재사용한 완료 문서 수(재map 0 지표).
    await updateMapProgress(admin, toplineId, {
      map_total: docs.length,
      map_done: cached.size,
      map_cursor: cached.size,
      phase: 'map',
    });

    const pending = docs.filter((d) => !cached.has(d.document_id));
    let mapFailures = 0;

    if (pending.length > 0) {
      let liveDone = cached.size;
      const mapDeadline = startMs + MAP_SOFT_DEADLINE_MS;
      await runPoolUntil<ToplineDocument, void>(
        pending,
        MAP_CONCURRENCY,
        () => Date.now() >= mapDeadline,
        async (doc) => {
          // 문서별 재시도 1회 — 일시 provider 오류 흡수. 성공분만 캐시에 영속
          // (=커서 전진). 실패분은 캐시에 안 남겨 다음 홉에서 재시도되게 둔다.
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const extract = await mapDocument(anthropic, doc);
              await saveExtract(admin, orgId, doc, {
                themes: extract.themes,
                quotes: extract.quotes,
              });
              return;
            } catch (e) {
              if (attempt === 1) {
                mapFailures += 1;
                console.warn(
                  `${tag} map failed ${doc.filename}`,
                  e instanceof Error ? e.message : e,
                );
              }
            }
          }
        },
        async () => {
          // 진행 bump = heartbeat. 매 문서 갱신하되 DB update 는 단일 row 라 가볍다.
          liveDone += 1;
          await updateMapProgress(admin, toplineId, {
            map_done: liveDone,
            map_cursor: liveDone,
          });
        },
      );

      // 이 홉에서 실제 영속된 것 재계산(캐시 = 진실 — liveDone 은 실패 포함 근사).
      cached = await loadCachedExtracts(admin, orgId, docs);
      const stillPending = docs.filter((d) => !cached.has(d.document_id));
      await updateMapProgress(admin, toplineId, {
        map_done: cached.size,
        map_cursor: cached.size,
      });

      if (stillPending.length > 0) {
        // map 미완 — 시간예산 소진(대형 프로젝트) 또는 일부 문서 영구 실패. 홉
        // 상한 안이면 다음 홉으로 이어간다. 상한이면 남은 실패분을 빈 추출로 둔 채
        // reduce 를 강행해 파이프라인을 완주시킨다(무한 루프 방지).
        if (resumeCount < MAX_RESUME_HOPS) {
          console.log(`${tag} map hop`, {
            cursor: cached.size,
            total: docs.length,
            still_pending: stillPending.length,
            hop: resumeCount,
            cache_hits: cacheHits,
            map_failures: mapFailures,
          });
          await admin
            .from('interview_toplines')
            .update({ resume_count: resumeCount + 1 })
            .eq('id', toplineId);
          await kickResume(toplineId, tag);
          return;
        }
        console.warn(
          `${tag} map incomplete at hop cap — forcing reduce ${cached.size}/${docs.length}`,
        );
      }
    }

    // map 전수 완료(또는 상한 강행) — reduce 로. 남은 예산이 reduce 최소치보다
    // 적으면 reduce 를 신선한 홉으로 미뤄 함수 킬 잘림을 피한다.
    const remaining = HOP_HARD_BUDGET_MS - (Date.now() - startMs);
    if (remaining < REDUCE_MIN_BUDGET_MS && resumeCount < MAX_RESUME_HOPS) {
      console.log(`${tag} map complete — reduce deferred to fresh hop`, {
        remaining_ms: remaining,
        hop: resumeCount,
      });
      await updateMapProgress(admin, toplineId, {
        phase: 'reduce',
        map_done: cached.size,
        map_cursor: cached.size,
      });
      await admin
        .from('interview_toplines')
        .update({ resume_count: resumeCount + 1 })
        .eq('id', toplineId);
      await kickResume(toplineId, tag);
      return;
    }

    await updateMapProgress(admin, toplineId, { phase: 'reduce' });

    // 빠짐없음 정량 로그 — map 은 전 문서를 읽으므로 doc coverage = 1.0.
    // cache_hits = 이전 홉들이 남긴 재사용분(재map 0 회귀 검증 지표).
    console.log(`${tag} map done`, {
      docs: docs.length,
      chunks_read: totalChunks,
      cache_hits: cacheHits,
      mapped_llm: cached.size - cacheHits,
      map_failures: mapFailures,
      doc_coverage: 1, // 전 문서 순회 — 구조적 유실 0 (카드 #430 핵심 지표)
    });

    // reduce 입력 — 캐시에서 전수 추출 재구성(성공분 + 실패분 빈 추출).
    const extracts = buildExtractsFromCache(docs, cached);

    // ── REDUCE: Opus 가 전수 추출을 종합 (streamObject — 부분 블록 증분 노출) ──
    // 예전엔 generateObject(blocking) 라 reduce(대량 보고서 생성)가 끝날 때까지
    // 완전 무반응 → 사용자가 "멈춘 것"으로 오인했다. streamObject 로 바꿔
    // partialObjectStream 으로 블록이 완성되는 대로 interview_toplines.blocks 에
    // throttle 증분 upsert → realtime 이 부분 보고서를 push, 클라가 점진 렌더한다.
    const reduceEvidence = formatExtractsForReduce(extracts);
    const stream = streamObject({
      model: anthropic(TOPLINE_MODEL),
      schema: toplineSchema,
      system: `${buildToplineSystem(outputLang, userDirection)}${TOPLINE_REDUCE_NOTICE}\n\n## 근거 (전 응답자 ${docs.length}명 전수 추출)\n${reduceEvidence}`,
      prompt: `위는 이 프로젝트의 응답자 ${docs.length}명을 한 명도 빠짐없이 순회해 뽑은 주제·인용 추출입니다. 이를 종합해 깊이 있는 탑라인 보고서를 블록 배열로 작성하세요. **맨 첫 블록은 executive_summary(리치 요약 문단 4~6문장 + 핵심 포인트 3~5)** 로 시작하고, 이어서 핵심 요약 → 코퍼스에서 도출한 주제별 섹션들 → 교차분석 인사이트 → 시사점 순으로, 각 섹션을 subheading + paragraph(불릿 병행) 로 2단 계층으로 전개하고, 주장 뒤에 quote 를 문맥 중간에 삽입하며, table + chart/pie 를 유기적으로 배치합니다. **집계 수치("N명 중 M명")는 위 ${docs.length}명 추출을 직접 세어** 산출하고(추정 금지), 모든 사실 블록에 근거 chunk_id 를 답니다. 이전보다 훨씬 길고 상세하게.`,
      temperature: 0.3,
      // 긴 보고서(10 섹션 + 서브헤더 + 아티팩트)라 출력 예산을 대폭 상향해 잘림
      // (finishReason='length')을 방지한다. Opus 4.8 는 큰 출력을 지원한다.
      maxOutputTokens: 32_000,
      maxRetries: 1,
      providerOptions: ZERO_RETENTION,
    });

    // 부분 블록 증분 upsert — realtime/DB 쓰기 폭주를 막으려 throttle 한다.
    // 완성(스키마 통과)된 접두 블록만 쓰고 마지막 미완 블록은 보류(graceful).
    // 첫 완성 블록은 즉시 써서 무반응 구간을 최소화하고, 재생성 시 이전 보고서
    // blocks 를 새 부분본으로 빠르게 교체한다. 이후 쓰기는 interval throttle.
    const REDUCE_WRITE_INTERVAL_MS = 1500;
    let lastWriteAt = 0;
    let lastWrittenCount = -1;
    const flushPartialBlocks = async (rawBlocks: unknown[]): Promise<void> => {
      const complete = completePrefixBlocks(rawBlocks);
      if (complete.length === 0) return; // 아직 완성 블록 없음.
      const now = Date.now();
      const first = lastWrittenCount < 0;
      if (
        !first &&
        (complete.length === lastWrittenCount ||
          now - lastWriteAt < REDUCE_WRITE_INTERVAL_MS)
      ) {
        return; // 블록 수 변화 없음 또는 throttle 창 안 — skip.
      }
      lastWriteAt = now;
      lastWrittenCount = complete.length;
      // 새 생성 블록 + 보존 삽입 블록(끝에 append) — 스트리밍 내내 삽입분 유지.
      const partial = mergeInsertedBlocks(
        verifyBlockCitations(complete, validIds),
        preservedInserted,
      );
      const { error } = await admin
        .from('interview_toplines')
        .update({ blocks: partial as unknown as object })
        .eq('id', toplineId);
      // 부분 upsert 는 best-effort — 실패해도 다음 flush/최종 done 이 만회한다.
      if (error) console.warn(`${tag} partial blocks upsert failed`, error.message);
    };

    for await (const partial of stream.partialObjectStream) {
      const rawBlocks = Array.isArray(partial?.blocks) ? partial.blocks : [];
      await flushPartialBlocks(rawBlocks);
    }

    // 스트림 종료 — 검증된 최종 객체 + finishReason 확보(예외는 상위 catch 로).
    const finalObject = await stream.object;
    const finishReason = await stream.finishReason;

    const blocks = verifyBlockCitations(finalObject?.blocks ?? [], validIds);
    const citedTotal = blocks.reduce(
      (n, b) => n + ('citations' in b ? b.citations.length : 0),
      0,
    );
    // 최종 블록이 인용한 고유 문서 수 — 종합이 얼마나 많은 응답자를 실제로
    // 근거로 삼았는지(전수 대비). map 이 전 문서를 읽어도 reduce 가 인용을
    // 몇 개 문서에 걸쳐 다는지는 별개라 함께 로그.
    const citedDocs = new Set<string>();
    const chunkToDoc = new Map<string, string>();
    for (const d of docs) for (const c of d.chunks) chunkToDoc.set(c.chunk_id, d.document_id);
    for (const b of blocks) {
      if ('citations' in b) {
        for (const c of b.citations) {
          const docId = chunkToDoc.get(c);
          if (docId) citedDocs.add(docId);
        }
      }
    }
    // 잘림 방지: 예산을 크게 잡았지만 그래도 length 로 끝나면 (희귀) 로그로
    // 남긴다. generateObject 는 스키마 검증을 통과한 블록만 반환하므로 부분
    // 결과라도 유효한 블록은 보존된다(보수적 — 별도 2-pass 이어쓰기는 후속).
    if (finishReason === 'length') {
      console.warn(`${tag} finishReason=length — output may be truncated`, {
        blocks: blocks.length,
      });
    }
    console.log(`${tag} done`, {
      blocks: blocks.length,
      citations: citedTotal,
      cited_docs: citedDocs.size,
      total_docs: docs.length,
      cited_doc_coverage: docs.length ? citedDocs.size / docs.length : 0,
      finishReason,
    });

    // 최종 blocks = 새 생성분 + 보존 삽입분(재생성해도 사용자 삽입 유지).
    const finalBlocks = mergeInsertedBlocks(blocks, preservedInserted);
    await admin
      .from('interview_toplines')
      .update({
        status: 'done',
        blocks: finalBlocks as unknown as object,
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

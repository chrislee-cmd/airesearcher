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
  runPool,
  formatExtractsForReduce,
  docExtractSchema,
  MAP_CONCURRENCY,
  TOPLINE_MAP_MODEL,
  type DocExtract,
  type DocExtractWithMeta,
} from '@/lib/interview-v2/topline-map';
import { isEditableToplineBlockType } from '@/lib/interview-v2/types';

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
  blocks: ToplineBlock[];
  status: 'idle' | 'generating' | 'done' | 'error';
  error_message: string | null;
  model: string | null;
  generated_at: string | null;
  // map-reduce 진행률 — map_total = 이번 생성이 순회하는 문서 수(null=레거시),
  // map_done = 완료된 문서 수. UI 가 generating 중 "N/M 문서 분석" 을 그린다.
  map_total: number | null;
  map_done: number | null;
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

/** 탑라인 row 의 map 진행률 갱신 — realtime 으로 "N/M 문서 분석" 을 노출. */
async function updateMapProgress(
  admin: AdminClient,
  toplineId: string,
  patch: { map_total?: number; map_done?: number },
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
  opts: { orgId: string; projectId: string; hash: string; outputLang?: string },
): Promise<string> {
  const { orgId, projectId, hash, outputLang } = opts;
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
        status: 'generating',
        error_message: null,
        model: TOPLINE_MODEL,
        // 진행률 리셋 — 이번 생성의 map 이 아직 시작 전(runTopline 이 문서 수를
        // 알면 map_total 을 채운다). 이전 생성의 진행률이 남지 않게 0/null 로.
        map_total: null,
        map_done: 0,
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

/**
 * map-reduce 로 탑라인 blocks 를 생성해 row 를 'done' 으로 갱신. 실패 시 'error'.
 *
 *   map    : 모든 문서(응답자)를 전용 Sonnet 호출로 전문 추출(themes/quotes).
 *            (document_id, content_hash) 캐시 히트는 LLM 0. 동시성 제한 풀 +
 *            문서별 재시도 1회, 그래도 실패하면 빈 추출로 대체(그 응답자는
 *            근거 없음으로 reduce 에 표기 — 파이프라인은 완주).
 *   reduce : Opus 가 N개 문서 추출을 **모두** 받아 종합(전수 위 실제 카운트).
 *
 * after() 안에서 호출되므로 스스로 완결(예외를 밖으로 던지지 않음). row 는 이미
 * upsertGenerating 으로 존재한다고 가정.
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
  },
): Promise<void> {
  const { toplineId, orgId, projectId, outputLang } = opts;
  const tag = `[v2/topline] ${projectId.slice(0, 8)}`;
  try {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('missing_anthropic_key');

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

    // 진행률 분모 = 문서 수. map 이 도는 동안 realtime 으로 "k/N" 노출.
    await updateMapProgress(admin, toplineId, {
      map_total: docs.length,
      map_done: 0,
    });

    // ── MAP: 문서별 추출 (캐시 → 없으면 LLM, 동시성 제한, 재시도 1회) ──
    const cached = await loadCachedExtracts(admin, orgId, docs);
    let mapped = 0;
    let cacheHits = 0;
    let mapFailures = 0;

    const extracts = await runPool<ToplineDocument, DocExtractWithMeta>(
      docs,
      MAP_CONCURRENCY,
      async (doc) => {
        const hit = cached.get(doc.document_id);
        if (hit) {
          cacheHits += 1;
          return { ...hit, document_id: doc.document_id, filename: doc.filename };
        }
        // 문서별 재시도 1회 — 일시적 provider 오류 흡수. 그래도 실패하면 빈
        // 추출로 대체해 파이프라인을 완주시킨다(그 응답자만 근거 없음 표기).
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const extract = await mapDocument(anthropic, doc);
            await saveExtract(admin, orgId, doc, {
              themes: extract.themes,
              quotes: extract.quotes,
            });
            return extract;
          } catch (e) {
            if (attempt === 1) {
              mapFailures += 1;
              console.warn(
                `${tag} map failed ${doc.filename}`,
                e instanceof Error ? e.message : e,
              );
              return {
                themes: [],
                quotes: [],
                document_id: doc.document_id,
                filename: doc.filename,
                failed: true,
              };
            }
          }
        }
        // 도달 불가(위 루프가 항상 반환) — 타입 만족용.
        return {
          themes: [],
          quotes: [],
          document_id: doc.document_id,
          filename: doc.filename,
          failed: true,
        };
      },
      async (done) => {
        mapped = done;
        // 진행률은 자주 쓰면 realtime 트래픽이 커지므로 매 문서 갱신하되 DB
        // update 는 가볍다(단일 row). 대량이면 이 정도 빈도는 무해.
        await updateMapProgress(admin, toplineId, { map_done: done });
      },
    );

    // 빠짐없음 정량 로그 — map 은 전 문서를 읽으므로 doc coverage = 1.0,
    // chunk 도 전량(샘플링 0). top-K/예산샘플 대비 유실 0 을 수치로 남긴다.
    console.log(`${tag} map done`, {
      docs: docs.length,
      chunks_read: totalChunks,
      cache_hits: cacheHits,
      mapped_llm: mapped - cacheHits,
      map_failures: mapFailures,
      doc_coverage: 1, // 전 문서 순회 — 구조적 유실 0 (카드 #430 핵심 지표)
    });

    // ── REDUCE: Opus 가 전수 추출을 종합 (streamObject — 부분 블록 증분 노출) ──
    // 예전엔 generateObject(blocking) 라 reduce(대량 보고서 생성)가 끝날 때까지
    // 완전 무반응 → 사용자가 "멈춘 것"으로 오인했다. streamObject 로 바꿔
    // partialObjectStream 으로 블록이 완성되는 대로 interview_toplines.blocks 에
    // throttle 증분 upsert → realtime 이 부분 보고서를 push, 클라가 점진 렌더한다.
    const reduceEvidence = formatExtractsForReduce(extracts);
    const stream = streamObject({
      model: anthropic(TOPLINE_MODEL),
      schema: toplineSchema,
      system: `${buildToplineSystem(outputLang)}${TOPLINE_REDUCE_NOTICE}\n\n## 근거 (전 응답자 ${docs.length}명 전수 추출)\n${reduceEvidence}`,
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
      const partial = verifyBlockCitations(complete, validIds);
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

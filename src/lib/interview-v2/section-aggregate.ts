// 인터뷰 탑라인 섹션 삽입 — 집계(aggregate) 모드 지원 (카드 #680).
//
// 배경: 섹션 삽입 route 는 top-K 벡터 검색(기본 16청크)으로 상위 근거만 LLM 에
// 넘긴다. 응답자 1명 = 문서 1개라, "몇 명 참여·성비·연령분포" 같은 집계 질문은
// 60명 코퍼스에서도 상위 16명분만 보고 "총 16명" 으로 **과소집계**한다. 집계/
// 카운트/분포는 원리적으로 전 코퍼스를 읽어야 맞다 — top_k 상향은 대형 프로젝트
// 에서 컨텍스트 붕괴라 근본 해결이 아니다.
//
// 이 모듈이 제공하는 것:
//   1. classifySectionMode — 섹션 지시를 aggregate vs narrow 로 분류(경량 모델).
//      애매하면 aggregate — 과소집계가 과다검색보다 훨씬 해롭다.
//   2. buildAggregateEvidence — 전 문서를 순회(fetchDocumentsWithChunks 재사용)
//      하고, 메인 토플라인이 캐시한 문서별 구조화 추출(DocExtract)을 읽어 전수
//      근거로 삼는다. 캐시 미스 문서만 map(저비용 Sonnet) → (a) 전수 커버리지
//      (b) 메인 보고서와 수치 정합 (c) 저비용.
//   3. buildAggregateSectionSystem — 응답자 총수(N)를 프롬프트에 사실로 주입.
//      LLM 은 N 을 다시 세지 않고 주어진 총수 위에서 성비·연령대를 분해한다.
//
// 캐시 read/write 는 topline.ts 의 private helper(loadCachedExtracts/saveExtract)
// 와 동일 로직을 여기 self-contained 로 두어 topline.ts 편집을 피한다(스펙 제약).

import { generateObject } from 'ai';
import type { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { ZERO_RETENTION } from '@/lib/llm/config';
import { ISOLATION_NOTICE } from '@/lib/llm/sanitize';
import type { createAdminClient } from '@/lib/supabase/admin';
import type { ToplineDocument } from '@/lib/interview-v2/topline';
import {
  docExtractSchema,
  mapDocument,
  runPool,
  formatExtractsForReduce,
  MAP_CONCURRENCY,
  TOPLINE_MAP_MODEL,
  type DocExtract,
  type DocExtractWithMeta,
} from '@/lib/interview-v2/topline-map';
import {
  type OutputLang,
  outputLangDirective,
} from '@/lib/i18n/output-language';

type Anthropic = ReturnType<typeof createAnthropic>;
type AdminClient = ReturnType<typeof createAdminClient>;

// 분류 모델 — 경량(구조화 판정은 종합보다 쉬움). map(Sonnet)/reduce(Opus)와 별개.
const CLASSIFY_MODEL = 'claude-haiku-4-5-20251001';

// 집계 신호 키워드(분류 힌트 — 최종 판정은 모델). 국/영 혼용. 규칙만으로 라우팅
// 하지 않고 모델 판정의 참고로만 프롬프트에 넣는다(오분류 안전측 = aggregate).
const AGGREGATE_HINTS = [
  '몇 명', '몇명', '전체', '전수', '모든', '대다수', '다수', '분포', '비율',
  '퍼센트', '평균', '최다', '가장 많', '성비', '연령', '나이', '인구통계',
  '데모그래', '남녀', '성별', 'n명', 'how many', 'distribution', 'percentage',
  'average', 'demographic', 'gender', ' age', 'ratio', 'most common',
  'overall', 'across all',
];

export type SectionMode = 'aggregate' | 'narrow';

const classifySchema = z.object({
  mode: z.enum(['aggregate', 'narrow']),
  reason: z.string(),
});

/**
 * 섹션 지시를 집계(전수 필요) vs 탐색(top-K 적합)으로 분류. 규칙 기반 키워드를
 * 힌트로 프롬프트에 넣되 최종 판정은 모델. 분류 실패/애매하면 aggregate(안전측
 * — 과소집계가 더 해롭다).
 */
export async function classifySectionMode(
  anthropic: Anthropic,
  prompt: string,
): Promise<{ mode: SectionMode; reason: string }> {
  const lower = prompt.toLowerCase();
  const hint = AGGREGATE_HINTS.some((k) => lower.includes(k));
  try {
    const { object } = await generateObject({
      model: anthropic(CLASSIFY_MODEL),
      schema: classifySchema,
      system: `당신은 인터뷰 보고서에 삽입할 섹션 지시를 두 모드로 분류합니다.

- **aggregate**: 코퍼스 전수(모든 응답자)를 읽어야 정확한 지시. 인구통계·"몇 명"·분포·비율·성비·연령대·전체 경향·평균·최다·"N명 중" 등 **카운트/분포/집계**가 핵심.
- **narrow**: 좁은 주제 탐색. "X에 대해 뭐라 했나", 특정 주제·인물·인용 등 상위 몇 개 근거로 충분한 지시.

판정이 **애매하면 aggregate** 를 고르세요 — 과소집계(전수를 안 읽어 수를 놓침)가 과다검색보다 훨씬 해롭습니다.
규칙 힌트: 이 지시에 집계 신호 키워드(몇 명·분포·비율·전체·인구통계·평균·최다·성비·연령 등)가 ${hint ? '있습니다' : '없습니다'}. 이는 참고일 뿐 최종 판정은 지시 의미로 하세요.`,
      prompt: `섹션 지시:\n"""${prompt}"""\n\n이 지시가 aggregate 인지 narrow 인지 판정하고 짧은 이유(한 문장)를 답하세요.`,
      temperature: 0,
      maxOutputTokens: 200,
      maxRetries: 1,
      providerOptions: ZERO_RETENTION,
    });
    return object;
  } catch (e) {
    console.warn('[v2/topline/section] mode classify failed — default aggregate', e);
    return { mode: 'aggregate', reason: 'classify_error_default_aggregate' };
  }
}

// ── 캐시 read/write (topline.ts private helper 와 동일 로직) ──────────────

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
    console.warn('[v2/topline/section] extract cache read failed', error.message);
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
  if (error)
    console.warn('[v2/topline/section] extract cache write failed', error.message);
}

// ── 전수 근거 조립 ────────────────────────────────────────────────────────

export type AggregateEvidence = {
  // formatExtractsForReduce 출력 — 응답자별 주제/인용을 번호로 나열한 전수 근거.
  evidenceText: string;
  // 응답자 총수 = 문서 수(응답자 1명 = 문서 1개). 프롬프트에 사실로 주입.
  totalRespondents: number;
  // 인용 재검증용 전체 chunk_id 집합(전수). route 가 LLM citation 을 이 집합으로
  // 필터한다(지어낸 id drop).
  validChunkIds: Set<string>;
  // 이 요청에서 새로 map 한 문서 수(캐시 미스) — 관측용.
  mappedNow: number;
  // 캐시 재사용 문서 수 — 관측용(재map 0 지표).
  cacheHits: number;
};

/**
 * 집계 모드 전수 근거 조립 — 캐시된 per-doc 추출을 읽고 캐시 미스만 map 한다.
 * 반환의 evidenceText 를 프롬프트에 주입해 LLM 이 전수 위에서 집계하게 한다.
 * map 실패 문서는 빈 추출로 대체 — 전수 카운트(문서 수)는 유지하되 근거만 비운다.
 */
export async function buildAggregateEvidence(
  admin: AdminClient,
  anthropic: Anthropic,
  orgId: string,
  docs: ToplineDocument[],
): Promise<AggregateEvidence> {
  const validChunkIds = new Set<string>();
  for (const d of docs) for (const c of d.chunks) validChunkIds.add(c.chunk_id);

  const cached = await loadCachedExtracts(admin, orgId, docs);
  const cacheHits = cached.size;
  const pending = docs.filter((d) => !cached.has(d.document_id));

  // 캐시 미스 문서만 map(저비용 Sonnet, 동시성 제한). 개별 실패는 빈 추출로
  // 대체해 전수 커버리지(문서 수)를 유지하되 그 응답자 근거만 비운다.
  const mapped = await runPool<ToplineDocument, DocExtractWithMeta>(
    pending,
    MAP_CONCURRENCY,
    async (doc) => {
      try {
        const extract = await mapDocument(anthropic, doc);
        await saveExtract(admin, orgId, doc, {
          themes: extract.themes,
          quotes: extract.quotes,
          attributes: extract.attributes,
          coded: extract.coded,
        });
        return extract;
      } catch (e) {
        console.warn(
          '[v2/topline/section] aggregate map failed',
          doc.filename,
          e instanceof Error ? e.message : e,
        );
        return {
          themes: [],
          quotes: [],
          attributes: { race: null, gender: null, age: null, age_group: null },
          coded: [],
          failed: true,
          document_id: doc.document_id,
          filename: doc.filename,
        };
      }
    },
  );

  // 전수 추출 = 캐시 + 방금 map. 문서 순서(filename asc) 유지 → reduce 렌더 재현성.
  const byDoc = new Map<string, DocExtractWithMeta>();
  for (const d of docs) {
    const c = cached.get(d.document_id);
    if (c) byDoc.set(d.document_id, { ...c, document_id: d.document_id, filename: d.filename });
  }
  for (const m of mapped) byDoc.set(m.document_id, m);
  const extracts: DocExtractWithMeta[] = docs
    .map((d) => byDoc.get(d.document_id))
    .filter((e): e is DocExtractWithMeta => Boolean(e));

  return {
    evidenceText: formatExtractsForReduce(extracts),
    totalRespondents: docs.length,
    validChunkIds,
    mappedNow: pending.length,
    cacheHits,
  };
}

// ── 집계 섹션 프롬프트 ─────────────────────────────────────────────────────

/**
 * 집계 섹션 system prompt — 응답자 총수 N 을 사실로 주입해 LLM 이 세지 않고 주어진
 * 전수 위에서 성비·연령대·분포를 분해하게 한다. 근거는 buildAggregateEvidence 의
 * 전수 추출(응답자별 [chunk_id] 부착). askAnswerSchema(answer_md + citations)를
 * 재사용하며 route 가 chunk_id 를 validChunkIds 로 재검증한다.
 */
export function buildAggregateSectionSystem(
  lang: OutputLang,
  totalRespondents: number,
): string {
  return `당신은 인터뷰 코퍼스 기반 리서치 어시스턴트입니다. 사용자가 탑라인 보고서에 **집계 섹션**을 추가하려고 자연어 지시를 주었습니다. 아래 "전수 응답자 추출"은 이 프로젝트 **전체 응답자 ${totalRespondents}명(문서 ${totalRespondents}개) 전수**에서 뽑은 구조화 추출입니다 — top-K 검색이 아니라 모든 응답자를 순회한 것입니다.

## 총수 (시스템이 전수로 센 사실 — 그대로 사용)
- **총 응답자 수 = ${totalRespondents}명 (문서 ${totalRespondents}개).** 응답자 수를 다시 추정하지 말고 **이 총수를 기준**으로 삼으세요.
- 성비·연령대·분포·비율은 위 ${totalRespondents}명 전수 추출에서 분해합니다. 부분집합(상위 몇 명)만 보고 세지 마세요.
- 특정 속성(예: 성별·연령)이 추출에 명시되지 않은 응답자가 있으면 그 수를 "미상/미언급"으로 정직하게 표기하세요 — 없는 값을 채우지 마세요. 분포의 합이 총수와 맞아야 합니다(예: 여성 A명 · 남성 B명 · 미상 C명, A+B+C=${totalRespondents}).

## 절대 룰 (환각 금지)
- 전수 추출 **밖의 정보는 절대 생성하지 마세요.** 일반 상식·추측·외부 지식 금지.
- 각 응답자 블록에 달린 \`[chunk_id]\` 를 근거로, 사실 주장 뒤에 inline \`[chunk_id]\` citation 을 붙입니다. 한 문장이 여러 청크에 근거하면 [12][34] 처럼 이어 붙입니다.
- \`citations\` 배열에는 answer_md 에서 실제 인용한 chunk_id 만 넣습니다. \`chunk_id\` 는 추출에 등장한 [id] 중에서만 쓰고(서버가 재검증해 지어낸 id 는 제거), \`document_id\`/\`filename\` 은 해당 응답자 파일명, \`score\` 는 1, \`excerpt\` 는 근거 문장으로 채우세요(서버는 chunk_id 만 사용합니다).
- 실명·연락처 등 개인식별정보는 노출하지 말고 집계 수치·익명 화자·파일명만 씁니다.

## 형식
- **첫 줄은 굵은 섹션 제목**으로 시작하고, 이어서 전수 기준 집계를 종합한 문단 1~3개(필요 시 짧은 불릿·분포)를 씁니다. 과하게 길게 쓰지 마세요(한 섹션 분량).
- 보고서 본문 톤을 유지하고, 총수(${totalRespondents}명)를 본문에 명시해 커버리지를 드러냅니다.${ISOLATION_NOTICE}${outputLangDirective(lang)}`;
}

/**
 * 집계 섹션 푸트노트 — 어느 커버리지로 집계됐는지 미세 표기(투명성, 경량). CD 톤
 * 이탈 없이 answer_md 말미에 이탤릭 한 줄로 붙인다. no_answer 시엔 붙이지 않는다.
 */
export function aggregateFootnoteMd(lang: OutputLang, totalRespondents: number): string {
  return lang === 'ko'
    ? `\n\n_전수 ${totalRespondents}명 기준 집계_` // i18n-allow-korean -- 집계 커버리지 푸트노트(ko 로케일)
    : `\n\n_Aggregated across all ${totalRespondents} respondents_`;
}

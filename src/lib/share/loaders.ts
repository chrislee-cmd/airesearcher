// 공개 공유 로더 — 산출물 통합(narrow-waist)으로 편입된 3타입(transcript /
// ut_insight / desk_report)의 공개 본문 + 기존 2타입(interview_topline /
// probing_persona) 위임을 한 진입점으로 묶는다.
//
// 흐름: loadSharedResource(admin, token, viewerEmail)
//   1) assertInvitedViewer 재사용 — 토큰 존재 → revoke → 만료 → allow-list
//      (기존 게이트 로직 복제 금지).
//   2) 게이트 통과 시 service_role(admin)로 resource_type 별 본문을 최소 컬럼만
//      read-only 조회.
//
// 범위 경계(pr-shared-views-extend-deliverables): 뷰어 페이지/렌더 UI 는 이 PR
// 이 아니라 share-shell PR 소유 — 여기서 돌려주는 read-only shape 를 그쪽이
// 받아 그린다. 편집/재생성/자유검색 API 는 이 경로에 절대 노출하지 않는다.
//
// - 시그니처: 스펙은 loadSharedResource(token) 이지만, allow-list 게이트가
//   뷰어 이메일을 필수로 요구하므로 (admin, token, viewerEmail) 로 구현한다
//   (기존 assertInvitedViewer 재사용 — 보수적 해석).
// - DECISIONS D2: 반환 attribution 은 sharedAt·expiresAt 만 — 공유자 실명 없음.
// - PII: ut insight_summary/clips 는 저장 시 maskSensitiveDeep 적용본 그대로,
//   transcript 는 공유자 책임 모델(기존 topline/probing 과 동일)로 추가 마스킹
//   없음. ut 클립 영상 signed URL 은 발급하지 않는다(공개 영상 노출은
//   share-shell PR 의 별도 판단) — 클립은 텍스트 메타만 반환.

import type { SupabaseClient } from '@supabase/supabase-js';
import { assertInvitedViewer, type ShareResourceType } from './shared-views';
import { loadShareResource, type ShareResource } from './viewer-resource';
import {
  normalizeGender,
  toAgeBucket,
  pivotGenderAgePairs,
  type DistributionTable,
} from '@/lib/recruiting/distribution';
import type { RecruitingBrief } from '@/lib/recruiting-schema';
import {
  labelTranscriptMarkdown,
  parseTranscriptTurns,
  type TranscriptTurn,
  type TranscriptTurnsSource,
} from '@/lib/transcripts/turns';
import { selectWithInferredFallback } from '@/lib/transcripts/jobs-select';

export type SharedTranscript = {
  type: 'transcript';
  turns: TranscriptTurn[];
  meta: {
    filename: string | null;
    durationSeconds: number | null;
    speakers: number | null;
    provider: string | null;
  };
};

export type SharedUtInsightClip = {
  startMs: number;
  endMs: number;
  theme: string | null;
  transcriptSpan: string | null;
  // 클립별 분석(마스킹된 저장본). 영상 signed URL 은 포함하지 않는다.
  insight: Record<string, unknown> | null;
};

export type SharedUtInsight = {
  type: 'ut_insight';
  targetUrl: string | null;
  durationMs: number | null;
  insightSummary: Record<string, unknown> | null;
  clips: SharedUtInsightClip[];
};

export type SharedDeskReport = {
  type: 'desk_report';
  output: string;
  keywords: string[];
  locale: string | null;
  sources: string[];
};

/** 부합도 분포 — 개별 응답자 행 없이 카운트만(집계). */
export type SharedRecruitingFit = {
  high: number;
  medium: number;
  low: number;
  // 판단은 됐으나 fit 이 null 인 응답자(폼에 참여자 조건 미설정, 또는 근거
  // 불명확). total 에는 포함.
  unknown: number;
  total: number;
};

/**
 * 리크루팅 읽기전용 공유 공개 본문 — **집계·요약만**. 개별 응답자 행·이름·
 * 연락처·이메일·자유응답 원문·부합도 근거 인용문은 일절 포함하지 않는다
 * (스펙 PII 하드 규칙). criteria 는 발주자가 작성한 조건이라 응답자 PII 가
 * 아니지만, detail(자유 서술)은 빼고 category/label/required 만 노출한다.
 */
export type SharedRecruitingSummary = {
  type: 'recruiting_summary';
  title: string;
  createdAt: string | null;
  // 발주자 한 줄 요약(조건 패널). 응답자 데이터 아님.
  summary: string | null;
  criteria: Array<{ category: string; label: string; required: boolean }>;
  // 성별×연령 크로스탭 — 카운트만. gender/age 축이 전혀 없으면 null.
  distribution: DistributionTable | null;
  fit: SharedRecruitingFit;
};

/** 6타입 통합 공개 본문. 기존 2타입은 viewer-resource 의 ShareResource 재사용. */
export type SharedResourceBody =
  | ShareResource
  | SharedTranscript
  | SharedUtInsight
  | SharedDeskReport
  | SharedRecruitingSummary;

export type LoadSharedResourceResult =
  | {
      ok: true;
      resourceType: ShareResourceType;
      // DECISIONS D2 — 공유일 + 만료만(공유자 실명 없음).
      sharedAt: string;
      expiresAt: string | null;
      resource: SharedResourceBody;
    }
  | { ok: false; status: 403 | 404; reason: string };

/**
 * 토큰 게이트 통과 후 resource_type 별 공개 본문을 반환한다. 원본이 이미
 * 삭제됐거나(dangling 공유) 미완성이면 404(데이터 노출 0).
 */
export async function loadSharedResource(
  admin: SupabaseClient,
  token: string,
  viewerEmail: string,
): Promise<LoadSharedResourceResult> {
  const gate = await assertInvitedViewer(admin, token, viewerEmail);
  if (!gate.ok) return { ok: false, status: gate.status, reason: gate.reason };

  const { resource_type, resource_id, shared_at, expires_at } = gate.share;
  const resource = await loadBody(admin, resource_type, resource_id);
  if (!resource) return { ok: false, status: 404, reason: 'not_found' };

  return {
    ok: true,
    resourceType: resource_type,
    sharedAt: shared_at,
    expiresAt: expires_at,
    resource,
  };
}

async function loadBody(
  admin: SupabaseClient,
  resourceType: ShareResourceType,
  resourceId: string,
): Promise<SharedResourceBody | null> {
  switch (resourceType) {
    case 'interview_topline':
    case 'probing_persona':
      return loadShareResource(admin, resourceType, resourceId);
    case 'transcript':
      return loadTranscript(admin, resourceId);
    case 'ut_insight':
      return loadUtInsight(admin, resourceId);
    case 'desk_report':
      return loadDeskReport(admin, resourceId);
    case 'recruiting_summary':
      return loadRecruitingSummary(admin, resourceId);
    default:
      return null;
  }
}

async function loadTranscript(
  admin: SupabaseClient,
  id: string,
): Promise<SharedTranscript | null> {
  // turns 라우트와 동일한 select(+optional 컬럼 fallback) → 같은 turn 스트림.
  const baseColumns =
    'filename, markdown, clean_markdown, speaker_roles, provider, status, duration_seconds, speakers_count';
  const { data: job, error } = await selectWithInferredFallback<Record<string, unknown>>(
    async (cols) => {
      const r = await admin.from('transcript_jobs').select(cols).eq('id', id).single();
      return {
        data: r.data as Record<string, unknown> | null,
        error: r.error as { code?: string; message?: string } | null,
      };
    },
    baseColumns,
  );
  if (error || !job) return null;
  // 완료본만 — 발급 게이트(done)와 이중으로, 공유 후 원본이 되돌아간 경우도 방어.
  if (job.status !== 'done' || !job.markdown) return null;

  const turns = parseTranscriptTurns(
    labelTranscriptMarkdown(job as unknown as TranscriptTurnsSource, 'clean'),
  );
  return {
    type: 'transcript',
    turns,
    meta: {
      filename: (job.filename as string | null) ?? null,
      durationSeconds: (job.duration_seconds as number | null) ?? null,
      speakers: (job.speakers_count as number | null) ?? null,
      provider: (job.provider as string | null) ?? null,
    },
  };
}

async function loadUtInsight(
  admin: SupabaseClient,
  id: string,
): Promise<SharedUtInsight | null> {
  const { data: session, error } = await admin
    .from('ut_sessions')
    .select('target_url, duration_ms, insight_summary, insight_status')
    .eq('id', id)
    .maybeSingle();
  if (error || !session) return null;

  const insightSummary =
    (session.insight_summary as Record<string, unknown> | null) ?? null;
  // 리포트가 아직 없으면(파이프라인 미완) 공개할 본문 없음.
  if (!insightSummary) return null;

  // 클립 텍스트 메타만 — storage_key / 영상 signed URL 은 조회하지 않는다.
  const { data: clipRows } = await admin
    .from('ut_clips')
    .select('start_ms, end_ms, theme, transcript_span, insight')
    .eq('session_id', id)
    .order('start_ms', { ascending: true });

  const clips: SharedUtInsightClip[] = (clipRows ?? []).map((c) => ({
    startMs: Number(c.start_ms ?? 0),
    endMs: Number(c.end_ms ?? 0),
    theme: (c.theme as string | null) ?? null,
    transcriptSpan: (c.transcript_span as string | null) ?? null,
    insight: (c.insight as Record<string, unknown> | null) ?? null,
  }));

  return {
    type: 'ut_insight',
    targetUrl: (session.target_url as string | null) ?? null,
    durationMs: (session.duration_ms as number | null) ?? null,
    insightSummary,
    clips,
  };
}

async function loadDeskReport(
  admin: SupabaseClient,
  id: string,
): Promise<SharedDeskReport | null> {
  const { data: job, error } = await admin
    .from('desk_jobs')
    .select('output, keywords, locale, sources, status')
    .eq('id', id)
    .maybeSingle();
  if (error || !job) return null;

  const output = (job.output as string | null) ?? null;
  if (!output || output.trim().length === 0) return null;

  const keywords = Array.isArray(job.keywords)
    ? (job.keywords as unknown[]).filter((k): k is string => typeof k === 'string')
    : [];
  const sources = Array.isArray(job.sources)
    ? (job.sources as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];

  return {
    type: 'desk_report',
    output,
    keywords,
    locale: (job.locale as string | null) ?? null,
    sources,
  };
}

// 응답자당 저장된 판단(recruiting_response_judgments.judgment)에서 집계에 필요한
// 필드만. gender/age_group/fit 만 읽고 fit_reason(자유 근거)·region·flags 는
// 건드리지 않는다(집계에 불필요 + PII 보수).
type StoredJudgment = {
  gender?: string | null;
  age_group?: string | null;
  fit?: 'high' | 'medium' | 'low' | null;
};

/**
 * 리크루팅 읽기전용 공유 공개 본문 — **집계·요약만**.
 *
 * 소스(둘 다 service_role 로 OAuth 없이 읽힘, PII-safe):
 *   - recruiting_forms: 제목·조건(criteria)·요약·발행일.
 *   - recruiting_response_judgments: 응답자당 성별/연령대/부합도(이름·전화는
 *     스키마상 저장되지 않음 — 판단 lib 참조).
 *
 * 라이브 Google Forms 응답 행은 발주자 OAuth 가 있어야 읽히므로 공개 로더에선
 * 못 쓴다 → persisted 판단이 크로스탭·부합도의 유일한 OAuth-free 집계 소스다
 * (스펙 "요약 데이터 함수 재사용": 크로스탭은 인증 풀뷰와 동일한
 * pivotGenderAgePairs SSOT 를 공유, 입력만 판단 gender/age_group).
 *
 * 원본 폼이 없으면(dangling) null. 판단이 0건이면 빈 집계로 렌더(발급 게이트가
 * 이미 ≥1 을 강제하지만 로더는 방어적으로 빈 상태 허용).
 */
async function loadRecruitingSummary(
  admin: SupabaseClient,
  formId: string,
): Promise<SharedRecruitingSummary | null> {
  const { data: form, error } = await admin
    .from('recruiting_forms')
    .select('title, criteria, summary, created_at')
    .eq('form_id', formId)
    .maybeSingle();
  if (error || !form) return null;

  // criteria — 발주자 조건. detail(자유 서술)은 제외, category/label/required 만.
  const rawCriteria = (form.criteria as RecruitingBrief['criteria'] | null) ?? [];
  const criteria = Array.isArray(rawCriteria)
    ? rawCriteria.map((c) => ({
        category: typeof c?.category === 'string' ? c.category : '',
        label: typeof c?.label === 'string' ? c.label : '',
        required: c?.required === true,
      }))
    : [];

  const { data: judgeRows } = await admin
    .from('recruiting_response_judgments')
    .select('judgment')
    .eq('form_id', formId);

  const judgments: StoredJudgment[] = (judgeRows ?? []).map(
    (r) => (r.judgment as StoredJudgment | null) ?? {},
  );

  // 부합도 카운트(집계만).
  const fit: SharedRecruitingFit = {
    high: 0,
    medium: 0,
    low: 0,
    unknown: 0,
    total: judgments.length,
  };
  const nowYear = new Date().getFullYear();
  const pairs: Array<[string, string]> = [];
  for (const j of judgments) {
    if (j.fit === 'high') fit.high += 1;
    else if (j.fit === 'medium') fit.medium += 1;
    else if (j.fit === 'low') fit.low += 1;
    else fit.unknown += 1;

    // 성별×연령 pair — 인증 풀뷰와 동일 정규화(normalizeGender / toAgeBucket).
    const gx = normalizeGender(j.gender ?? '');
    const ay = toAgeBucket(j.age_group ?? '', nowYear);
    if (gx !== null && ay !== null) pairs.push([gx, ay]);
  }

  // 축 라벨(성별/연령)은 뷰어가 i18n 헤더로 렌더하므로 xTitle/yTitle 은 미사용
  // (빈 문자열). pivot 은 인증 풀뷰와 공유하는 SSOT.
  const distribution =
    pairs.length > 0
      ? pivotGenderAgePairs(pairs, { xTitle: '', yTitle: '' })
      : null;

  return {
    type: 'recruiting_summary',
    title: (form.title as string | null) ?? '',
    createdAt: (form.created_at as string | null) ?? null,
    summary: (form.summary as string | null)?.trim() || null,
    criteria,
    distribution,
    fit,
  };
}

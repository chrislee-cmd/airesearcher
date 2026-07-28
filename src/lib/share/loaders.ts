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

/** 5타입 통합 공개 본문. 기존 2타입은 viewer-resource 의 ShareResource 재사용. */
export type SharedResourceBody =
  | ShareResource
  | SharedTranscript
  | SharedUtInsight
  | SharedDeskReport;

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

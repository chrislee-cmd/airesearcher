// 인터뷰 탑라인 — 프로젝트 단위 "분석 가이드라인" 저장/조회 (DB 배관).
//
// 가이드라인은 생성이 따라야 할 기준 문서다(결과물 아님). user_direction(600자,
// 재생성 1회성)과 달리 **프로젝트에 지속**한다(재생성/언어변경에도 유지, 명시
// 교체·삭제 전까지). 전용 테이블 interview_generation_guidelines(프로젝트당 1건)에
// 산다.
//
//   getProjectGuideline    : 프로젝트의 현재 가이드(없으면 null). runTopline 이
//                            reduce 직전에 fresh 로 읽어 프롬프트에 주입한다.
//   upsertProjectGuideline : 업로드/교체 — md 저장 + 해시 계산(upsert, 프로젝트당 1건).
//   deleteProjectGuideline : 명시 삭제.
//
// 해시(guideline_hash)는 캐시 무효화 키다 — interview_toplines.guideline_hash 와
// 비교해 다르면 stale(재생성 필요). corpus_hash 엔 넣지 않는다(가이드는 코퍼스가
// 아니라 지시). RLS 는 org 스코프지만 쓰기는 admin client(소유 검증 후)로 한다.

import { hashString } from '@/lib/cache';
import type { createAdminClient } from '@/lib/supabase/admin';

type AdminClient = ReturnType<typeof createAdminClient>;

// 업로드 가이드 문서 최대 길이(문자) — 과도한 페이로드/DoS 표면만 막고 정상 가이드
// (수 KB ~ 수십 KB)는 통과. import 라우트의 MARKDOWN_MAX 와 동일 스케일.
export const GUIDELINE_MAX_CHARS = 400_000;

// 프롬프트 주입 예산(문자) — 대용량 가이드가 reduce 입력을 팽창시키지 않도록
// 시스템 프롬프트에 넣기 전 이 길이로 절단한다. 한 문서 분량의 상세 가이드도
// 충분히 담되(≈ 8~12k 토큰 상당), 통제되지 않은 팽창은 막는다. 초과 시 앞부분만
// 유지 + 절단 고지(buildToplineSystem 절이 "이하 생략" 명시).
export const GUIDELINE_PROMPT_MAX_CHARS = 12_000;

/** 프로젝트 가이드 row(server-side shape). */
export type ProjectGuideline = {
  guideline_md: string;
  guideline_hash: string;
  filename: string | null;
  updated_at: string;
};

/**
 * 프로젝트의 현재 가이드라인을 읽는다(없으면 null). 소유(org) 스코프로 조회해
 * 타 org 가이드 누출을 막는다. runTopline(reduce)·route(GET/POST dedup)가 공유.
 */
export async function getProjectGuideline(
  admin: AdminClient,
  orgId: string,
  projectId: string,
): Promise<ProjectGuideline | null> {
  const { data } = await admin
    .from('interview_generation_guidelines')
    .select('guideline_md, guideline_hash, filename, updated_at')
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .maybeSingle();
  return (data as ProjectGuideline | null) ?? null;
}

/**
 * 가이드 문서를 업로드/교체(프로젝트당 1건 upsert). 해시는 md 내용에서 계산 —
 * 같은 문서를 다시 올리면 해시가 같아 캐시 히트(재생성 트리거 X), 내용이 바뀌면
 * 해시가 달라져 stale 판정된다. row id·해시·파일명을 반환한다.
 */
export async function upsertProjectGuideline(
  admin: AdminClient,
  opts: {
    orgId: string;
    projectId: string;
    markdown: string;
    filename: string | null;
  },
): Promise<{ hash: string; filename: string | null }> {
  const { orgId, projectId, markdown, filename } = opts;
  const hash = hashString(markdown);
  const { error } = await admin
    .from('interview_generation_guidelines')
    .upsert(
      {
        org_id: orgId,
        project_id: projectId,
        guideline_md: markdown,
        guideline_hash: hash,
        filename,
      },
      { onConflict: 'project_id' },
    );
  if (error) {
    throw new Error(`upsertProjectGuideline: ${error.message}`);
  }
  return { hash, filename };
}

/** 프로젝트 가이드라인을 삭제한다(명시 삭제). 없으면 no-op. */
export async function deleteProjectGuideline(
  admin: AdminClient,
  opts: { orgId: string; projectId: string },
): Promise<void> {
  const { orgId, projectId } = opts;
  const { error } = await admin
    .from('interview_generation_guidelines')
    .delete()
    .eq('org_id', orgId)
    .eq('project_id', projectId);
  if (error) {
    throw new Error(`deleteProjectGuideline: ${error.message}`);
  }
}

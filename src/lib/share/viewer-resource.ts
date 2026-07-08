// 공유 뷰어 read-only 리소스 로더 — 게이트 통과 후 service_role 로 원본을
// 최소 컬럼만 조회한다.
//
// 편집/재생성/자유검색 API 는 이 경로에 절대 노출하지 않는다(결정 3). 여기서
// 돌려주는 건 렌더에 필요한 read-only 페이로드뿐. 실제 리치 렌더(resource_type
// 별 위젯/우측 패널)는 #476 이 이 shape 를 받아 그린다 — 이 PR 은 프레임 +
// 게이트까지.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ShareResourceType } from './shared-views';

export type ShareResource =
  | {
      type: 'interview_topline';
      blocks: unknown[];
      generatedAt: string | null;
    }
  | {
      type: 'probing_persona';
      researchGoal: string;
      keyResearchQuestion: string;
      hypotheses: string[];
    };

/**
 * 게이트 통과 후 리소스를 read-only 로 로드. 원본이 이미 삭제됐으면(dangling
 * 공유) null — 페이지는 만료/무효 안내로 처리(데이터 노출 0).
 */
export async function loadShareResource(
  admin: SupabaseClient,
  resourceType: ShareResourceType,
  resourceId: string,
): Promise<ShareResource | null> {
  if (resourceType === 'interview_topline') {
    const { data, error } = await admin
      .from('interview_toplines')
      .select('blocks, generated_at')
      .eq('id', resourceId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      type: 'interview_topline',
      blocks: Array.isArray(data.blocks) ? (data.blocks as unknown[]) : [],
      generatedAt: (data.generated_at as string | null) ?? null,
    };
  }

  const { data, error } = await admin
    .from('probing_sessions')
    .select('research_goal, key_research_question, hypotheses')
    .eq('id', resourceId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    type: 'probing_persona',
    researchGoal: (data.research_goal as string | null) ?? '',
    keyResearchQuestion: (data.key_research_question as string | null) ?? '',
    hypotheses: Array.isArray(data.hypotheses)
      ? (data.hypotheses as string[])
      : [],
  };
}

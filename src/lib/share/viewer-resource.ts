// 공유 뷰어 read-only 리소스 로더 — 게이트 통과 후 service_role 로 원본을
// 최소 컬럼만 조회한다.
//
// 편집/재생성/자유검색 API 는 이 경로에 절대 노출하지 않는다(결정 3). 여기서
// 돌려주는 건 렌더에 필요한 read-only 페이로드뿐. 실제 리치 렌더(resource_type
// 별 위젯/우측 패널)는 #476 이 이 shape 를 받아 그린다 — 이 PR 은 프레임 +
// 게이트까지.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ShareResourceType } from './shared-views';
import {
  probingPersonaSnapshotSchema,
  type ProbingPersonaSnapshot,
} from '@/lib/probing-persona-snapshot';

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
      // 공유 시점 스냅샷(#493) — 페르소나 reflection 그리드 + 생성 질문.
      // 구 세션(공유 전 스냅샷 미저장)이나 미지원 버전이면 null → 뷰어가
      // 방어적 빈/안내 상태로 렌더(결정 2).
      snapshot: ProbingPersonaSnapshot | null;
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
    .select(
      'research_goal, key_research_question, hypotheses, persona_snapshot',
    )
    .eq('id', resourceId)
    .maybeSingle();
  if (error || !data) return null;

  // 스냅샷(#493)은 shape 계약(probing-persona-snapshot.ts)으로 방어적 파싱.
  // 미저장(구 세션)·미지원 버전·손상 payload 는 safeParse 실패 → null 로
  // 떨궈 뷰어가 안내 상태를 그린다(데이터 노출 0, 크래시 0).
  const parsed = probingPersonaSnapshotSchema.safeParse(data.persona_snapshot);

  return {
    type: 'probing_persona',
    researchGoal: (data.research_goal as string | null) ?? '',
    keyResearchQuestion: (data.key_research_question as string | null) ?? '',
    hypotheses: Array.isArray(data.hypotheses)
      ? (data.hypotheses as string[])
      : [],
    snapshot: parsed.success ? parsed.data : null,
  };
}

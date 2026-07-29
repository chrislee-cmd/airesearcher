// 프로빙 per-세션 산출물 best-effort write — probing_deliverables 로 append.
//
// PR (probing-translate-persist-deliverable): 세션 종료 시점(/api/probing/
// sessions/end 가 run 을 active→ended 로 전환한 직후)에 현재 세션의 완성
// 산출물(reflection 패널 + 생성 질문)을 스냅샷 1행으로 남긴다. 라이브러리
// (GET /api/artifacts)에 프로빙을 세션 단위로 편입하기 위한 write 경로.
//
// 하드 규칙 — **best-effort / non-blocking**:
//   - 이 함수는 절대 throw 하지 않는다. 모든 실패(조회/insert/RLS)는 콘솔
//     로그로만 남기고 조용히 return 한다. 호출자(sessions/end)의 run 종료
//     응답 경로에 동기 의존을 추가하지 않는다.
//   - 빈 세션 가드: reflection·questions 가 둘 다 비어 있으면 저장하지 않는다
//     (쓰레기 행 방지 — 스펙 A.3).
//
// 스냅샷 shape = probingPersonaSnapshotSchema (공유 스냅샷과 동일 계약).
// reflection 은 probing_sessions.persona_snapshot(공유 시점 저장분)이 있으면
// 재사용하고, questions 는 이 run 창(started_at 이후)에 생성된 probing_questions
// 행에서 파생한다. 공유를 한 번도 안 한 세션은 reflection 이 비고 questions 만
// 담긴 스냅샷이 된다(그래도 유효한 산출물 — 질문 리스트).

import type { createClient } from '@/lib/supabase/server';
import {
  PROBING_PERSONA_SNAPSHOT_VERSION,
  probingPersonaSnapshotSchema,
  type ProbingPersonaSnapshot,
  type ProbingPersonaSnapshotQuestion,
} from '@/lib/probing-persona-snapshot';

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

// title 파생 — research_goal 앞 40자. 없으면 "프로빙 세션 <YYYY-MM-DD>".
function deriveTitle(researchGoal: string | null, startedAt: string | null): string {
  const goal = (researchGoal ?? '').trim();
  if (goal.length > 0) return goal.slice(0, 40);
  const day = (startedAt ?? new Date().toISOString()).slice(0, 10);
  // spec-지정 DB 저장 title fallback. 주 title 소스 research_goal 이 사용자 한글이라 ko 기본 로케일과 일관.
  return `프로빙 세션 ${day}`; // i18n-allow-korean -- read-model title fallback (server, DB-stored)
}

// probing_questions 행 → 스냅샷 질문. importance/technique 는 있을 때만,
// is_core → is_starred 매핑.
function toSnapshotQuestion(row: Record<string, unknown>): ProbingPersonaSnapshotQuestion {
  const importance = typeof row.importance === 'string' ? row.importance : undefined;
  const technique = typeof row.technique === 'string' ? row.technique : undefined;
  const why = typeof row.why === 'string' && row.why.length > 0 ? row.why : undefined;
  return {
    id: String(row.id ?? ''),
    text: String(row.text ?? ''),
    technique,
    rationale: why,
    importance,
    is_starred: row.is_core === true,
  };
}

// probing_sessions.persona_snapshot 에서 reflection 배열만 방어적으로 추출.
// 공유를 한 번도 안 했으면 null/미형식 → 빈 배열. (미지원/미래 버전은
// safeParse 실패 → 빈 배열, 뷰어와 동일한 gracefully-skip.)
function extractReflection(
  personaSnapshot: unknown,
): ProbingPersonaSnapshot['reflection'] {
  if (!personaSnapshot || typeof personaSnapshot !== 'object') return [];
  const parsed = probingPersonaSnapshotSchema.safeParse(personaSnapshot);
  return parsed.success ? parsed.data.reflection : [];
}

/**
 * 세션 종료 직후 probing_deliverables 로 산출물 스냅샷을 best-effort append.
 * 절대 throw 하지 않는다 — 실패는 콘솔 로그만.
 */
export async function writeProbingDeliverableBestEffort(
  supabase: SupabaseServer,
  args: {
    userId: string;
    orgId: string;
    sessionStartedAt: string | null;
    questionCount: number;
  },
): Promise<void> {
  try {
    const { userId, orgId, sessionStartedAt, questionCount } = args;

    // per-user 컨텍스트 행 — research_goal(title 파생) + persona_snapshot
    // (공유 시점 reflection). RLS 가 user 로 gate. 없어도 진행(빈 값).
    const { data: sessionRow } = await supabase
      .from('probing_sessions')
      .select('research_goal, persona_snapshot')
      .eq('user_id', userId)
      .maybeSingle();

    const reflection = extractReflection(
      (sessionRow as Record<string, unknown> | null)?.persona_snapshot,
    );

    // 이 run 창(started_at 이후)에 생성된 질문. started_at 이 없으면 시간창을
    // 못 잡으므로 질문 스냅샷은 비운다(reflection 만으로 저장 여부 판단).
    let questions: ProbingPersonaSnapshotQuestion[] = [];
    if (sessionStartedAt) {
      const { data: qRows } = await supabase
        .from('probing_questions')
        .select('id, text, technique, why, importance, is_core, created_at')
        .eq('user_id', userId)
        .gte('created_at', sessionStartedAt)
        .order('created_at', { ascending: true })
        .limit(200);
      if (Array.isArray(qRows)) {
        questions = (qRows as Record<string, unknown>[])
          .map(toSnapshotQuestion)
          .filter((q) => q.text.trim().length > 0);
      }
    }

    // 빈 세션 가드 — reflection·questions 둘 다 비면 저장 안 함(쓰레기 행 방지).
    if (reflection.length === 0 && questions.length === 0) return;

    const snapshot: ProbingPersonaSnapshot = {
      version: PROBING_PERSONA_SNAPSHOT_VERSION,
      reflection,
      questions,
    };

    const title = deriveTitle(
      (sessionRow as Record<string, unknown> | null)?.research_goal as
        | string
        | null,
      sessionStartedAt,
    );

    const { error } = await supabase.from('probing_deliverables').insert({
      org_id: orgId,
      user_id: userId,
      title,
      snapshot,
      question_count: questionCount,
      session_started_at: sessionStartedAt,
    });
    if (error) {
      console.warn('[probing/deliverable-write] insert failed (best-effort)', {
        user_id: userId,
        error: error.message,
      });
    }
  } catch (err) {
    // best-effort — 어떤 예외도 라이브 경로로 전파하지 않는다.
    console.warn('[probing/deliverable-write] unexpected error (best-effort)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

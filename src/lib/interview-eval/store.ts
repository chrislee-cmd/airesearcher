import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { EvalResult, RagEvalRun } from './types';

// rag_eval_runs 는 RLS 로 service_role 전용 (migration 참고). 모든 접근은
// super-admin gate 를 통과한 route 의 service-role client 로만 — snapshots.ts
// 와 동일한 설계.

const COLUMNS =
  'id, org_id, project_id, run_by_email, git_sha, sample_size, k, model, metrics, created_at';

/** run 결과를 새 스냅샷으로 영속. */
export async function saveEvalRun(opts: {
  orgId: string;
  email: string;
  result: EvalResult;
}): Promise<RagEvalRun> {
  const supabase = createAdminClient();
  const { result } = opts;
  const { data, error } = await supabase
    .from('rag_eval_runs')
    .insert({
      org_id: opts.orgId,
      project_id: result.project_id,
      run_by_email: opts.email,
      git_sha: result.git_sha,
      sample_size: result.sample_size,
      k: result.k,
      model: result.model,
      metrics: result.metrics,
    })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as RagEvalRun;
}

/**
 * 특정 프로젝트의 직전 run (방금 저장한 것 제외). delta 계산의 기준선.
 * excludeId 를 넘기면 그 row 를 건너뛴 최신 1건 — 저장 직후 "이전 대비" 를
 * 구할 때 방금 insert 한 row 를 제외하기 위함.
 */
export async function getPreviousRun(
  orgId: string,
  projectId: string,
  excludeId?: string,
): Promise<RagEvalRun | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('rag_eval_runs')
    .select(COLUMNS)
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(excludeId ? 2 : 1);
  if (error) throw new Error(error.message);
  const rows = (data as RagEvalRun[] | null) ?? [];
  const filtered = excludeId ? rows.filter((r) => r.id !== excludeId) : rows;
  return filtered[0] ?? null;
}

/** 프로젝트의 최근 run 목록 (기본 20건) — 히스토리 표시용. */
export async function listEvalRuns(
  orgId: string,
  projectId: string,
  limit = 20,
): Promise<RagEvalRun[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('rag_eval_runs')
    .select(COLUMNS)
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data as RagEvalRun[] | null) ?? [];
}

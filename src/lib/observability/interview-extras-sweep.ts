// 중앙 에러 관측 Phase 2 — 인터뷰 stuck-pending / topline-error 감지 이관.
//
// widget-error-sweep(테이블 status 기반)은 interview_jobs 의 index_status='error'
// 만 error_events 로 적재한다. 하지만 #1008(interview-failure-alert)에는 status
// 컬럼만으로는 못 잡는 두 감지가 더 있었다:
//   1) stuck-pending — index_status='pending' 인데 STUCK_PENDING_MINUTES 이상
//      갱신 없고 documents=0. convert 단계가 인덱싱 전에 죽은 무음 실패로,
//      어떤 catch 도 error 를 남기지 않는다(status 는 계속 'pending').
//   2) topline-error — interview_toplines.status='error'. topline 생성 실패로,
//      interview_jobs 가 아니라 별도 테이블에 상태가 있어 job-sweep 이 못 본다.
//
// Phase 2 에서 #1008 cron 을 전제품 digest(error-alert-digest)로 대체하면서,
// 이 두 감지를 잃지 않도록 여기서 logError 로 error_events 에 이관한다. 이후
// digest 가 error_events.alerted_at 로 dedup 해 발송한다.
//
// ── 재적재 방지(count 인플레) ──
// 이 두 감지는 '오래된' 행을 본다(pending 은 created_at 이 옛날, topline error 도
// 지속). created_at>watermark 방식(widget-sweep)은 안 맞으므로, #1008 이 쓰던
// interview_jobs.alerted_at / interview_toplines.alerted_at 컬럼을 **적재-1회
// 마커**로 재사용한다: alerted_at IS NULL 인 행만 적재하고, 적재 후 스탬프한다.
// (이 컬럼은 더 이상 이메일 dedup 이 아니라 error_events 적재 dedup 용이다 —
// 이메일 dedup 은 error_events.alerted_at 이 담당.) 매 스윕이 같은 stuck 행을
// 다시 count 시키지 않아 signature count 가 부풀지 않는다.

import { createAdminClient } from '@/lib/supabase/admin';
import { logError } from '@/lib/observability/log-error';

type Admin = ReturnType<typeof createAdminClient>;

// 'pending' 이면서 이 시간 이상 갱신(updated_at, touch 트리거) 없고 docs=0 이면
// in-flight 가 아니라 convert 단계 고착으로 본다. #1008 과 동일 값.
const STUCK_PENDING_MINUTES = 15;
// 한 스윕에서 테이블당 처리할 상한(RPC 폭주 방지). #1008 QUERY_LIMIT 과 동일.
const QUERY_LIMIT = 200;

const JOB_COLS = 'id, org_id, project_id, user_id, index_status, error_message, created_at, updated_at';

export type InterviewExtrasResult = {
  stuckPending: number;
  toplineError: number;
  skipped?: string; // 테이블 없음(마이그 미적용) 등.
};

// interview_documents 행 수를 job 별로 batched .in() 으로 집계. embed 대신
// 2-step(PROJECT.md §7.10).
async function countDocuments(admin: Admin, jobIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!jobIds.length) return counts;
  const { data } = await admin
    .from('interview_documents')
    .select('interview_job_id')
    .in('interview_job_id', jobIds);
  for (const row of (data ?? []) as { interview_job_id: string }[]) {
    counts.set(row.interview_job_id, (counts.get(row.interview_job_id) ?? 0) + 1);
  }
  return counts;
}

// #1008 의 stuck-pending / topline-error 감지를 error_events 로 이관. best-effort —
// logError 는 절대 throw 안 하고, 개별 쿼리 실패는 전체를 막지 않는다.
export async function sweepInterviewExtras(admin?: Admin): Promise<InterviewExtrasResult> {
  const db = admin ?? createAdminClient();
  const stuckCutoff = new Date(Date.now() - STUCK_PENDING_MINUTES * 60_000).toISOString();

  let stuckPending = 0;
  let toplineError = 0;

  // ── 1) stuck-pending: pending + stale + docs=0, 아직 미적재(alerted_at null) ──
  const { data: pendingRows, error: pendErr } = await db
    .from('interview_jobs')
    .select(JOB_COLS)
    .eq('index_status', 'pending')
    .lt('updated_at', stuckCutoff)
    .is('alerted_at', null)
    .order('updated_at', { ascending: true })
    .limit(QUERY_LIMIT);
  if (pendErr) {
    return { stuckPending: 0, toplineError: 0, skipped: pendErr.message };
  }

  const pending = (pendingRows ?? []) as {
    id: string;
    org_id: string;
    project_id: string | null;
    user_id: string;
    index_status: string;
    error_message: string | null;
    created_at: string;
    updated_at: string;
  }[];
  const docCount = await countDocuments(db, pending.map((j) => j.id));
  const stuck = pending.filter((j) => (docCount.get(j.id) ?? 0) === 0);

  for (const j of stuck) {
    // 같은 원인은 signature(feature=interview, code=stuck_pending)로 collapse.
    // 원문 message 는 안정적으로 두고, 가변 job_id 는 context 샘플로만 남긴다.
    await logError({
      feature: 'interview',
      code: 'stuck_pending',
      message: 'interview job stuck at pending (convert step presumed dead, docs=0)',
      context: {
        table: 'interview_jobs',
        sample_id: j.id,
        org_id: j.org_id,
        project_id: j.project_id,
        created_at: j.created_at,
        updated_at: j.updated_at,
      },
      severity: 'error',
      source: 'job-sweep',
    });
  }
  // 적재-1회 마커 스탬프: 이 행들이 다음 스윕에서 다시 count 되지 않게.
  if (stuck.length) {
    const stampedAt = new Date().toISOString();
    await db.from('interview_jobs').update({ alerted_at: stampedAt }).in('id', stuck.map((j) => j.id));
    stuckPending = stuck.length;
  }

  // ── 2) topline-error: interview_toplines.status='error', 아직 미적재 ──
  const { data: toplineRows, error: tlErr } = await db
    .from('interview_toplines')
    .select('id, org_id, project_id, error_message, updated_at')
    .eq('status', 'error')
    .is('alerted_at', null)
    .order('updated_at', { ascending: true })
    .limit(QUERY_LIMIT);
  if (tlErr) {
    // stuck-pending 은 이미 적재됐으므로 그 성과는 살려 반환.
    return { stuckPending, toplineError: 0, skipped: tlErr.message };
  }

  const toplines = (toplineRows ?? []) as {
    id: string;
    org_id: string | null;
    project_id: string;
    error_message: string | null;
    updated_at: string;
  }[];

  for (const t of toplines) {
    await logError({
      feature: 'interview',
      code: 'topline_error',
      message: t.error_message?.trim() || 'interview topline generation failed',
      context: {
        table: 'interview_toplines',
        sample_id: t.id,
        org_id: t.org_id,
        project_id: t.project_id,
        updated_at: t.updated_at,
      },
      severity: 'error',
      source: 'job-sweep',
    });
  }
  if (toplines.length) {
    const stampedAt = new Date().toISOString();
    await db.from('interview_toplines').update({ alerted_at: stampedAt }).in('id', toplines.map((t) => t.id));
    toplineError = toplines.length;
  }

  return { stuckPending, toplineError };
}

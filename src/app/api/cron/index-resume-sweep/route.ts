// Interview index resume-sweep cron — 서버발 self-heal (카드 #608).
//
// 배경: /api/interviews/index 는 대용량 배치를 시간예산 홉으로 쪼개 self-kick
// 체인으로 이어간다. 그 체인이 조용히 끊기거나(cold-start fetch 실패·과부하),
// 한 홉이 maxDuration(300s)을 넘겨 플랫폼에 강제 종료(uncatchable)되면, 백그라운드
// 함수가 죽어 잡이 index_status='indexing' 에 영구 정지한다(프로덕션 26~48분 관측).
// 인덱싱엔 탑라인의 topline-resume-sweep 같은 watchdog 이 없어 아무도 고아 잡을
// 살리지 않았다 — 이 cron 이 그 구멍을 메운다.
//
// 이 cron 은 client 무관하게 백그라운드에서 돌며, updated_at 이 INDEX_STALE_MS
// (4분) 넘게 정체된 'indexing' 잡을 찾아 재개 홉을 재점화한다(retriggerIndex).
// 무한 루프 방지: 진전(총 삽입 청크 수 > index_cursor)이 있으면 index_resume_count
// 를 0 리셋하고 재점화, 진전이 없으면 카운터를 bump → 상한(MAX_NOPROGRESS_RESUMES)
// 초과 시 index_status='error' 로 정직하게 종결(영구 indexing 0).
//
// 정상 진행 방해 0: 살아 있는 홉은 배치마다 interview_jobs 를 heartbeat touch 해
// updated_at 을 갱신하므로 4분 창을 넘기지 않아 이 쿼리에 잡히지 않는다.
//
// 인증: 표준 Vercel cron 패턴 — Authorization: Bearer <CRON_SECRET>, fail-closed.
// service_role(createAdminClient)로 돌아 RLS 를 우회한다.

import { NextResponse } from 'next/server';
import { env } from '@/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { retriggerIndex } from '@/app/api/interviews/index/route';
import { logError } from '@/lib/observability/log-error';

export const runtime = 'nodejs';
export const maxDuration = 60;

// 죽음 판정 창 — updated_at 이 이만큼 정체된 'indexing' = 체인이 끊긴 stuck 후보.
// 인덱싱 루프의 heartbeat 주기(20s) + 최악 단일 배치(~60s)보다 넉넉히 커야 살아
// 있는 홉을 오탐하지 않는다.
const INDEX_STALE_MS = 4 * 60 * 1000;

// 진전 없는 재점화 상한 — 같은 지점에서 진전 없이 이만큼 재점화되면 진짜 stuck
// 으로 보고 error 종결. 진전이 감지되면 리셋되므로 healthy 대형 배치는 여기 안 걸림.
const MAX_NOPROGRESS_RESUMES = 5;

// 한 스윕에서 처리할 stuck 잡 상한 — 정상 상황엔 0~1건. 초과분은 다음 스윕(1분 뒤)
// 에서 자연 소진(updated_at 정체 유지).
const QUERY_LIMIT = 50;

function authorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? '';
  return header === `Bearer ${env.CRON_SECRET}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - INDEX_STALE_MS).toISOString();

  // updated_at 이 4분 넘게 정체된 'indexing' = 홉 체인이 끊긴 stuck 후보.
  const { data, error } = await admin
    .from('interview_jobs')
    .select('id, org_id, index_cursor, index_resume_count')
    .eq('index_status', 'indexing')
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(QUERY_LIMIT);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as {
    id: string;
    org_id: string;
    index_cursor: number | null;
    index_resume_count: number | null;
  }[];

  let rekicked = 0;
  let errored = 0;
  for (const row of rows) {
    // 진전 판정 — 잡의 현재 총 삽입 청크 수 vs 마지막으로 관측한 커서.
    const { count } = await admin
      .from('interview_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('interview_job_id', row.id);
    const currentTotal = count ?? 0;
    const cursor = row.index_cursor ?? 0;
    const resumeCount = row.index_resume_count ?? 0;

    if (currentTotal > cursor) {
      // 진전 있음 — 죽은 홉일 뿐 stuck 아님. 커서 갱신 + 카운터 리셋 후 재점화.
      await admin
        .from('interview_jobs')
        .update({ index_cursor: currentTotal, index_resume_count: 0 })
        .eq('id', row.id)
        .eq('org_id', row.org_id)
        .eq('index_status', 'indexing');
      await retriggerIndex(row.id);
      rekicked += 1;
    } else if (resumeCount + 1 >= MAX_NOPROGRESS_RESUMES) {
      // 상한 도달 + 진전 없음 = 진짜 stuck. error 로 정직하게 종결(영구 indexing 0).
      await admin
        .from('interview_jobs')
        .update({
          index_status: 'error',
          error_message: `index_stalled (no progress at ${currentTotal} chunks after ${resumeCount + 1} resumes)`,
        })
        .eq('id', row.id)
        .eq('org_id', row.org_id)
        .eq('index_status', 'indexing');
      await logError({
        feature: 'interview',
        code: 'index_stalled',
        message: `no progress at ${currentTotal} chunks after ${resumeCount + 1} resumes`,
        context: { interview_job_id: row.id, org_id: row.org_id },
      });
      errored += 1;
    } else {
      // 진전 없음이지만 예산 남음 — 카운터 bump 후 재점화(transient 장애 회복 여지).
      await admin
        .from('interview_jobs')
        .update({ index_resume_count: resumeCount + 1 })
        .eq('id', row.id)
        .eq('org_id', row.org_id)
        .eq('index_status', 'indexing');
      await retriggerIndex(row.id);
      rekicked += 1;
    }
  }

  return NextResponse.json({ ok: true, swept: rows.length, rekicked, errored });
}

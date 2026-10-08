// 위젯 체인 stale-sweep cron (PR-B, 리스크 R10).
//
// 메우는 구멍: 체인의 전진은 각 파이프라인의 done 훅이 밀어 준다. 그 훅이
// 도달하지 못하면(백그라운드 함수 사망·플랫폼 강제 종료·provider webhook 유실)
// 체인이 'running' 또는 'awaiting_approval' 에 영구 정지한다. 체인은 프로젝트당
// 활성 1개 제약(partial unique index)을 쓰므로, 정지한 체인 하나가 그 프로젝트의
// 새 체인 생성까지 영구 차단한다 — 조용히 방치하면 "체인을 다시 만들 수 없는"
// 상태가 된다.
//
// ⚠️ 이 sweep 은 **재시도하지 않는다 — 닫기만 한다.** 단계 실패의 재시도는 각
// 파이프라인의 기존 sweep(index-resume-sweep · topline-resume-sweep ·
// transcript-reconcile)이 소유한다(리스크 R4 — 체인이 자체 재시도를 하면 이중
// 재시도 경합). 그래서 index-resume-sweep 처럼 "진전 판정 → 재점화" 가 아니라
// "정체 판정 → error 종결 + error_events 적재" 만 한다.
//
// STALE 창이 24h 로 넉넉한 이유: approve 모드에서 사용자가 승인 모달을 하루
// 안에 처리하는 것은 정상 사용이다. 창을 좁히면 살아 있는 승인 대기를 오탐해
// 닫아 버린다. 반대로 무한히 열어 두면 위의 "새 체인 영구 차단" 이 남는다.
//
// paused_insufficient_credits 는 **대상이 아니다** — 잔액을 충전하면 해소되는
// 사용자 액션 대기 상태이고, 재개 API(R9)가 소유한다. 여기서 닫으면 충전한
// 사용자의 체인을 빼앗는다.
//
// 인증: 표준 Vercel cron 패턴 — Authorization: Bearer <CRON_SECRET>, fail-closed.
// service_role(createAdminClient)로 돌아 RLS 를 우회한다.

import { NextResponse } from 'next/server';
import { env } from '@/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { casChain, type ChainRow, type ChainStatus } from '@/lib/chains/state';
import { logError } from '@/lib/observability/log-error';
import { recordCronHeartbeat } from '@/lib/observability/cron-heartbeat';

export const runtime = 'nodejs';
export const maxDuration = 60;

// 정체 판정 창 — updated_at 이 이만큼 갱신되지 않은 활성 체인 = 전진이 끊긴 것.
// 체인은 단계가 전진할 때마다 updated_at 트리거로 touch 되므로, 살아서 진행
// 중인 체인은 이 창에 걸리지 않는다.
const CHAIN_STALE_MS = 24 * 60 * 60 * 1000;

// 닫기 대상 상태 — 전진을 기다리는(= 훅이 와야 움직이는) 활성 상태만.
const SWEEPABLE: readonly ChainStatus[] = ['running', 'awaiting_approval'];

// 한 스윕에서 닫을 상한. 정상 상황엔 0건. 초과분은 다음 스윕에서 소진된다
// (updated_at 이 그대로 정체 상태로 남으므로).
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
  const cutoff = new Date(Date.now() - CHAIN_STALE_MS).toISOString();

  const { data, error } = await admin
    .from('widget_chains')
    .select('id, org_id, project_id, status, current_step, steps, error_message')
    .in('status', [...SWEEPABLE])
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(QUERY_LIMIT);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as Pick<
    ChainRow,
    'id' | 'org_id' | 'project_id' | 'status' | 'current_step' | 'steps' | 'error_message'
  >[];

  let closed = 0;
  for (const row of rows) {
    const stepFeature = row.steps?.[row.current_step]?.feature ?? 'unknown';
    // 어댑터/kick 이 남긴 사유가 있으면 보존해 덧붙인다 — 왜 멈췄는지가
    // 사용자에게 보이는 유일한 단서다(조용한 실패 금지).
    const prior = row.error_message ? ` (last: ${row.error_message})` : '';
    const reason = `chain_stalled: no progress for 24h at step ${row.current_step} (${stepFeature})${prior}`;

    // CAS — 같은 status 인 동안에만 닫는다. 스윕과 동시에 사용자가 승인/종료
    // 하거나 done 훅이 늦게 도달하면 그쪽이 이기고 여기선 no-op.
    const res = await casChain(
      admin,
      row.id,
      row.status,
      { status: 'error', error_message: reason.slice(0, 500) },
      row.current_step,
    );
    if (!res.applied) continue;

    closed += 1;
    await logError({
      feature: 'interview',
      code: 'chain_stalled',
      message: reason,
      source: 'job-sweep',
      context: {
        chain_id: row.id,
        org_id: row.org_id,
        project_id: row.project_id,
        step: row.current_step,
        feature: stepFeature,
      },
    });
  }

  // 생존 신호(PR-E) — **성공 완주 시에도** 1행 기록. 이 cron 은 정상 상황에
  // 아무것도 닫지 않으므로(candidates 0) error_events 에 흔적을 남기지 않는다.
  // 그래서 "정상 가동" 과 "cron 미등록/미실행" 이 똑같은 무음이 된다. 여기서
  // ran_at 을 찍어 어드민이 그 둘을 구분한다. 위 early-return(401/500) 경로는
  // 의도적으로 기록하지 않는다 — 실패가 생존으로 위장하면 신호가 거짓이 된다.
  // recordCronHeartbeat 는 절대 throw 하지 않아 이 응답을 깨지 않는다.
  await recordCronHeartbeat('chain-sweep', { scanned: rows.length, acted: closed }, admin);

  return NextResponse.json({ ok: true, candidates: rows.length, closed });
}

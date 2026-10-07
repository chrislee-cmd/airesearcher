// 프로빙 세션 종료 계측 (OBS-2) — probing_session_runs 를 'active' → 'ended'/'error'.
//
// use-realtime-transcription 의 stop()/에러 teardown 이 fire-and-forget
// (keepalive) 로 호출한다. body: { session_id, status?: 'ended' | 'error' }.
//
// 서버가 duration/question_count 를 계산한다 (client 시계·집계 불신):
//   - duration_seconds = now() - started_at
//   - question_count   = started_at 이후 이 유저가 만든 probing_questions 수
//     (probing_questions 에 run FK 가 없어 시간창으로 근사 — 세션은 사용자당
//      동시 1개가 정상이므로 실질 정확).
//
// idempotent: 이미 종료(status != 'active')된 row 는 갱신하지 않는다
// (.eq('status','active') 가드) — renewal/중복 stop/재시도 안전.

import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { writeProbingDeliverableBestEffort } from '@/lib/probing/deliverable-write';
import { advanceChain } from '@/lib/chains/advance';

export const runtime = 'nodejs';
// 15 → 60: 위젯 체인 advance(아래)가 auto 모드에서 녹음 재호스팅 + provider
// 디스패치를 after() 로 수행할 수 있다. after() 는 maxDuration 까지만 살아 있어
// 15s 면 kick 이 잘려 체인이 조용히 멈춘다. 체인 없는 기존 경로는 예전처럼 즉시
// 종료되므로 이 상향은 유휴 시간을 늘리지 않는다.
export const maxDuration = 60;

const Body = z.object({
  session_id: z.string().uuid(),
  status: z.enum(['ended', 'error']).default('ended'),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { session_id, status } = parsed.data;

  // 아직 'active' 인 본인 run 만 조회 (RLS 가 user 로 gate). 없으면 조용히
  // ok — 이미 종료됐거나(중복 stop) row insert 가 실패한 세션.
  const { data: run } = await supabase
    .from('probing_session_runs')
    .select('id, started_at')
    .eq('session_id', session_id)
    .eq('status', 'active')
    .maybeSingle();

  if (!run) {
    return NextResponse.json({ ok: true, updated: false });
  }

  const startedAtMs = new Date(run.started_at as string).getTime();
  const durationSeconds = Number.isFinite(startedAtMs)
    ? Math.max(0, Math.round((Date.now() - startedAtMs) / 1000))
    : null;

  // started_at 이후 생성된 질문 수 (RLS 가 본인으로 gate).
  const { count } = await supabase
    .from('probing_questions')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', run.started_at as string);

  const { error: updateError } = await supabase
    .from('probing_session_runs')
    .update({
      status,
      ended_at: new Date().toISOString(),
      duration_seconds: durationSeconds,
      question_count: count ?? 0,
    })
    .eq('id', run.id as string)
    .eq('status', 'active');

  if (updateError) {
    console.warn('[probing/sessions/end] update failed', {
      session_id,
      error: updateError.message,
    });
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  // best-effort 산출물 스냅샷 (probing_deliverables). 우리가 실제로 run 을
  // active→ended 로 전환한 이 분기에서만 호출하므로 중복 stop/재시도에
  // 산출물이 이중 생성되지 않는다(위 .eq('status','active') 가드와 동형의
  // 멱등성). 저장 실패는 라이브 경로에 무영향 — 헬퍼가 throw 하지 않고
  // run 종료 응답은 그대로 반환한다(스펙 A.2 best-effort 하드 규칙).
  await writeProbingDeliverableBestEffort(supabase, {
    userId: user.id,
    orgId: org.org_id,
    sessionStartedAt: (run.started_at as string) ?? null,
    questionCount: count ?? 0,
  });

  // ── 위젯 체인 advance (PR-B) ──────────────────────────────────────────────
  // 우리가 실제로 run 을 active→ended 로 전환한 이 분기에서만 부른다 — 위
  // .eq('status','active') 가드가 중복 stop/재시도에서 이중 advance 를 막는다
  // (산출물 스냅샷과 동형의 멱등성).
  //
  // ⚠️ #1024 불변식: **활성 체인이 없으면 완전 no-op** 이다. 체인을 명시
  // 생성하지 않은 프로빙 세션은 종료 후 아무 일도 겪지 않는다(전사 자동 착수
  // 0 · 과금 0). 되살리는 유일한 조건은 "사용자가 체인을 만들고 모드를 골랐다".
  //
  // after(): auto 모드면 다음 단계(전사)가 녹음 재호스팅 + provider 디스패치를
  // 포함하므로 종료 응답을 막지 않는다. 예외는 흡수 — 세션 종료 계측이 체인
  // 때문에 실패하면 안 된다.
  //
  // 알려진 제약(auto 모드): 녹음 blob 업로드·메타 insert 는 클라이언트가 세션
  // 종료 **후** 수행한다. 훅이 먼저 도달하면 어댑터가 'recording_not_found'
  // (retryable)로 떨어지고, 체인 자체 재시도는 금지(R4)이므로 체인은 사유를
  // 기록한 채 멈춘다. 기본 approve 모드에서는 사용자가 승인하는 시점에 이미
  // 업로드가 끝나 있어 이 경합이 발생하지 않는다.
  after(async () => {
    try {
      await advanceChain({
        orgId: org.org_id,
        sourceFeature: 'probing',
        jobRef: session_id,
      });
    } catch (e) {
      console.warn('[probing/sessions/end] chain advance failed', e);
    }
  });

  return NextResponse.json({
    ok: true,
    updated: true,
    session_id,
    status,
    duration_seconds: durationSeconds,
    question_count: count ?? 0,
  });
}

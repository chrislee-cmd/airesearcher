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

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

export const runtime = 'nodejs';
export const maxDuration = 15;

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

  return NextResponse.json({
    ok: true,
    updated: true,
    session_id,
    status,
    duration_seconds: durationSeconds,
    question_count: count ?? 0,
  });
}

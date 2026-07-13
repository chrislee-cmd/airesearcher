// AI 동시통역 — 진행 중 10분 heartbeat 과금 (하이브리드 C, docs §6).
//
// go-live 시 /start 가 start lump(tick 0)을 차감한 뒤, 콘솔이 10분마다 이
// route 를 tick_index=1,2,3… 으로 호출한다. tick 당 blockCredits(10)를 낙관적
// (wall-clock 기준)으로 차감해 우측 상단 잔액이 실시간 count-down 되게 한다.
// 실시간 통역은 오디오가 거의 연속이라 wall-clock ≈ 실오디오라 UX 상 충분히
// 정확하고, 과·소 차감분은 종료 시 recording PATCH(finalize)가 실오디오 기준
// (`translateCreditsForAudioSeconds`)으로 최종 정산·보정한다.
//
// probing heartbeat(api/probing/sessions/heartbeat)의 deterministic-genId
// 멱등 패턴을 통역 네임스페이스(`translate:{id}:tick:{n}`)로 복제 — 같은 tick
// 재전송(client retry / 네트워크 재시도)은 credit_transactions 의 partial
// UNIQUE 로 한 번만 과금된다. renewal(OpenAI ~30분 캡 재연결)은 같은 sessionId
// 를 유지하므로 tick_index 가 누적 이어져 재-start-lump 없이 과금이 연속된다.
//
// tick cap(TRANSLATE_MAX_BILLABLE_TICK): 방치 세션 무한차감 안전망. cap 초과분은
// **진행 중 과금만 정지**(capped)하고 세션은 계속 — 종료 시 finalize 가 실오디오
// 기준으로 최종 청구하므로 cap 은 표시/현금흐름 상한일 뿐 정산 상한이 아니다.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { spendCreditsAdminAmount } from '@/lib/credits';
import {
  TRANSLATE_METERING,
  TRANSLATE_START_LUMP_CREDITS,
  TRANSLATE_MAX_BILLABLE_TICK,
} from '@/lib/features';
import { deriveTranslateTickGenerationId } from '@/lib/translate-billing';

export const runtime = 'nodejs';
export const maxDuration = 15;

// tick_index 는 1 부터(0 은 /start 의 start lump). 상한은 방어적 sanity bound —
// 과금 상한은 TRANSLATE_MAX_BILLABLE_TICK 이 결정하고, 그 위(장시간 세션)는
// capped 로 응답한다.
const Body = z.object({
  tick_index: z.number().int().min(1).max(10_000),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { tick_index } = parsed.data;

  // Host-owned live session only. Read via session client (RLS host_select).
  const { data: row, error: readErr } = await supabase
    .from('translate_sessions')
    .select('id, org_id, host_user_id, status, credits_charged')
    .eq('id', sessionId)
    .maybeSingle<{
      id: string;
      org_id: string;
      host_user_id: string;
      status: string;
      credits_charged: number | null;
    }>();
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (row.host_user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Service-role for the credit charge, the credits_charged bump (column is
  // service-role-only per 0022) + the authoritative balance read.
  const admin = createAdminClient();

  const readBalance = async (): Promise<number | null> => {
    const { data } = await admin
      .from('organizations')
      .select('credit_balance')
      .eq('id', row.org_id)
      .maybeSingle<{ credit_balance: number | null }>();
    return data?.credit_balance ?? null;
  };

  // Session already torn down (stop/end raced this tick) — don't charge past
  // the live window. finalize settles the real-audio bill regardless.
  if (row.status !== 'live') {
    return NextResponse.json({
      ok: true,
      ended: true,
      balance: await readBalance(),
    });
  }

  // Past the billing cap → stop charging, keep the session alive.
  if (tick_index > TRANSLATE_MAX_BILLABLE_TICK) {
    return NextResponse.json({
      ok: true,
      capped: true,
      balance: await readBalance(),
    });
  }

  const generationId = deriveTranslateTickGenerationId(sessionId, tick_index);
  const spend = await spendCreditsAdminAmount(
    row.org_id,
    row.host_user_id,
    'translate',
    TRANSLATE_METERING.blockCredits,
    generationId,
  );
  if (!spend.ok) {
    return NextResponse.json(
      {
        error:
          spend.reason === 'insufficient'
            ? 'insufficient_credits'
            : 'forbidden',
        tick_index,
        balance: await readBalance(),
      },
      { status: 402 },
    );
  }

  // Bump the running total (관측 + finalize 정산 기준). tick n 의 누적 =
  // start lump + n×block. Math.max 로 monotonic — 멱등 재전송/역순 tick 에도
  // 되돌아가지 않는다.
  const cumulative =
    TRANSLATE_START_LUMP_CREDITS + tick_index * TRANSLATE_METERING.blockCredits;
  await admin
    .from('translate_sessions')
    .update({
      credits_charged: Math.max(row.credits_charged ?? 0, cumulative),
    })
    .eq('id', sessionId);

  return NextResponse.json({
    ok: true,
    tick_index,
    // Echo the derived generation_id so retries can be confirmed to collapse
    // to one DB row in the network panel.
    generation_id: generationId,
    balance: await readBalance(),
  });
}

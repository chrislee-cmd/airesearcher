// AI 동시통역 — mark a session live and stamp its start time.
//
// The host console calls this the moment at least one realtime slot
// connects (go-live). Historically the console flipped the row itself
// with a fire-and-forget `supabase.from().update()`, but that builder
// was never awaited — supabase-js only sends the PATCH when the thenable
// is awaited/`.then()`d, so the request never left the browser. Result:
// `status` stayed 'idle' and `started_at` stayed NULL for every session,
// which (a) broke export/viewer start-time, and (b) neutered the
// cleanup cron's straggler clause (it filters `.eq('status','live')`).
//
// Routing go-live through the server makes the write reliable and
// mirrors the existing `/end` route. `started_at` is stamped only when
// still NULL so a reconnect/re-entry never overwrites the true first
// go-live time.
//
// 하이브리드 C (docs §6): go-live 는 세션의 **start lump** 과금 지점이기도
// 하다. base + 첫 10분 블록(TRANSLATE_START_LUMP_CREDITS)을 여기서 1회 차감
// (deterministic tick-0 genId 로 멱등). WebRTC 연결이 성공한 뒤에만 호출되므로
// 연결 실패 세션은 lump 를 물지 않는다. 이후 10분 heartbeat 는 /heartbeat 가,
// 종료 시 실오디오 정산은 recording PATCH 가 담당한다.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { spendCreditsAdminAmount } from '@/lib/credits';
import { TRANSLATE_START_LUMP_CREDITS } from '@/lib/features';
import { deriveTranslateTickGenerationId } from '@/lib/translate-billing';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { data: row, error: readErr } = await supabase
      .from('translate_sessions')
      .select('id, org_id, host_user_id, status, started_at, credits_charged')
      .eq('id', id)
      .maybeSingle<{
        id: string;
        org_id: string;
        host_user_id: string;
        status: string;
        started_at: string | null;
        credits_charged: number | null;
      }>();
    if (readErr) {
      console.error('[translate/start] session lookup failed', {
        session_id: id,
        error: readErr.message,
      });
      return NextResponse.json(
        { error: 'session_lookup_failed', detail: readErr.message },
        { status: 500 },
      );
    }
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (row.host_user_id !== user.id) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    // An already-ended session must not be resurrected to 'live'.
    if (row.status === 'ended') {
      return NextResponse.json({ error: 'session_ended' }, { status: 410 });
    }

    // Service-role for the start-lump charge, the credits_charged bump
    // (column is service-role-only per 0022) + the authoritative balance read.
    const admin = createAdminClient();

    // ── Start lump (하이브리드 C, docs §6) ─────────────────────────────────
    // generation_id = tick-0 의 deterministic UUID → 재진입/재전송에도 partial
    // UNIQUE 로 1회만 과금. 잔액 부족이면 go-live 거부(402, status='live' 로
    // 넘기지 않음) — probing sessions/route 와 동일 정책.
    const lumpGenId = deriveTranslateTickGenerationId(id, 0);
    const spend = await spendCreditsAdminAmount(
      row.org_id,
      row.host_user_id,
      'translate',
      TRANSLATE_START_LUMP_CREDITS,
      lumpGenId,
    );
    if (!spend.ok) {
      return NextResponse.json(
        {
          error:
            spend.reason === 'insufficient'
              ? 'insufficient_credits'
              : 'forbidden',
        },
        { status: 402 },
      );
    }

    // Preserve the first go-live time — only stamp when still NULL.
    // credits_charged = 세션 누적 차감(관측 + finalize 정산 기준). tick 0 =
    // start lump. Math.max 로 monotonic — 멱등 lump 재전송에도 되돌아가지 않음.
    const patch: {
      status: 'live';
      started_at?: string;
      credits_charged: number;
    } = {
      status: 'live',
      credits_charged: Math.max(
        row.credits_charged ?? 0,
        TRANSLATE_START_LUMP_CREDITS,
      ),
    };
    if (!row.started_at) patch.started_at = new Date().toISOString();

    const { error } = await admin
      .from('translate_sessions')
      .update(patch)
      .eq('id', id);
    if (error) {
      console.error('[translate/start] go-live update failed', {
        session_id: id,
        error: error.message,
      });
      return NextResponse.json(
        { error: 'start_update_failed', detail: error.message },
        { status: 500 },
      );
    }

    // 우측 상단 잔액을 authoritative 값으로 즉시 동기화하도록 balance 반환.
    const { data: orgRow } = await admin
      .from('organizations')
      .select('credit_balance')
      .eq('id', row.org_id)
      .maybeSingle<{ credit_balance: number | null }>();

    return NextResponse.json({
      ok: true,
      started_at: patch.started_at ?? row.started_at,
      charged: TRANSLATE_START_LUMP_CREDITS,
      balance: orgRow?.credit_balance ?? null,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[translate/start] unhandled exception', {
      session_id: id,
      error: detail,
    });
    return NextResponse.json({ error: 'start_failed', detail }, { status: 500 });
  }
}

// 프로빙 어시스턴트 — 10분 단위 추가 차감 heartbeat.
//
// 세션 lifecycle:
//   - POST /api/probing/sessions           → 시작 lump 5 credit (tick_index 0)
//   - POST /api/probing/sessions/heartbeat → 10분 경과마다 5 credit (tick_index 1..9)
//
// 사용자 결정 가격: 1시간 = 25 credit (₩50,000). 2시간 = 50 credit cap.
// → start lump 5 + 9 heartbeats × 5 = 50 credit 상한. tick_index ≥ 10 은 거부.
//
// Idempotency: heartbeat generation_id 는 (session_id, tick_index) 로부터
// SHA-256 으로 결정적 derive — 같은 tick 재전송 (client retry / 네트워크
// 재시도) 은 credit_transactions(generation_id) WHERE reason='feature_use'
// 의 partial UNIQUE 가 한 번만 받는다. session_id 자체의 진위는 서버가
// 추적하지 않음 (별도 probing_sessions 테이블 없음) — 위조 session_id 는
// 그 자체로 새 start lump 가 필요하므로 사용자 credit_balance 가 자연
// 상한.

import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { spendCredits } from '@/lib/credits';

export const runtime = 'nodejs';
export const maxDuration = 15;

// tick_index 0 = start lump (sessions route 가 발급). client heartbeat 은
// 1 부터. 9 = 100분 시점 = 누적 50 credit (start 5 + 9×5). 10 이상은 2시간
// cap 초과로 거부 — client 가 stop 안 누른 경우의 안전망.
const MIN_TICK_INDEX = 1;
const MAX_TICK_INDEX = 9;

const Body = z.object({
  session_id: z.string().uuid(),
  tick_index: z.number().int().min(MIN_TICK_INDEX).max(MAX_TICK_INDEX),
});

// (session_id, tick_index) → deterministic UUID. SHA-256 의 첫 16 바이트에
// version=4 + variant=10xx 비트를 박아 well-formed UUID 로 만든다. 같은
// 입력은 항상 같은 UUID → 재시도 idempotency 가 DB UNIQUE 만으로 성립.
function deriveTickGenerationId(sessionId: string, tickIndex: number): string {
  const digest = createHash('sha256')
    .update(`probing:${sessionId}:tick:${tickIndex}`)
    .digest();
  const hex = digest.toString('hex');
  const v = (parseInt(hex.slice(12, 13), 16) & 0x0) | 0x4; // version = 4
  const r = (parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8; // variant = 10xx
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    v.toString(16) + hex.slice(13, 16),
    r.toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
}

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
  const { session_id, tick_index } = parsed.data;

  const generationId = deriveTickGenerationId(session_id, tick_index);
  const spend = await spendCredits(org.org_id, 'probing', generationId);
  if (!spend.ok) {
    return NextResponse.json(
      {
        error: spend.reason === 'insufficient' ? 'insufficient_credits' : 'forbidden',
        session_id,
        tick_index,
      },
      { status: 402 },
    );
  }

  return NextResponse.json({
    ok: true,
    session_id,
    tick_index,
    // Echo the derived generation_id so the client can confirm in the
    // network panel that same-tick retries collapse to one DB row.
    generation_id: generationId,
  });
}

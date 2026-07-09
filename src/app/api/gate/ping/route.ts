// 동시접속 정원 게이트 — 진입/하트비트/poll 단일 엔드포인트.
//
// client(#505)가 앱 진입 시 1회 호출 + 이후 주기 호출:
//   - admitted → 20s 하트비트 (last_seen 갱신, 슬롯 유지)
//   - waiting  → 5s poll (position 갱신, 앞사람 나가면 자동 승격)
// 둘 다 같은 admit_or_enqueue RPC 를 때리므로 엔드포인트가 하나면 충분.
//
// cap 은 Vercel env(CONCURRENCY_CAP)에서 읽어 RPC 에 넘긴다 — Postgres 함수는
// 앱 env 를 못 읽으므로 route 가 유일한 cap 소스. 슈퍼어드민은 cap 무관 즉시
// 통과(active 에도 안 넣어 cap 계산에서 완전히 빠진다).
//
// RPC 는 service_role 에만 EXECUTE 라 admin client 로 호출한다. account_id 는
// 서버가 검증한 user.id 만 — client 가 임의 account_id 를 못 넘긴다.

import { NextResponse } from 'next/server';
import { env } from '@/env';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';

export const runtime = 'nodejs';
export const maxDuration = 15;

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // 슈퍼어드민 우회 — 대기/카운트 무관 즉시 admitted. active_sessions 에
  // 넣지 않아 다른 사용자의 cap 계산에 영향 0.
  if (isSuperAdminEmail(user.email)) {
    return NextResponse.json({ status: 'admitted', bypass: true });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('admit_or_enqueue', {
    p_account_id: user.id,
    // env 는 문자열(§env.ts) — 여기서 숫자로. zod 가 이미 /^\d+$/ + >0 보장.
    p_cap: Number(env.CONCURRENCY_CAP),
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // data = jsonb: {status:'admitted'} 또는 {status:'waiting', position, cap, active_count}
  return NextResponse.json(data);
}

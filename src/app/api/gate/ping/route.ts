// 위젯별 동시사용 게이트 — 진입/하트비트/poll 단일 엔드포인트.
//
// client(#512)가 위젯 진입 시 1회 호출 + 이후 주기 호출:
//   - admitted → 20s 하트비트 (last_seen 갱신, 슬롯 유지)
//   - waiting  → 5s poll (position 갱신, 앞사람 나가면 자동 승격)
// 둘 다 같은 admit_or_enqueue RPC 를 때리므로 엔드포인트가 하나면 충분.
//
// 게이트 축이 위젯별(widget = FeatureKey)이다 — body 로 어느 위젯인지 받아
// RPC 에 전달한다. 데스크가 붐벼도 통역은 무관(위젯별 slot/queue/lock).
//
// cap 은 Vercel env(CONCURRENCY_CAP)에서 읽어 RPC 에 넘긴다 — Postgres 함수는
// 앱 env 를 못 읽으므로 route 가 유일한 cap 소스. 일단 전 위젯 균일(위젯별
// override 는 후속). 슈퍼어드민은 cap 무관 즉시 통과(active 에도 안 넣어 cap
// 계산에서 완전히 빠진다).
//
// RPC 는 service_role 에만 EXECUTE 라 admin client 로 호출한다. account_id 는
// 서버가 검증한 user.id 만 — client 가 임의 account_id 를 못 넘긴다. widget 은
// isFeatureKey 로 화이트리스트 검증 — 임의 문자열이 게이트 테이블에 쌓이는
// 것을 차단.

import { NextResponse } from 'next/server';
import { env } from '@/env';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { isFeatureKey } from '@/lib/features';

export const runtime = 'nodejs';
export const maxDuration = 15;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // body 에서 widget(=FeatureKey) 추출. 잘못된 JSON 은 빈 객체로 폴백.
  const body = (await request.json().catch(() => ({}))) as { widget?: unknown };
  if (!isFeatureKey(body.widget)) {
    return NextResponse.json({ error: 'invalid_widget' }, { status: 400 });
  }
  const widget = body.widget;

  // 슈퍼어드민 우회 — 대기/카운트 무관 즉시 admitted. widget_active_uses 에
  // 넣지 않아 다른 사용자의 (해당 위젯) cap 계산에 영향 0.
  if (isSuperAdminEmail(user.email)) {
    return NextResponse.json({ status: 'admitted', widget_key: widget, bypass: true });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('admit_or_enqueue', {
    p_widget_key: widget,
    p_account_id: user.id,
    // env 는 문자열(§env.ts) — 여기서 숫자로. zod 가 이미 /^\d+$/ + >0 보장.
    p_cap: Number(env.CONCURRENCY_CAP),
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // data = jsonb: {status:'admitted', widget_key} 또는
  //   {status:'waiting', widget_key, position, cap, active_count}
  return NextResponse.json(data);
}

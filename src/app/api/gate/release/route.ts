// 동시접속 정원 게이트 — 슬롯 즉시 반납.
//
// client(#505)가 페이지 unload/logout 시 navigator.sendBeacon 으로 호출.
// sendBeacon 은 same-origin 쿠키를 실어 보내므로 cookie 기반 auth 가 성립한다
// (커스텀 헤더는 못 붙이지만 sb-* 세션 쿠키로 getUser 통과).
//
// active_sessions + concurrency_queue 양쪽에서 해당 계정을 제거. 슬롯이 즉시
// 비면 다음 사람의 ping 때 대기열 맨 앞이 승격된다(승격은 admit_or_enqueue 가
// 담당 — release 는 삭제만, 승격 로직 중복 X).
//
// best-effort — 반납 실패해도 lazy sweep(RPC) / cron sweep 이 TTL 후 회수하므로
// 치명적이지 않다. 그래도 에러는 로깅용으로 상태코드에 반영.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 15;

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  const active = await admin
    .from('active_sessions')
    .delete()
    .eq('account_id', user.id);
  const queued = await admin
    .from('concurrency_queue')
    .delete()
    .eq('account_id', user.id);

  const error = active.error ?? queued.error;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, released: true });
}

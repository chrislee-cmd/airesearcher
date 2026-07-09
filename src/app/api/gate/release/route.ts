// 위젯별 동시사용 게이트 — (위젯) 슬롯 즉시 반납.
//
// client(#512)가 위젯 이탈/unload/logout 시 navigator.sendBeacon 으로 호출.
// sendBeacon 은 same-origin 쿠키를 실어 보내므로 cookie 기반 auth 가 성립한다
// (커스텀 헤더는 못 붙이지만 sb-* 세션 쿠키로 getUser 통과). widget 은 beacon
// body(JSON Blob)로 전달한다.
//
// widget_active_uses + widget_use_queue 양쪽에서 (해당 위젯, 계정)을 제거.
// 슬롯이 즉시 비면 다음 사람의 ping 때 그 위젯 대기열 맨 앞이 승격된다(승격은
// admit_or_enqueue 가 담당 — release 는 삭제만, 승격 로직 중복 X).
//
// best-effort — 반납 실패해도 lazy sweep(RPC) / cron sweep 이 TTL 후 회수하므로
// 치명적이지 않다. 그래도 에러는 로깅용으로 상태코드에 반영.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isFeatureKey } from '@/lib/features';

export const runtime = 'nodejs';
export const maxDuration = 15;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // beacon body 에서 widget(=FeatureKey) 추출. 잘못된 JSON 은 빈 객체로 폴백.
  const body = (await request.json().catch(() => ({}))) as { widget?: unknown };
  if (!isFeatureKey(body.widget)) {
    return NextResponse.json({ error: 'invalid_widget' }, { status: 400 });
  }
  const widget = body.widget;

  const admin = createAdminClient();

  const active = await admin
    .from('widget_active_uses')
    .delete()
    .eq('widget_key', widget)
    .eq('account_id', user.id);
  const queued = await admin
    .from('widget_use_queue')
    .delete()
    .eq('widget_key', widget)
    .eq('account_id', user.id);

  const error = active.error ?? queued.error;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, released: true, widget_key: widget });
}

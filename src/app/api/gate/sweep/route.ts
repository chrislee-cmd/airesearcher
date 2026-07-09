// 위젯별 동시사용 게이트 — 좀비 정리 백스톱(cron).
//
// primary sweep 은 admit_or_enqueue RPC 안의 lazy sweep(매 ping, 위젯별) 이다.
// 하지만 ping 이 뜸한 순간(모든 active 가 조용, 대기자 없음)엔 좀비 슬롯이 TTL
// 넘겨 살아있어 다음 대기자의 입장을 늦출 수 있다. 이 cron 이 1분 주기로 백스톱:
// 전 위젯에 걸쳐 TTL 지난 active/queue 행을 무조건 회수해 슬롯을 푼다. TTL 은
// widget_key 무관 동일하므로 last_seen/last_poll 만으로 전 위젯 일괄 정리.
//
// Auth: 표준 Vercel cron 패턴 — Authorization: Bearer <CRON_SECRET>. Vercel
// cron 은 GET 을 발행하므로 GET 핸들러(다른 cron 라우트와 동일 컨벤션).
// CRON_SECRET 은 env.ts 에서 required(PR-SEC21 fail-closed) 라 항상 존재.
//
// TTL 은 admit_or_enqueue RPC 의 SQL 상수(active 45s / queue 30s)와 반드시
// 일치시킨다 — 한 쪽만 바꾸면 sweep 기준이 어긋난다.

import { NextResponse } from 'next/server';
import { env } from '@/env';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 30;

// admit_or_enqueue RPC 의 active_ttl / queue_ttl 과 동일해야 한다.
const ACTIVE_TTL_SECONDS = 45;
const QUEUE_TTL_SECONDS = 30;

function authorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? '';
  return header === `Bearer ${env.CRON_SECRET}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const activeCutoff = new Date(Date.now() - ACTIVE_TTL_SECONDS * 1000).toISOString();
  const queueCutoff = new Date(Date.now() - QUEUE_TTL_SECONDS * 1000).toISOString();

  const staleActive = await admin
    .from('widget_active_uses')
    .delete()
    .lt('last_seen', activeCutoff)
    .select('widget_key, account_id');
  if (staleActive.error) {
    return NextResponse.json({ error: staleActive.error.message }, { status: 500 });
  }

  const staleQueue = await admin
    .from('widget_use_queue')
    .delete()
    .lt('last_poll', queueCutoff)
    .select('widget_key, account_id');
  if (staleQueue.error) {
    return NextResponse.json({ error: staleQueue.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    swept_active: staleActive.data?.length ?? 0,
    swept_queue: staleQueue.data?.length ?? 0,
  });
}

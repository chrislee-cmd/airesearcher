// 무료 월 크레딧 grant — 월초 cron (docs/pricing-scheme.md §5.4).
//
// 매월 1일, 무제한(ops/super-admin) 이 아닌 전 활성 org 에 25cr 무료 grant 를
// 세팅한다(grant_credits=25, grant_expires_at=월말). issue_monthly_grants()
// RPC 가 세트 기반으로 멱등 지급 — 이달 이미 free_grant 원장 row 가 있는 org
// (신규 가입 시 handle_new_user 가 시딩한 org 포함)는 건너뛴다. 재실행해도
// 중복 지급이 0 이라 vercel cron 이 늦게/중복 트리거해도 안전하다.
//
// Auth: 표준 Vercel cron 패턴 — Authorization: Bearer <CRON_SECRET>.
// CRON_SECRET 은 env.ts 에서 필수라 런타임에 항상 존재(fail-closed).

import { NextResponse } from 'next/server';
import { env } from '@/env';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? '';
  return header === `Bearer ${env.CRON_SECRET}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('issue_monthly_grants');

  if (error) {
    return NextResponse.json(
      { error: 'grant_failed', detail: error.message },
      { status: 500 },
    );
  }

  // RPC 반환 = 이번 실행에서 실제 지급된 org 수.
  return NextResponse.json({ ok: true, granted: data ?? 0 });
}

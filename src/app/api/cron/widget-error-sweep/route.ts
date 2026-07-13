// 중앙 에러 관측 Phase 1 — 위젯 job-fail 스윕 cron (docs/error-observability.md §3).
//
// admin/analytics.ts 의 widgetHealth 레지스트리를 SSOT 로 재사용해, 각 위젯 job
// 테이블의 신규 fail 행을 error_events 로 적재한다. 개별 catch 계측 없이 전 위젯
// job 실패를 자동 커버. DB 로그 폴링(error-log-poll)과 달리 Supabase PAT 가
// 필요 없다(service_role 만으로 동작) — 그래서 별도 cron 으로 분리해 독립적으로
// 돈다.
//
// dedup/워터마크 로직은 widget-error-sweep.ts 참고(error_events.last_seen 활용).
//
// Auth: 표준 Vercel cron 패턴 — Authorization: Bearer <CRON_SECRET>, fail-closed.

import { NextResponse } from 'next/server';
import { env } from '@/env';
import { sweepWidgetErrors } from '@/lib/observability/widget-error-sweep';

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

  const results = await sweepWidgetErrors();
  const ingested = results.reduce((sum, r) => sum + r.newFails, 0);
  return NextResponse.json({ ok: true, ingested, results });
}

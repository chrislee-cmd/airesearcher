// Topline resume-sweep cron — 서버발 self-heal (카드 #469).
//
// 배경: 대형 프로젝트 탑라인(map-reduce)은 한 함수 호출(300s) 안에 못 끝나
// self-kick(/resume) 체인으로 여러 홉을 이어간다. 그 체인이 조용히 끊기면
// (cold-start fetch 실패·과부하·타임아웃) 백그라운드 함수가 죽어 row 가
// 'generating' 에 갇힌다. #1014 는 GET on-read self-heal(360s)로 이를 회복시켰지만,
// 두 가지 한계가 남았다:
//   1) **6분(360s) 창** — hop 체인이 끊긴 뒤 최대 6분 기다려야 재점화.
//   2) **client-GET 의존** — 사용자가 페이지를 열어 GET 을 쳐야만 발화. 페이지를
//      닫으면 재점화가 안 돼 완주가 무한 지연될 수 있다.
//
// 이 cron 은 그 둘을 제거한다: 백그라운드에서 **client 무관**하게 돌며,
// updated_at 이 90s(TOPLINE_CRON_STALE_MS) 넘게 정체된 'generating' 탑라인을
// 찾아 재개 체인을 재점화한다. 재점화 로직은 GET 경로와 **동일한**
// selfHealStaleTopline 을 재사용 — resume_count bump + kickResume + MAX_RESUME_HOPS
// 가드 + 홉 소진 시 error 종결이 모두 그 안에 있어 멱등/스키마 불변이 보장된다.
//
// 정상 진행 방해 0: 살아 있는 홉은 map 진행/부분 flush 마다 updated_at 을
// bump 하므로 90s 창을 넘기지 않아 이 쿼리에 잡히지 않는다. 재점화 시의 bump 도
// updated_at 을 갱신하므로 같은 row 는 다음 90s 전까지 재대상에서 빠져
// kick 폭주 없이 창당 최대 1회로 자연 바운드된다.
//
// 인증: 표준 Vercel cron 패턴 — Authorization: Bearer <CRON_SECRET>, fail-closed
// (cron/retention·interview-failure-alert·topline/resume 와 동일). Vercel cron 은
// GET 을 발행한다. service_role(createAdminClient)로 돌아 RLS 를 우회한다.

import { NextResponse } from 'next/server';
import { env } from '@/env';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  selfHealStaleTopline,
  type InterviewToplineRow,
} from '@/lib/interview-v2/topline';
import { TOPLINE_CRON_STALE_MS } from '@/lib/interview-v2/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

// 한 스윕에서 재점화할 stale 탑라인 상한 — 정상 상황에선 0~1건이지만, provider
// 장애 등으로 다수가 동시에 stall 해도 한 스윕이 폭주하지 않게 캡. 초과분은
// 다음 스윕(1분 뒤)에서 자연히 소진된다(updated_at 정체가 유지되므로).
const QUERY_LIMIT = 50;

function authorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? '';
  return header === `Bearer ${env.CRON_SECRET}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const nowMs = Date.now();
  const cutoff = new Date(nowMs - TOPLINE_CRON_STALE_MS).toISOString();

  // updated_at 이 90s 넘게 정체된 'generating' = 체인이 끊긴 stuck 후보.
  // 오래된 것부터(재점화 우선순위) 처리, 스윕당 상한.
  const { data, error } = await admin
    .from('interview_toplines')
    .select('*')
    .eq('status', 'generating')
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(QUERY_LIMIT);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as InterviewToplineRow[];
  let rekicked = 0;
  let errored = 0;
  let contended = 0;
  for (const row of rows) {
    // GET self-heal 과 동일 로직 — phase+홉예산 있으면 재점화(generating),
    // 홉 소진/durable 상태 없음이면 진행도 포함 error 종결. 그 사이 done/재생성
    // 으로 바뀐 경합은 no-op(row.status 그대로 반환).
    const healed = await selfHealStaleTopline(admin, row, nowMs);
    if (healed.status === 'error') errored += 1;
    else if (healed.status === 'generating') rekicked += 1;
    else contended += 1;
  }

  return NextResponse.json({
    ok: true,
    swept: rows.length,
    rekicked,
    errored,
    contended,
  });
}

import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { env } from '@/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { getToplineById, runTopline } from '@/lib/interview-v2/topline';
import { TOPLINE_DEFAULT_LANG } from '@/lib/interview-v2/topline-prompt';

// 인터뷰 탑라인 생성 durable 재개 — **내부** 엔드포인트 (카드 #434).
//
// 대형 프로젝트의 map-reduce 는 한 함수 호출(maxDuration=300s) 안에 완주 못 한다.
// runTopline(=stepper)은 시간예산(~230s)만큼 map 하고 남은 작업이 있으면 이
// 엔드포인트를 self-kick 해 **신선한 300s** 함수로 이어간다. map 은 per-doc
// extract 캐시가 곧 커서라 재진입 시 완료분 재map 0.
//
// 인증: 생성을 시작한 사용자 세션 없이 함수→함수로 호출되므로 CRON_SECRET
// Bearer 로 인증한다(cron/retention·translate/cleanup 과 동일 패턴, fail-closed).
// org/project/lang 은 요청 바디가 아니라 row 에서 복원 — 위조된 body 로 남의
// 프로젝트를 생성시킬 여지가 없다(topline_id 는 admin 조회로 실존 검증).
//
// 응답 즉시 반환(202) + 무거운 생성은 after() 로 스케줄 — POST /topline 과 동일.

export const maxDuration = 300;

const Body = z.object({
  topline_id: z.string().uuid(),
});

function isAuthorized(req: Request): boolean {
  const header = req.headers.get('authorization');
  return header === `Bearer ${env.CRON_SECRET}`;
}

export async function POST(req: Request) {
  // fail-closed — CRON_SECRET 은 env.ts 에서 required(min 16). 헤더 불일치면 401.
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { topline_id } = parsed.data;

  const admin = createAdminClient();
  const row = await getToplineById(admin, topline_id);
  if (!row) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // 이미 done/error 로 정리됐거나(다른 홉이 완주) 아직 시작 전이면 재개 불필요.
  // 유령 재개(취소/완료 후 뒤늦은 kick)를 여기서 걸러 무거운 함수를 안 띄운다.
  if (row.status !== 'generating') {
    return NextResponse.json({ status: row.status, skipped: true });
  }

  // 다음 홉 실행 — org/project/lang 은 row 에서 복원. runTopline 이 캐시 기준으로
  // map/reduce 단계를 재유도하고, 남으면 다시 self-kick 한다.
  after(() =>
    runTopline(admin, {
      toplineId: row.id,
      orgId: row.org_id,
      projectId: row.project_id,
      outputLang: row.output_lang ?? TOPLINE_DEFAULT_LANG,
    }),
  );

  return NextResponse.json({ status: 'generating', resumed: true });
}

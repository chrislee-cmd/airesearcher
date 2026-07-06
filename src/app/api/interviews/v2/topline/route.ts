import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { checkLlmRateLimit } from '@/lib/rate-limit';
import {
  computeProjectCorpus,
  getTopline,
  upsertGenerating,
  runTopline,
  TOPLINE_MODEL,
} from '@/lib/interview-v2/topline';

// 인터뷰 탑라인 보고서 — 생성/캐시 엔드포인트.
//
// POST { project_id, force? }:
//   1. 인덱싱 완료 확인 — 프로젝트 chunk 0 개면 409(not_indexed).
//   2. 캐시 — 기존 row 가 status='done' 이고 content_hash 가 현재 프로젝트
//      문서 셋 해시와 같으면 즉시 반환(LLM 0). force=true 면 무시하고 재생성.
//   3. row 를 'generating' 으로 마킹하고 Opus 생성을 after() 로 스케줄 —
//      요청은 즉시 { status:'generating' } 반환. 클라이언트는 realtime/폴링으로
//      status 전이를 관찰(기존 DB-backed job 패턴, desk_jobs 와 동일).
//
// 근거 = 프로젝트 전체 chunk(선택 영역 X). 인용은 근거 chunk_id 집합에 대해
// 재검증(지어낸 id drop). 신규 과금 없음(비용은 캐시로 통제 — 사용자 결정).
//
// RLS/격리: 모든 조회·쓰기는 org_id 경계로 스코프. 타 org 프로젝트를 넘기면
// computeProjectCorpus 가 문서 0 개 → chunk 0 → 409 로 떨어진다(정보 누출 X).

export const maxDuration = 300;

const Body = z.object({
  project_id: z.string().uuid(),
  force: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const org = await getActiveOrg();
  if (!org?.org_id) {
    return NextResponse.json({ error: 'no_org' }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { project_id, force } = parsed.data;

  const admin = createAdminClient();

  // 프로젝트가 이 org 소유인지 확인 — 아니면 not_found(정보 누출 방지).
  const { data: projectRow } = await admin
    .from('interview_projects')
    .select('id')
    .eq('id', project_id)
    .eq('org_id', org.org_id)
    .maybeSingle();
  if (!projectRow) {
    return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
  }

  let hash: string;
  let chunkCount: number;
  try {
    const corpus = await computeProjectCorpus(admin, org.org_id, project_id);
    hash = corpus.hash;
    chunkCount = corpus.chunkCount;
  } catch (e) {
    console.error('[v2/topline] corpus failed', e);
    return NextResponse.json({ error: 'corpus_failed' }, { status: 500 });
  }

  // 인덱싱 미완(또는 문서 없음) — 아직 근거가 없으므로 생성 불가.
  if (chunkCount === 0) {
    return NextResponse.json({ error: 'not_indexed' }, { status: 409 });
  }

  const existing = await getTopline(admin, project_id);

  // 캐시 히트 — 해시 동일 & 완료 & 강제재생성 아님 → LLM 0.
  if (
    !force &&
    existing?.status === 'done' &&
    existing.content_hash === hash
  ) {
    return NextResponse.json({
      topline_id: existing.id,
      status: 'done',
      cached: true,
      blocks: existing.blocks,
      generated_at: existing.generated_at,
      model: existing.model,
    });
  }

  // 이미 다른 요청이 생성 중이면 중복 kick 하지 않는다.
  if (existing?.status === 'generating') {
    return NextResponse.json({
      topline_id: existing.id,
      status: 'generating',
      cached: false,
    });
  }

  // LLM 호출을 태우므로 rate-limit 게이트(생성 경로에서만).
  const limited = await checkLlmRateLimit(user.id, org.org_id);
  if (limited) return limited;

  let toplineId: string;
  try {
    toplineId = await upsertGenerating(admin, {
      orgId: org.org_id,
      projectId: project_id,
      hash,
    });
  } catch (e) {
    console.error('[v2/topline] upsert failed', e);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  // 무거운 Opus 생성은 응답 후 실행(desk_jobs 패턴). Vercel 이 maxDuration 까지
  // 함수를 살려둔다.
  after(() =>
    runTopline(admin, {
      toplineId,
      orgId: org.org_id,
      projectId: project_id,
    }),
  );

  return NextResponse.json({
    topline_id: toplineId,
    status: 'generating',
    cached: false,
    model: TOPLINE_MODEL,
  });
}

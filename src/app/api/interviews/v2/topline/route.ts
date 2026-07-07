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

// 'generating' 리스(lease) — stuck 생성 자동 복구용.
//
// runTopline 은 실패를 catch 해 status='error' 를 쓰지만, 함수가 maxDuration
// (300s) 타임아웃/크래시로 **kill** 되면 catch 가 못 돌아 row 가 'generating'
// 에 영구 잔류한다. 아래 POST 의 generating 분기가 나이 체크 없이 재-kick 을
// 막으면 UI 가 "생성 중…" 에 무한 고착된다(2026-07-07 사고: 55-doc/1.9M자
// 프로젝트가 300s 초과로 wedge). live map-reduce 는 문서 완료마다 updated_at
// 을 bump 하고 함수는 어차피 maxDuration 을 못 넘기므로, updated_at 이 이보다
// 오래 방치된 'generating' 은 죽은 생성이다 — 재-kick 한다. 여유 60s 를 더해
// 정상 종료 직전 job 을 오판하지 않는다.
const GENERATING_LEASE_MS = (300 + 60) * 1000;

const Body = z.object({
  project_id: z.string().uuid(),
  force: z.boolean().optional().default(false),
});

// GET ?project_id=<uuid> — 읽기 전용 조회. 2-tab UI 가 탭 열자마자 저장된
// 탑라인을 **생성 트리거 없이** 읽는다 (POST 는 stale/미존재 시 Opus 를
// kick 하므로 초기 로드에 쓰면 원치 않는 과금). stale 여부(현재 문서 셋
// 해시 ≠ 저장 해시)만 계산해 배너 판단을 클라이언트에 넘긴다.
export async function GET(req: Request) {
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

  const projectId = new URL(req.url).searchParams.get('project_id') ?? '';
  if (!z.string().uuid().safeParse(projectId).success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const admin = createAdminClient();

  // 프로젝트가 이 org 소유인지 확인 — 아니면 not_found(정보 누출 방지).
  const { data: projectRow } = await admin
    .from('interview_projects')
    .select('id')
    .eq('id', projectId)
    .eq('org_id', org.org_id)
    .maybeSingle();
  if (!projectRow) {
    return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
  }

  let hash: string;
  let chunkCount: number;
  try {
    const corpus = await computeProjectCorpus(admin, org.org_id, projectId);
    hash = corpus.hash;
    chunkCount = corpus.chunkCount;
  } catch (e) {
    console.error('[v2/topline] GET corpus failed', e);
    return NextResponse.json({ error: 'corpus_failed' }, { status: 500 });
  }

  const existing = await getTopline(admin, projectId);

  // stuck 'generating' 을 읽기 전용으로 감지해 UI 에 재시도 경로를 연다. row 가
  // 'generating' 인데 lease(GENERATING_LEASE_MS)가 만료됐으면 생성 함수가 죽은
  // 것 — DB 는 건드리지 않고(GET 은 무과금·무부작용) 응답 status 만 'error' 로
  // 표면화한다. 실제 재-kick 은 사용자가 재생성(POST)할 때 lease 분기가 처리.
  const leaseExpired =
    existing?.status === 'generating' &&
    Date.now() - new Date(existing.updated_at).getTime() >= GENERATING_LEASE_MS;

  return NextResponse.json({
    // 'none' = 아직 생성된 적 없음(CTA). 그 외는 row.status 그대로.
    // lease 만료된 stuck 'generating' 은 'error' 로 보고(재시도 CTA 노출).
    status: leaseExpired ? 'error' : existing?.status ?? 'none',
    blocks: existing?.blocks ?? [],
    // 저장 해시와 현재 문서 셋 해시가 다르면 파일이 바뀐 것 = stale.
    // row 가 없으면 stale 아님(그냥 미생성).
    stale: existing ? existing.content_hash !== hash : false,
    // 인덱싱 전이면 생성 자체가 불가 — CTA 대신 안내 문구.
    indexed: chunkCount > 0,
    generated_at: existing?.generated_at ?? null,
    model: existing?.model ?? null,
    error_message: leaseExpired
      ? '생성이 중단되었습니다. 다시 생성해 주세요.'
      : existing?.error_message ?? null,
    // map-reduce 진행률 — generating 중 "N/M 문서 분석" 표시(map_total 이 null 인
    // 레거시 row 는 UI 가 진행률을 숨기고 단순 스켈레톤만).
    map_total: existing?.map_total ?? null,
    map_done: existing?.map_done ?? null,
  });
}

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

  // 이미 다른 요청이 생성 중이면 중복 kick 하지 않는다 — 단, 그 생성이 아직
  // 살아있을 때만. lease 가 만료된(= 죽은) 생성은 재-kick 해 stuck 을 자동
  // 복구한다(위 GENERATING_LEASE_MS 주석 참고). upsertGenerating 이 row 를
  // 깨끗이 덮으므로(status/error_message/map 진행률 리셋) 재시작은 안전하다.
  if (existing?.status === 'generating') {
    const ageMs = Date.now() - new Date(existing.updated_at).getTime();
    if (ageMs < GENERATING_LEASE_MS) {
      return NextResponse.json({
        topline_id: existing.id,
        status: 'generating',
        cached: false,
      });
    }
    console.warn('[v2/topline] stale generating lease expired — re-kicking', {
      project_id,
      topline_id: existing.id,
      age_ms: ageMs,
    });
    // fall through: 죽은 생성으로 판단 → 아래에서 재-kick.
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

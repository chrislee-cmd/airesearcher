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
import {
  TOPLINE_OUTPUT_LANGS,
  TOPLINE_DEFAULT_LANG,
  TOPLINE_DIRECTION_MAX,
} from '@/lib/interview-v2/topline-prompt';
import { isToplineGeneratingStale } from '@/lib/interview-v2/types';

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
  // 출력 언어 — 입력 transcript 언어와 독립적으로 보고서 언어를 강제(사용자
  // 결정 1). 미지정이면 기본(한국어) — 기존 클라이언트/동작 회귀 X. 캐시 키의
  // 일부라 언어를 바꾸면 문서셋이 같아도 재생성한다(결정 3).
  output_lang: z.enum(TOPLINE_OUTPUT_LANGS).optional(),
  // 재생성 방향 — 사용자가 자유 텍스트로 지정한 분석 방향(선택). reduce system
  // prompt 에 주입돼 강조점·구성을 조정한다. 미지정/빈 값이면 방향 없음(옛 동작).
  // 캐시 키의 일부라 방향이 다르면 문서셋·언어가 같아도 재생성한다. 길이는
  // TOPLINE_DIRECTION_MAX 로 제한(프롬프트 토큰/주입 표면 통제).
  user_direction: z.string().max(TOPLINE_DIRECTION_MAX).optional(),
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

  // stuck 'generating' on-read 정리 (결정 C) — maxDuration(300s) 타임아웃/크래시로
  // 백그라운드 함수가 죽으면 runTopline catch 가 안 돌아 status 가 영구
  // 'generating' 에 갇힌다(재생성·추가질문 데드락). updated_at 이 STALE 창을
  // 넘긴 'generating' 은 여기서 'error' 로 flip 해 잠금을 푼다. status 조건부
  // update 로 그 사이 done 된 경합은 no-op. 실패해도 아래 응답은 클라 stuck
  // 판정(동일 updated_at 기준)으로 여전히 재생성 가능하므로 best-effort.
  let readStatus = existing?.status ?? 'none';
  let readErrorMessage = existing?.error_message ?? null;
  if (existing && isToplineGeneratingStale(existing, Date.now())) {
    const { error: flipErr } = await admin
      .from('interview_toplines')
      .update({ status: 'error', error_message: 'stuck_timeout' })
      .eq('id', existing.id)
      .eq('status', 'generating');
    if (!flipErr) {
      readStatus = 'error';
      readErrorMessage = 'stuck_timeout';
    }
  }

  return NextResponse.json({
    // interview_toplines.id — 공유 링크(#477) resource_id. 미생성이면 null.
    id: existing?.id ?? null,
    // 'none' = 아직 생성된 적 없음(CTA). 그 외는 row.status(단, stuck 은 error 로
    // 정리된 값).
    status: readStatus,
    blocks: existing?.blocks ?? [],
    // 저장 해시와 현재 문서 셋 해시가 다르면 파일이 바뀐 것 = stale.
    // row 가 없으면 stale 아님(그냥 미생성).
    stale: existing ? existing.content_hash !== hash : false,
    // 마지막 생성에 쓰인 출력 언어 — UI 언어 선택기 초기값. null(레거시/미생성)
    // 이면 클라이언트가 기본(한국어)으로 표시.
    output_lang: existing?.output_lang ?? null,
    // 마지막 재생성에 쓰인 방향 — UI 재생성 모달 textarea 초기값(마지막에 지정한
    // 방향을 다시 보여줌). null(방향 없음/레거시/미생성)이면 빈 입력으로 시작.
    user_direction: existing?.user_direction ?? null,
    // 인덱싱 전이면 생성 자체가 불가 — CTA 대신 안내 문구.
    indexed: chunkCount > 0,
    generated_at: existing?.generated_at ?? null,
    model: existing?.model ?? null,
    error_message: readErrorMessage,
    // map-reduce 진행률 — generating 중 "N/M 문서 분석" 표시(map_total 이 null 인
    // 레거시 row 는 UI 가 진행률을 숨기고 단순 스켈레톤만).
    map_total: existing?.map_total ?? null,
    map_done: existing?.map_done ?? null,
    // 마지막 갱신 시각 — 클라가 stuck 'generating'(살아 있으면 bump 됨) 을
    // 판정해 재생성을 활성화하는 기준(카드 #483).
    updated_at: existing?.updated_at ?? null,
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
  const { project_id, force, output_lang, user_direction } = parsed.data;
  // 요청 언어 정규화 — 미지정 = 기본(한국어). 캐시 비교/저장 모두 이 값 기준.
  const requestLang = output_lang ?? TOPLINE_DEFAULT_LANG;
  // 요청 방향 정규화 — trim 후 빈 문자열이면 null(방향 없음). 캐시 비교/저장
  // 모두 이 값 기준(레거시/방향 없음 row 의 user_direction 도 null 이라 정합).
  const requestDirection = user_direction?.trim() || null;

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

  // 캐시 히트 — 해시 동일 & **언어 동일** & **방향 동일** & 완료 & 강제재생성
  // 아님 → LLM 0. 언어/방향이 다르면 문서셋이 같아도 재생성(옛 캐시 오반환 방지
  // — 결정 3). 레거시 row(output_lang=null)는 기본 언어(한국어)로, 방향 없음 row
  // (user_direction=null)는 null 로 취급 — 양쪽 다 null 이면 방향 없이 매칭.
  if (
    !force &&
    existing?.status === 'done' &&
    existing.content_hash === hash &&
    (existing.output_lang ?? TOPLINE_DEFAULT_LANG) === requestLang &&
    (existing.user_direction ?? null) === requestDirection
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

  // 이미 다른 요청이 생성 중이면 중복 kick 하지 않는다(중복 방지). 단 아래는
  // override 해서 재생성한다(결정 B/C):
  //   - force=true : 사용자가 명시 재생성(멈춘 것 같아 다시 누름).
  //   - stuck      : updated_at 이 STALE 창 초과 = 백그라운드 함수 사망 →
  //                  살아 있는 생성이 아니므로 잠금을 풀고 재실행.
  // upsertGenerating(onConflict project_id)이 row 를 새 'generating' 으로 리셋한다.
  if (
    existing?.status === 'generating' &&
    !force &&
    !isToplineGeneratingStale(existing, Date.now())
  ) {
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
      outputLang: requestLang,
      userDirection: requestDirection ?? undefined,
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
      outputLang: requestLang,
      userDirection: requestDirection ?? undefined,
    }),
  );

  return NextResponse.json({
    topline_id: toplineId,
    status: 'generating',
    cached: false,
    model: TOPLINE_MODEL,
  });
}

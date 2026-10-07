import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import {
  isChainTemplateKey,
  isValidStartAt,
  instantiateSteps,
} from '@/lib/chains/registry';
import { ACTIVE_STATUSES } from '@/lib/chains/state';

// 위젯 연쇄 체인 — 컬렉션 엔드포인트 (생성 + 활성 조회).
//
// 이 PR(A)은 데이터 모델·API 기반층만 — 소비자(advance 훅·UI)는 후속 B·D.
// 체인을 생성해도 자동으로 위젯이 돌지 않는다(kick 은 B 가 연결). 생성은
// 첫 단계를 승인 대기(approve 모드) 또는 러너블(auto)로 세팅만 한다.
//
// POST { template, startAt?, mode?, project_id? } — 체인 생성.
//   - 402(크레딧) 사전 검증은 하지 않는다 — 각 단계가 자기 차감 지점을 소유
//     한다(점검 §1a). 체인은 새 차감을 만들지 않는다.
//   - 프로젝트당 활성 체인 1 제약(partial unique index)이 DB 레벨에서 중복
//     생성을 막는다 — 위반 시 23505 → 409(active_chain_exists).
// GET ?project_id=<uuid> — 해당 프로젝트의 활성 체인 조회(없으면 null).

const CreateBody = z.object({
  // 정적 레지스트리 키. 파일럿: 'interview_pipeline'. 런타임 세밀 검증은
  // isChainTemplateKey 로(enum 하드코딩 대신 레지스트리 SSOT 참조).
  template: z.string().min(1),
  // 가변 진입점 — 템플릿 steps 내 시작 인덱스. 기본 0(처음부터). 전사록부터
  // 진입하면 startAt=1.
  startAt: z.number().int().min(0).optional().default(0),
  // 승인 모드. 기본 approve(사용자 결정 1 — auto 는 명시 opt-in).
  mode: z.enum(['approve', 'auto']).optional().default('approve'),
  // 대상 interviews 프로젝트. 프로빙 진입 시 미귀속이면 생략 가능(R8).
  project_id: z.string().uuid().optional(),
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

  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { template, startAt, mode, project_id } = parsed.data;

  if (!isChainTemplateKey(template)) {
    return NextResponse.json({ error: 'unknown_template' }, { status: 400 });
  }
  // 진입점 검증 — 범위 내이고 entry 가능 단계여야 한다.
  if (!isValidStartAt(template, startAt)) {
    return NextResponse.json({ error: 'invalid_start' }, { status: 400 });
  }

  const admin = createAdminClient();

  // project_id 가 주어지면 이 org 소유 프로젝트인지 확인(정보 누출 방지).
  if (project_id) {
    const { data: projectRow } = await admin
      .from('interview_projects')
      .select('id')
      .eq('id', project_id)
      .eq('org_id', org.org_id)
      .maybeSingle();
    if (!projectRow) {
      return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
    }
  }

  // 단계 인스턴스 — startAt 부터의 suffix 를 pending 으로. 첫 단계(커서 0)는
  // approve 모드면 승인 대기, auto 면 러너블(kick 은 B). current_step 은 항상
  // 0(인스턴스 배열 기준 상대 인덱스).
  const steps = instantiateSteps(template, startAt);
  // 첫 단계(커서 0)와 체인 status 를 모드에 맞춘다: approve → 승인 대기,
  // auto → 러너블(kick 은 B). 두 값이 동일하게 매핑된다.
  const chainStatus = mode === 'auto' ? 'running' : 'awaiting_approval';
  steps[0] = { ...steps[0], status: chainStatus };

  const { data, error } = await admin
    .from('widget_chains')
    .insert({
      org_id: org.org_id,
      project_id: project_id ?? null,
      created_by: user.id,
      mode,
      template,
      steps,
      current_step: 0,
      status: chainStatus,
    })
    .select()
    .single();

  if (error) {
    // 23505 = unique_violation — 프로젝트당 활성 체인 1 제약 위반(R7).
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'active_chain_exists' },
        { status: 409 },
      );
    }
    console.error('[chains] create failed', error);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  return NextResponse.json({ chain: data }, { status: 201 });
}

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

  // 해당 프로젝트의 활성 체인(프로젝트당 1). 종결 체인은 제외. org 스코프로
  // 타 org 누출 방지. 활성이 없으면 chain:null.
  const { data, error } = await admin
    .from('widget_chains')
    .select('*')
    .eq('org_id', org.org_id)
    .eq('project_id', projectId)
    .in('status', [...ACTIVE_STATUSES])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[chains] list failed', error);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  return NextResponse.json({ chain: data ?? null });
}

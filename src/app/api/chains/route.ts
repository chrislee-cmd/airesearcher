import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import {
  instantiateSteps,
  isLegacyTemplateKey,
  legacyTemplateSteps,
  validateSteps,
  type ChainStepKey,
} from '@/lib/chains/registry';
import { ACTIVE_STATUSES } from '@/lib/chains/state';

// 위젯 연쇄 체인 — 컬렉션 엔드포인트 (생성 + 활성 조회).
//
// 생성은 체인을 **자유 조합**으로 받는다(A') — 사용자가 빈 체인에 위젯을
// 드래그로 도킹해 만든 임의의 feature 시퀀스를 받고, 서버는 그것이 호환
// 그래프(registry 의 CHAIN_COMPAT_EDGES) 위의 경로인지만 검증한다. 프론트도
// 드롭 가드에 같은 validateSteps 를 쓰므로 이 검증은 **권위 재실행**이다
// (판정 SSOT 는 registry 모듈 하나 — API 로 노출하지 않는다).
//
// 체인을 생성해도 자동으로 위젯이 돌지 않는다(kick 은 B/advance). 생성은 첫
// 단계를 승인 대기(approve 모드) 또는 러너블(auto)로 세팅만 한다.
//
// POST { steps: string[], mode?, project_id? } — 체인 생성.
//   - 레거시 `{ template, startAt? }` 도 당분간 수용한다 — v2 UI 가 홀드 중이라
//     아직 이 body 를 보낸다. feature 시퀀스로 환원한 뒤 **동일한 검증**을 탄다
//     (경로 2개, 검증 1개). 호출자 전환 완료 시 삭제.
//   - 402(크레딧) 사전 검증은 하지 않는다 — 각 단계가 자기 차감 지점을 소유
//     한다(점검 §1a). 체인은 새 차감을 만들지 않는다.
//   - 프로젝트당 활성 체인 1 제약(partial unique index)이 DB 레벨에서 중복
//     생성을 막는다 — 위반 시 23505 → 409(active_chain_exists).
// GET ?project_id=<uuid> — 해당 프로젝트의 활성 체인 조회(없으면 null).
//   - project_id 생략 시 = org 의 가장 최근 활성 체인(프로젝트 무관). 프로빙
//     진입 체인은 project_id 가 null 이라(R8) 프로젝트 키로 찾을 수 없고, CD 의
//     체인 바는 프로젝트별이 아니라 **캔버스 전역 1개**라서 UI 컨테이너가 쓰는
//     조회는 이 형태여야 한다(pr-chain-ui-integration D).

const CreateBody = z.object({
  // 1급 입력 — 조립된 단계 시퀀스. 런타임 세밀 검증은 validateSteps 가
  // (enum 하드코딩 대신 레지스트리 SSOT 참조).
  steps: z.array(z.string().min(1)).optional(),
  // 레거시 — 고정 템플릿 키 + 진입 인덱스. steps 가 있으면 무시된다.
  template: z.string().min(1).optional(),
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
  const { steps: rawSteps, template, startAt, mode, project_id } = parsed.data;

  // ── 입력 환원: 두 경로 → 하나의 feature 시퀀스 ──────────────────────────
  // steps 가 1급. 없으면 레거시 {template, startAt} 를 시퀀스로 환원한다.
  // 레거시 경로의 400 코드는 A(#1323)와 동일하게 유지한다(호출자 회귀 0):
  // 미등재 템플릿 → unknown_template, 범위 밖 startAt → invalid_start.
  let features: readonly string[];
  if (rawSteps) {
    features = rawSteps;
  } else if (template !== undefined) {
    if (!isLegacyTemplateKey(template)) {
      return NextResponse.json({ error: 'unknown_template' }, { status: 400 });
    }
    const legacy = legacyTemplateSteps(template, startAt);
    if (!legacy) {
      return NextResponse.json({ error: 'invalid_start' }, { status: 400 });
    }
    features = legacy;
  } else {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  // 호환 그래프 검증 — 길이 2+ · 레지스트리 단계 · 중복 금지 · 인접 쌍 전부
  // 어댑터 실존. detail 은 UI 가 드롭 거부 사유로 그대로 표시할 수 있는 문구.
  const valid = validateSteps(features);
  if (!valid.ok) {
    // 레거시 경로에서 suffix 가 1단(topline 단독)이면 A 의 entry:false 거부와
    // 같은 상황이다 — 코드도 A 와 같은 invalid_start 로 돌려 호출자 회귀를 막는다.
    if (!rawSteps && valid.error === 'too_short') {
      return NextResponse.json({ error: 'invalid_start' }, { status: 400 });
    }
    return NextResponse.json(
      { error: valid.error, detail: valid.detail },
      { status: 400 },
    );
  }
  const sequence: ChainStepKey[] = valid.features;

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

  // 단계 인스턴스 — 검증된 시퀀스를 pending 으로. 첫 단계(커서 0)는 approve
  // 모드면 승인 대기, auto 면 러너블(kick 은 B). current_step 은 항상 0.
  const steps = instantiateSteps(sequence);
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
      // 자유 조합에서는 steps 가 곧 체인의 정의다 — template 컬럼은 관측용
      // 라벨로만 남는다('custom'). 레거시 경로는 받은 템플릿 키를 그대로
      // 보존해 A 시절 행과 구분 없이 읽히게 한다.
      template: rawSteps ? 'custom' : template,
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

  // project_id 는 선택 — 주면 그 프로젝트로 좁히고, 생략하면 org 전체에서 가장
  // 최근 활성 체인 1건. 빈 문자열/비-uuid 는 여전히 400(오타를 조용히 전체 조회로
  // 바꾸지 않는다).
  const rawProjectId = new URL(req.url).searchParams.get('project_id');
  if (rawProjectId !== null && !z.string().uuid().safeParse(rawProjectId).success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const admin = createAdminClient();

  // 활성 체인(프로젝트당 1). 종결 체인은 제외. org 스코프로 타 org 누출 방지.
  // 활성이 없으면 chain:null.
  let query = admin
    .from('widget_chains')
    .select('*')
    .eq('org_id', org.org_id)
    .in('status', [...ACTIVE_STATUSES]);
  if (rawProjectId !== null) query = query.eq('project_id', rawProjectId);

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[chains] list failed', error);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  return NextResponse.json({ chain: data ?? null });
}

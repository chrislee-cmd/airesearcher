// probing_sessions — research_context persistence (PR: probing-question-thinking-flow).
//
// GET — 위젯 mount 시 사용자가 마지막으로 입력한 조사 컨텍스트 (조사 목적 /
// KRQ) 를 가져온다. RLS 가 user_id gate. Row 없으면 빈 컨텍스트.
// (옛 "핵심 가설" 은 은퇴 — probing-hypotheses-retire-ghost-injection.)
// PUT — upsert. user_id 가 unique 라 같은 row 가 갱신된다 (updated_at trigger
// 가 자동 bump). 새 인터뷰를 시작할 때마다 같은 row 가 덮어 쓰여 가장 최근
// 컨텍스트만 보존.
//
// 다중 인터뷰 (project / interview id 별 분리) 는 후속 PR — 현재 위젯은 한
// 번에 하나의 인터뷰 컨텍스트만 다룬다.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

export const runtime = 'nodejs';
export const maxDuration = 15;

// 입력 한도 — server-side cap. UI 도 같은 한도를 채택.
const GOAL_MAX = 2_000;
const KRQ_MAX = 2_000;

// hypotheses 는 은퇴됨 (PR: probing-hypotheses-retire-ghost-injection). GET 은
// 노출하지 않고 PUT 은 받아도 무시한다 (옛 클라가 보내도 zod 가 unknown key 로
// strip → 400 없음). probing_sessions.hypotheses 컬럼은 dormant 로 남는다
// (파괴적 migration X — 데이터 보존/롤백 여지).
const PutBody = z.object({
  research_goal: z.string().max(GOAL_MAX),
  key_research_question: z.string().max(KRQ_MAX),
});

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  // GET is widget-hydration only — fail soft when org is unresolved (matches
  // /api/probing/questions GET semantics). Row missing = empty context.
  const { data, error } = await supabase
    .from('probing_sessions')
    // id 포함 — 공유 링크(#477)의 resource_id(probing_persona). 미저장이면 null.
    // hypotheses 는 은퇴 — select 하지 않는다 (유령 재수화 근절).
    .select('id, research_goal, key_research_question, updated_at')
    .maybeSingle();
  if (error) {
    // probing_sessions 마이그가 아직 prod 미적용인 prod-preview 차이 등을
    // 흡수 — 위젯이 빈 컨텍스트로 fallback 한다.
    console.error('[probing/research-context] get failed (graceful empty)', error);
    return NextResponse.json({
      row: {
        id: null,
        research_goal: '',
        key_research_question: '',
        updated_at: null,
      },
    });
  }
  return NextResponse.json({
    row: data ?? {
      id: null,
      research_goal: '',
      key_research_question: '',
      updated_at: null,
    },
  });
}

export async function PUT(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const org = await getActiveOrg();
  if (!org?.org_id) {
    return NextResponse.json({ error: 'no_organization' }, { status: 403 });
  }

  const parsed = PutBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { research_goal, key_research_question } = parsed.data;

  // hypotheses 는 은퇴 — upsert 객체에 넣지 않는다. 기존 row 의 hypotheses
  // 컬럼은 dormant 로 그대로 남는다 (upsert 는 제공된 컬럼만 갱신).
  const { data, error } = await supabase
    .from('probing_sessions')
    .upsert(
      {
        org_id: org.org_id,
        user_id: user.id,
        research_goal: research_goal.trim(),
        key_research_question: key_research_question.trim(),
      },
      { onConflict: 'user_id' },
    )
    // id 포함 — 저장 직후 클라이언트가 공유 링크(#477) resource_id 를 얻는다.
    .select('id, research_goal, key_research_question, updated_at')
    .single();
  if (error || !data) {
    console.error('[probing/research-context] upsert failed', error);
    return NextResponse.json({ error: 'upsert_failed' }, { status: 500 });
  }
  return NextResponse.json({ row: data });
}

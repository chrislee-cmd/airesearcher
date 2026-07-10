import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

// 통합 프로젝트 기반 — 위젯별 프로젝트 설정 GET/PUT.
//
// project_widget_settings(project_id, widget_key) unique 한 row 를 읽고 쓴다.
// 프로젝트 목록은 interview_projects 를 SSOT 로 재사용하며(20260702074657),
// 이 엔드포인트는 "선택된 프로젝트 × 특정 위젯" 의 설정 jsonb 만 다룬다.
//
// 소유 검증은 이중이다: (1) RLS "own project widget settings rw"(설정 row 는
// 소유 프로젝트를 경유해서만 접근 — 마이그 참고), (2) 여기서 명시적으로
// interview_projects 를 user_id 로 조회해 프로젝트 소유를 먼저 확인한다. RLS 만
// 믿으면 남의 project_id 를 upsert 했을 때 with-check 위반이 500 처럼 새어나오는데,
// 명시 조회로 404 를 먼저 돌려주면 호출부(useProjectWidgetSettings)가 원인을
// 정확히 구분할 수 있다.
//
// widget_key 는 하드 enum 이 아니라 slug 형태만 검증한다 — 프로빙/통역/인터뷰
// 외에 후속 위젯이 붙어도 마이그/코드 변경 없이 확장되도록 (spec §설계 C
// "확장 가능"). 보수적 상한: 소문자·숫자·-·_ 1~64자.
const WIDGET_KEY = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_-]+$/, 'widget_key must be a slug');

// settings 는 위젯별 자유 스키마라 shape 을 고정하지 않는다 — 단, 최상위는
// object 여야 한다(배열/스칼라 저장 방지). jsonb 컬럼 default '{}' 와 정합.
const SettingsBody = z.object({
  settings: z.record(z.string(), z.unknown()),
});

// 프로젝트 소유 확인 — 내 소유가 아니면 null. RLS(interview_projects
// "own project rw") 와 명시 user_id 필터를 함께 적용한다.
async function assertOwnedProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('interview_projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; widget: string }> },
) {
  const { projectId, widget } = await params;
  const widgetKey = WIDGET_KEY.safeParse(widget);
  if (!widgetKey.success) {
    return NextResponse.json({ error: 'invalid_widget' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!(await assertOwnedProject(supabase, projectId, user.id))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('project_widget_settings')
    .select('settings, updated_at')
    .eq('project_id', projectId)
    .eq('widget_key', widgetKey.data)
    .maybeSingle();

  if (error) {
    console.error('[projects/settings] get error', error);
    return NextResponse.json({ error: 'read_failed' }, { status: 500 });
  }

  // 아직 저장된 적 없으면 빈 설정으로 정규화 (프론트가 없음/빈 을 구분 안 해도 됨).
  return NextResponse.json({
    settings: data?.settings ?? {},
    updated_at: data?.updated_at ?? null,
  });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ projectId: string; widget: string }> },
) {
  const { projectId, widget } = await params;
  const widgetKey = WIDGET_KEY.safeParse(widget);
  if (!widgetKey.success) {
    return NextResponse.json({ error: 'invalid_widget' }, { status: 400 });
  }

  const parsed = SettingsBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!(await assertOwnedProject(supabase, projectId, user.id))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // upsert on (project_id, widget_key) — 첫 저장은 insert, 이후는 settings 교체.
  // updated_at 은 DB 트리거가 bump 하므로 여기서 안 넣는다.
  const { data, error } = await supabase
    .from('project_widget_settings')
    .upsert(
      {
        project_id: projectId,
        widget_key: widgetKey.data,
        settings: parsed.data.settings,
      },
      { onConflict: 'project_id,widget_key' },
    )
    .select('settings, updated_at')
    .single();

  if (error) {
    console.error('[projects/settings] upsert error', error);
    return NextResponse.json({ error: 'write_failed' }, { status: 500 });
  }

  return NextResponse.json({
    settings: data.settings ?? {},
    updated_at: data.updated_at ?? null,
  });
}

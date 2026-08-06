import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

// Interview V2 — interview_projects CRUD (collection endpoint).
//
// V2 groups interview documents under a project. This handler backs the
// project picker/list in the V2 widget shell.
//
// org 공유 (W1-A, pr-interview-projects-org-scope): 프로젝트 컨테이너가 org
// 공유로 전환됐다(RLS = has_org_role(org_id,'viewer')). 목록은 이제 org 축으로
// 조회하므로 같은 org 의 팀원 프로젝트도 함께 보인다(의도된 변화 — 코워킹).
// 단일 멤버 org(대부분의 기존 사용자)는 org 필터 == user 필터라 체감 변화 0.
// 쓰기(POST)는 여전히 user_id = 생성자 를 명시하고, RLS insert 가 member+ 를
// 요구한다.

const CreateBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2_000).optional(),
});

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
    return NextResponse.json({ projects: [] });
  }

  // archived 필터: '0' = 활성만(default) · '1' = 보관만 · 'all' = 전체.
  // 보관 = archived_at 이 채워진 row (soft delete). 그 외 값은 default 로 취급.
  const archivedParam = new URL(req.url).searchParams.get('archived') ?? '0';

  // org 축 조회 — 팀원 프로젝트까지 목록에 포함(코워킹). RLS select
  // (has_org_role viewer or user_id) 가 경계를 강제하므로 org_id 필터는 "이
  // active org 의 프로젝트만" 으로 좁히는 역할. 단일 멤버 org 는 user 필터와 동치.
  let query = supabase
    .from('interview_projects')
    .select('id, name, description, tags, archived_at, created_at, updated_at')
    .eq('org_id', org.org_id);

  if (archivedParam === '1') query = query.not('archived_at', 'is', null);
  else if (archivedParam !== 'all') query = query.is('archived_at', null);

  const { data, error } = await query
    .order('updated_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('[interviews/v2/projects] list error', error);
    return NextResponse.json({ error: 'list_failed' }, { status: 500 });
  }

  const projects = data ?? [];

  // 프로젝트별 문서 수 (카드의 "인터뷰 N개"). N+1 방지를 위해 프로젝트마다
  // 세는 대신, 방금 조회한 프로젝트들의 문서 project_id 만 한 번에 끌어와
  // 메모리에서 group count 한다 — 목록 endpoint 당 추가 왕복 1회로 고정.
  //
  // 보수적 선택 (spec §C "단일 aggregate 쿼리"): PostgREST 의 aggregate
  // select(`count()`) 나 신규 마이그 RPC 대신, project_id 컬럼만(작음) 뽑아
  // JS 로 집계했다. aggregate API 활성화 여부·마이그 prod 수동 적용(PROJECT.md
  // §7.5) 같은 외부 의존이 없어 preview 에서 바로 동작한다. 문서는 사용자
  // 단위라 실측 규모가 작지만, 상한 방어로 명시 limit 을 둔다.
  const docCountById = new Map<string, number>();
  const projectIds = projects.map((p) => p.id);
  if (projectIds.length > 0) {
    const { data: docRows, error: countError } = await supabase
      .from('interview_documents')
      .select('project_id')
      .eq('org_id', org.org_id)
      .in('project_id', projectIds)
      .limit(10_000);
    if (countError) {
      // 카운트 실패는 목록 자체를 막지 않는다 — 0 으로 표기하고 목록은 낸다.
      console.error('[interviews/v2/projects] doc count error', countError);
    } else {
      for (const row of docRows ?? []) {
        const pid = (row as { project_id: string | null }).project_id;
        if (!pid) continue;
        docCountById.set(pid, (docCountById.get(pid) ?? 0) + 1);
      }
    }
  }

  const withCounts = projects.map((p) => ({
    ...p,
    document_count: docCountById.get(p.id) ?? 0,
  }));
  return NextResponse.json({ projects: withCounts });
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
    return NextResponse.json({ error: 'no_org' }, { status: 400 });
  }

  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { name, description } = parsed.data;

  const { data, error } = await supabase
    .from('interview_projects')
    .insert({
      org_id: org.org_id,
      user_id: user.id,
      name,
      description: description ?? null,
    })
    .select('id, name, description, tags, archived_at, created_at, updated_at')
    .single();

  if (error) {
    console.error('[interviews/v2/projects] insert error', error);
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 });
  }
  return NextResponse.json({ project: data });
}

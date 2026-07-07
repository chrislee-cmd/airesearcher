import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

// Interview V2 — interview_projects CRUD (collection endpoint).
//
// V2 groups interview documents under a project. This handler backs the
// project picker/list in the V2 widget shell. Ownership is enforced twice:
// RLS ("own project rw", user_id = auth.uid()) on the table, and an
// explicit user_id filter / user_id column on write here so a stray org
// context can never leak another user's rows.

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

  let query = supabase
    .from('interview_projects')
    .select('id, name, description, tags, archived_at, created_at, updated_at')
    .eq('user_id', user.id);

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

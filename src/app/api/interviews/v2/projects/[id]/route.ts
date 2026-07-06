import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

// Interview V2 — interview_projects item endpoint (rename / archive / delete).
//
// Ownership is scoped by user_id (matching the "own project rw" RLS
// policy and the collection GET filter). PATCH covers rename (name /
// description) AND archive/restore (archived: true → archived_at = now,
// false → null) — 보관 = soft delete, 리스트에서 숨기되 복구 가능.
// DELETE is a hard delete: the archived-migration re-pointed
// interview_documents.project_id / interview_search_queries.project_id at
// `on delete cascade`, so removing the project row cascades to its
// documents (→ chunks, already cascade) and search queries. updated_at is
// bumped by the DB trigger, so PATCH never sets it explicitly.

// tags = 자유 라벨 배열. 통째 교체(부분 연산 X). 검증:
//   - 각 태그: trim 후 1~20자 (공백-only / 20자 초과 = 거부)
//   - 최대 10개 (초과 = 거부)
//   - 대소문자 무시 중복 제거 (silent — "UX" + "ux" → 하나만 남김)
// min/max 위반은 400 으로 거부하고, 중복만 조용히 정규화한다.
const TagsField = z
  .array(z.string().trim().min(1).max(20))
  .max(10)
  .transform((arr) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const tag of arr) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
    }
    return out;
  });

const PatchBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2_000).nullable().optional(),
  archived: z.boolean().optional(),
  tags: TagsField.optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.description !== undefined) patch.description = parsed.data.description;
  if (parsed.data.archived !== undefined) {
    // 보관 = archived_at 에 now() 기록 · 복원 = null 로 되돌림.
    patch.archived_at = parsed.data.archived ? new Date().toISOString() : null;
  }
  if (parsed.data.tags !== undefined) patch.tags = parsed.data.tags;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'empty_patch' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('interview_projects')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, name, description, tags, archived_at, created_at, updated_at')
    .maybeSingle();

  if (error) {
    console.error('[interviews/v2/projects/:id] update error', error);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ project: data });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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

  const { error } = await supabase
    .from('interview_projects')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    console.error('[interviews/v2/projects/:id] delete error', error);
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

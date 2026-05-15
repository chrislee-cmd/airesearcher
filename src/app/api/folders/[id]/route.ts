import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

const PatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  parent_folder_id: z.string().uuid().nullable().optional(),
});

// Walks the parent chain up to MAX_DEPTH looking for `candidate`. Used to
// reject moves that would create a cycle. Returns true if the candidate
// appears as an ancestor of `start`.
async function wouldCreateCycle(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  candidateAncestor: string,
  start: string,
): Promise<boolean> {
  let cursor: string | null = start;
  let hops = 0;
  while (cursor && hops < 32) {
    if (cursor === candidateAncestor) return true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: { data: { parent_folder_id: string | null } | null } = (await (supabase as any)
      .from('folders')
      .select('parent_folder_id')
      .eq('id', cursor)
      .eq('org_id', orgId)
      .maybeSingle());
    cursor = result.data?.parent_folder_id ?? null;
    hops += 1;
  }
  return false;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const { data: current } = await supabase
    .from('folders')
    .select('id, project_id, parent_folder_id')
    .eq('id', id)
    .eq('org_id', org.org_id)
    .maybeSingle();
  if (!current) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Setting yourself or a descendant as your parent is a cycle.
  if (parsed.data.parent_folder_id !== undefined && parsed.data.parent_folder_id !== null) {
    if (parsed.data.parent_folder_id === id) {
      return NextResponse.json({ error: 'cycle' }, { status: 400 });
    }
    const { data: parent } = await supabase
      .from('folders')
      .select('id, project_id')
      .eq('id', parsed.data.parent_folder_id)
      .eq('org_id', org.org_id)
      .maybeSingle();
    if (!parent || parent.project_id !== current.project_id) {
      return NextResponse.json({ error: 'parent_not_in_project' }, { status: 400 });
    }
    if (await wouldCreateCycle(supabase, org.org_id, id, parsed.data.parent_folder_id)) {
      return NextResponse.json({ error: 'cycle' }, { status: 400 });
    }
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.parent_folder_id !== undefined) patch.parent_folder_id = parsed.data.parent_folder_id;

  const { data, error } = await supabase
    .from('folders')
    .update(patch)
    .eq('id', id)
    .eq('org_id', org.org_id)
    .select('id, project_id, parent_folder_id, name, created_at, updated_at')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'db_error' }, { status: 400 });
  }
  return NextResponse.json(data);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const { error } = await supabase
    .from('folders')
    .delete()
    .eq('id', id)
    .eq('org_id', org.org_id);

  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  return NextResponse.json({ ok: true });
}

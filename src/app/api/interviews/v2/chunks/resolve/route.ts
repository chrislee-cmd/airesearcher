import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { resolveChunks } from '@/lib/interview-v2/resolve-chunks';

// Interview V2 — resolve evidence-citation ids to popover payloads (DECISIONS
// #1). The redesigned results view renders inline [chunk_id] citations as
// chips; opening a chip's popover calls this to fetch the chunk's excerpt,
// source file name, and position.
//
// POST { project_id, chunk_ids[] } → { chunks: [{ chunk_id, excerpt,
// file_name, position }] }. Batch cap 20 (over ⇒ 400). Unknown / other-project
// ids are omitted from the result rather than erroring — the frontend renders
// a bare chip as fallback.
//
// PII: excerpt is a slice of raw interview transcript, so this route is
// auth-only — never served without a logged-in session AND project ownership
// (unlike the public share viewer). Scope pattern mirrors the other V2 routes:
// getActiveOrg → org_id isolation + interview_projects "own project rw"
// ownership; chunks then narrow to that project inside resolveChunks.

// Chunks are immutable once indexed, so a per-user private cache is safe and
// spares the DB on repeated popover opens.
const CACHE_CONTROL = 'private, max-age=3600';

const Body = z.object({
  project_id: z.string().uuid(),
  chunk_ids: z.array(z.string().min(1)).min(1).max(20),
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

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    // Covers malformed body, missing project_id, and >20 chunk_ids (spec: 배치
    // 상한 20 초과 400).
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { project_id, chunk_ids } = parsed.data;

  // Ownership — the project must belong to the caller's active org
  // (interview_projects org RLS, W1-A). Scoping to org_id (not user_id) lets a
  // teammate view citations on a project a colleague created — the "문서 열람"
  // half of coworking — while a project in another org resolves to no row ⇒
  // 404, so no cross-tenant excerpt ever leaves this route (spec constraint #2,
  // PII). Single-member orgs behave exactly as the old user_id filter.
  const { data: project, error: projectError } = await supabase
    .from('interview_projects')
    .select('id')
    .eq('id', project_id)
    .eq('org_id', org.org_id)
    .maybeSingle();
  if (projectError) {
    console.error('[interviews/v2/chunks/resolve] project lookup error', projectError);
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
  }
  if (!project) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Retrieval via the admin client (RLS bypassed for perf); org_id + project_id
  // are the isolation boundary inside resolveChunks — same pattern as search.
  const admin = createAdminClient();
  let chunks;
  try {
    chunks = await resolveChunks(admin, org.org_id, project_id, chunk_ids);
  } catch (e) {
    console.error('[interviews/v2/chunks/resolve] resolve failed', e);
    return NextResponse.json({ error: 'resolve_failed' }, { status: 500 });
  }

  return NextResponse.json(
    { chunks },
    { headers: { 'Cache-Control': CACHE_CONTROL } },
  );
}

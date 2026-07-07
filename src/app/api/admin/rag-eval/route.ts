import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { env } from '@/env';
import { runEval } from '@/lib/interview-eval/run-eval';
import { MAX_SAMPLE_SIZE } from '@/lib/interview-eval/generate-gold';
import { saveEvalRun, getPreviousRun, listEvalRuns } from '@/lib/interview-eval/store';

// 인터뷰 RAG 품질 평가 하네스 — super-admin 전용.
//
// POST { project_id, sample_size?, k? } — 4 메트릭 측정 → rag_eval_runs 저장
//   → { run, previous } 반환(직전 대비 delta 는 클라이언트가 계산).
// GET  ?project_id=<uuid> — 그 프로젝트의 최근 run 목록(히스토리).
//
// 비-admin 은 404(403 아님) — 라우트 존재 자체를 감춘다(다른 admin route 와 동일).
// LLM 판사 + 검색 임베딩을 도는 무거운 경로라 300s 예산.

export const maxDuration = 300;

const Body = z.object({
  project_id: z.string().uuid(),
  sample_size: z.number().int().min(1).max(MAX_SAMPLE_SIZE).optional(),
  k: z.number().int().min(1).max(50).optional(),
});

// super-admin gate + 활성 org 확인 공통 처리. 통과 시 { user, org } 반환.
async function gate(): Promise<
  | { ok: true; email: string; orgId: string }
  | { ok: false; res: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) {
    return { ok: false, res: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  }
  const org = await getActiveOrg();
  if (!org?.org_id) {
    return { ok: false, res: NextResponse.json({ error: 'no_org' }, { status: 403 }) };
  }
  return { ok: true, email: user!.email!, orgId: org.org_id };
}

// 프로젝트가 이 org 소유인지 확인 — 아니면 not_found(정보 누출 방지).
async function assertOwned(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  projectId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('interview_projects')
    .select('id')
    .eq('id', projectId)
    .eq('org_id', orgId)
    .maybeSingle();
  return !!data;
}

export async function POST(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!(await assertOwned(admin, g.orgId, body.project_id))) {
    return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
  }

  const result = await runEval({
    admin,
    orgId: g.orgId,
    projectId: body.project_id,
    sampleSize: body.sample_size,
    k: body.k,
    gitSha: env.VERCEL_GIT_COMMIT_SHA ?? 'local',
  });

  // 저장 전에 직전 run 을 잡아 delta 기준선으로 반환.
  const previous = await getPreviousRun(g.orgId, body.project_id);
  const run = await saveEvalRun({ orgId: g.orgId, email: g.email, result });

  return NextResponse.json(
    { run, previous, notes: result.notes },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function GET(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;

  const projectId = new URL(req.url).searchParams.get('project_id') ?? '';
  if (!z.string().uuid().safeParse(projectId).success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const admin = createAdminClient();
  if (!(await assertOwned(admin, g.orgId, projectId))) {
    return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
  }
  const runs = await listEvalRuns(g.orgId, projectId);
  return NextResponse.json({ runs }, { headers: { 'Cache-Control': 'no-store' } });
}

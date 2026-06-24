import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import {
  EMPTY_GUIDE,
  mergeProbingGuide,
  parseProbingGuide,
  probingGuideSchema,
} from '@/lib/probing-guide';

// PR-3 — projects.interview_template jsonb 안의 probing 가이드 키들만
// 다루는 read/write 엔드포인트.
//
// GET  → 활성 org 의 프로젝트에서 PR-3 키 (objective/hypotheses/
//        question_intents) 만 추출해서 반환. 미존재/legacy 만 있는 경우
//        EMPTY_GUIDE.
// PUT  → 같은 키들을 selective merge — legacy `questions`,
//        `source_filename`, `uploaded_at` 등 미지의 키는 보존.

const PutBody = probingGuideSchema;

async function authorize(projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { supabase, error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  const org = await getActiveOrg();
  if (!org?.org_id) {
    return { supabase, error: NextResponse.json({ error: 'no_organization' }, { status: 403 }) };
  }
  const { data: project } = await supabase
    .from('projects')
    .select('id, org_id, interview_template')
    .eq('id', projectId)
    .maybeSingle();
  if (!project || project.org_id !== org.org_id) {
    return { supabase, error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  }
  return { supabase, project };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { error, project } = await authorize(id);
  if (error) return error;
  return NextResponse.json({
    guide: parseProbingGuide(project?.interview_template),
  });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = PutBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { supabase, error, project } = await authorize(id);
  if (error) return error;

  // legacy 키 보존을 위해 jsonb 전체를 read-modify-write. supabase JS
  // 클라이언트는 atomic jsonb_set 을 노출하지 않아서 read → merge →
  // update 패턴이 표준. 경합은 사실상 사용자 한 명이 한 폼에서만 누르는
  // 시나리오라 무시 가능.
  const merged = mergeProbingGuide(project?.interview_template, parsed.data);
  const { error: upErr } = await supabase
    .from('projects')
    .update({ interview_template: merged })
    .eq('id', id);
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 400 });
  }
  return NextResponse.json({ guide: parsed.data ?? EMPTY_GUIDE });
}

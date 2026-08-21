import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { convertReportFileToMarkdown } from '@/lib/interview-v2/report-convert';
import {
  upsertProjectGuideline,
  deleteProjectGuideline,
  GUIDELINE_MAX_CHARS,
} from '@/lib/interview-v2/topline-guideline';

// 인터뷰 탑라인 — 프로젝트 "분석 가이드라인" 업로드/교체/삭제 엔드포인트.
//
// 예전 /import 는 완성 보고서를 md→blocks 로 파싱해 status='done'/source='uploaded'
// 로 저장하던 **생성 우회** 경로였다. 이 라우트는 대신 업로드 파일을 **생성이 따라야
// 할 가이드 문서**로 저장한다 — blocks 파싱·toplines 쓰기 없음. 저장 후 다음 생성/
// 재생성이 이 가이드를 최우선 기준으로 반영한다(runTopline reduce 주입 + dedup
// guideline_hash).
//
// POST 두 페이로드 형식(import 라우트와 동일 컨벤션):
//   1. application/json { project_id, markdown, filename? } — 이미 Markdown.
//   2. multipart/form-data { project_id, file } — DOCX/PDF/HTML 등. 서버가
//      report-convert 로 구조 보존 Markdown 정규화(LLM 재작성 없음).
//
// DELETE ?project_id=<uuid> — 가이드라인 명시 삭제(이후 생성은 가이드 없이).
//
// 격리: 프로젝트가 org 소유가 아니면 not_found(정보 누출 방지). 쓰기는 admin
// client 지만 소유 검증 후에만 수행 — import/blocks 라우트와 동일 컨벤션.

// DOCX/PDF 추출은 순수 파싱(LLM 없음)이라 짧지만, 대용량 파일 여유로 넉넉히.
export const maxDuration = 60;

// 업로드 파일 바이트 상한 — /import·/api/interviews/convert 와 동일(25MB).
const FILE_MAX_BYTES = 25 * 1024 * 1024;

const JsonBody = z.object({
  project_id: z.string().uuid(),
  // 가이드 문서 원문 Markdown.
  markdown: z.string().min(1).max(GUIDELINE_MAX_CHARS),
  // 원본 파일명(선택) — 카드 배지 표시용.
  filename: z.string().max(400).optional(),
});

type ResolvedInput = {
  projectId: string;
  markdown: string;
  filename: string | null;
};

/**
 * 요청 본문(JSON 또는 multipart)을 project_id + markdown + filename 으로 정규화.
 * 실패 시 즉시 응답할 NextResponse 반환(호출부가 그대로 리턴). /import 라우트의
 * resolveInput 과 동일 흐름(가이드 저장이라 blocks 파싱만 다르다).
 */
async function resolveInput(
  req: Request,
): Promise<ResolvedInput | NextResponse> {
  const contentType = req.headers.get('content-type') ?? '';

  // 경로 2 — 파일 업로드(DOCX/PDF/HTML). 서버가 Markdown 정규화.
  if (contentType.includes('multipart/form-data')) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
    const projectId = form.get('project_id');
    const file = form.get('file');
    if (
      typeof projectId !== 'string' ||
      !z.string().uuid().safeParse(projectId).success
    ) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'no_file' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'empty_report' }, { status: 422 });
    }
    if (file.size > FILE_MAX_BYTES) {
      return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    }
    let markdown: string;
    try {
      const converted = await convertReportFileToMarkdown(file);
      markdown = converted.markdown;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'convert_failed';
      if (msg.startsWith('unsupported_report_type')) {
        return NextResponse.json(
          { error: 'unsupported_file_type' },
          { status: 415 },
        );
      }
      console.error('[v2/topline/guideline] convert failed', file.name, msg);
      return NextResponse.json({ error: 'convert_failed' }, { status: 502 });
    }
    if (!markdown.trim()) {
      return NextResponse.json({ error: 'empty_report' }, { status: 422 });
    }
    if (markdown.length > GUIDELINE_MAX_CHARS) {
      return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    }
    return { projectId, markdown, filename: file.name };
  }

  // 경로 1 — JSON Markdown 직업로드.
  const parsed = JsonBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  return {
    projectId: parsed.data.project_id,
    markdown: parsed.data.markdown,
    filename: parsed.data.filename ?? null,
  };
}

/** 프로젝트가 이 org 소유인지 확인 — 아니면 응답(정보 누출 방지). null = OK. */
async function assertProjectOwned(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  projectId: string,
): Promise<NextResponse | null> {
  const { data: projectRow } = await admin
    .from('interview_projects')
    .select('id')
    .eq('id', projectId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (!projectRow) {
    return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
  }
  return null;
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
    return NextResponse.json({ error: 'no_org' }, { status: 403 });
  }

  const resolved = await resolveInput(req);
  if (resolved instanceof NextResponse) return resolved;
  const { projectId: project_id, markdown, filename } = resolved;

  const admin = createAdminClient();
  const owned = await assertProjectOwned(admin, org.org_id, project_id);
  if (owned) return owned;

  let result: { hash: string; filename: string | null };
  try {
    result = await upsertProjectGuideline(admin, {
      orgId: org.org_id,
      projectId: project_id,
      markdown,
      filename,
    });
  } catch (e) {
    console.error('[v2/topline/guideline] upsert failed', e);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  console.log('[v2/topline/guideline] saved', {
    project_id: project_id.slice(0, 8),
    filename: filename?.slice(0, 80) ?? null,
    md_len: markdown.length,
  });

  return NextResponse.json({
    ok: true,
    filename: result.filename,
    guideline_hash: result.hash,
  });
}

export async function DELETE(req: Request) {
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

  const projectId = new URL(req.url).searchParams.get('project_id') ?? '';
  if (!z.string().uuid().safeParse(projectId).success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const admin = createAdminClient();
  const owned = await assertProjectOwned(admin, org.org_id, projectId);
  if (owned) return owned;

  try {
    await deleteProjectGuideline(admin, { orgId: org.org_id, projectId });
  } catch (e) {
    console.error('[v2/topline/guideline] delete failed', e);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

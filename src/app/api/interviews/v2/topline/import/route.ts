import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { computeProjectCorpus, upsertImported } from '@/lib/interview-v2/topline';
import { parseMarkdownToToplineBlocks } from '@/lib/interview-v2/topline-import';
import { convertReportFileToMarkdown } from '@/lib/interview-v2/report-convert';

// 인터뷰 탑라인 — 편집전용 모드(외부 보고서 업로드) import 엔드포인트.
//
// 두 페이로드 형식:
//   1. application/json { project_id, markdown, filename? } — 이미 Markdown
//      (외부 도구 .md export). #594 원래 경로. 서버 재작성 없이 그대로 파싱.
//   2. multipart/form-data { project_id, file } — DOCX/PDF/HTML 등(#595). 서버가
//      report-convert 로 구조 보존 Markdown 정규화(LLM 재작성 없음) 후 동일 파싱.
//
// 어느 경로든 최종적으로 md→blocks 파싱(헤딩=섹션, GFM 표=table, 인용=quote,
// 문단=paragraph, 인식 실패분=paragraph fallback 손실 0)해 프로젝트 탑라인 row 에
// status='done', source='uploaded' 로 저장한다. **생성 파이프라인(Opus) 호출 없음.**
//
// 두 모드(생성/업로드)의 최종 산출물이 동일한 blocks 구조라, 저장 후 편집·저장·
// 공유·export 인터페이스가 그대로 통일된다(사용자 핵심 요구).
//
// 격리: 프로젝트가 org 소유가 아니면 not_found(정보 누출 방지). 쓰기는 admin
// client 지만 소유 검증 후에만 수행 — blocks/route.ts 와 동일 컨벤션.

// DOCX/PDF 추출은 순수 파싱(LLM 없음)이라 짧지만, 대용량 파일 여유로 넉넉히.
export const maxDuration = 60;

// 업로드 Markdown 최대 길이 — 생성 보고서 출력 예산(reduce maxOutputTokens 32k)
// 과 비슷한 스케일의 넉넉한 상한. 과도한 페이로드/DoS 표면만 막고 정상 보고서는
// 통과. 파일 경로(DOCX/PDF)도 변환 후 이 길이로 재검증한다.
const MARKDOWN_MAX = 400_000;

// 업로드 파일 바이트 상한 — /api/interviews/convert 와 동일(25MB).
const FILE_MAX_BYTES = 25 * 1024 * 1024;

const JsonBody = z.object({
  project_id: z.string().uuid(),
  // 외부 보고서 원문 Markdown. 서버가 blocks 로 파싱(id 부여 = 서버 소유).
  markdown: z.string().min(1).max(MARKDOWN_MAX),
  // 원본 파일명(선택) — 로그/감사용. 저장 blocks 자체엔 안 들어간다.
  filename: z.string().max(400).optional(),
});

// 파싱된 입력(형식 무관) — project_id + markdown + 원본 파일명.
type ResolvedInput = {
  projectId: string;
  markdown: string;
  filename: string | null;
};

/**
 * 요청 본문(JSON 또는 multipart)을 project_id + markdown 으로 정규화한다. 실패
 * 시 즉시 응답할 NextResponse 를 반환(호출부가 그대로 리턴).
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
    if (typeof projectId !== 'string' || !z.string().uuid().safeParse(projectId).success) {
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
      console.error('[v2/topline/import] convert failed', file.name, msg);
      return NextResponse.json({ error: 'convert_failed' }, { status: 502 });
    }
    if (!markdown.trim()) {
      return NextResponse.json({ error: 'empty_report' }, { status: 422 });
    }
    if (markdown.length > MARKDOWN_MAX) {
      return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    }
    return { projectId, markdown, filename: file.name };
  }

  // 경로 1 — JSON Markdown 직업로드(#594 원래 경로).
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

  // 프로젝트가 이 org 소유인지 확인 — 아니면 not_found(정보 누출 방지).
  const { data: projectRow } = await admin
    .from('interview_projects')
    .select('id')
    .eq('id', project_id)
    .eq('org_id', org.org_id)
    .maybeSingle();
  if (!projectRow) {
    return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
  }

  // md → blocks 파싱(순수). 헤딩=섹션, GFM 표=table, 인용(blockquote)=quote,
  // 문단=paragraph, 최상단 프로즈=executive_summary 휴리스틱. 인식 실패분은
  // paragraph 로 흘려 손실 0.
  const blocks = parseMarkdownToToplineBlocks(markdown);
  if (blocks.length === 0) {
    // 헤딩/문단이 하나도 안 잡힘(공백/구조 없는 입력) — 저장 거부.
    return NextResponse.json({ error: 'empty_report' }, { status: 422 });
  }

  // content_hash = 현재 문서 셋 해시 — stale 판정을 생성물과 정합시킨다(문서가
  // 없어도 안정 해시). corpus 조회 실패는 치명적이지 않으므로 빈 해시로 진행.
  let hash = '';
  try {
    const corpus = await computeProjectCorpus(admin, org.org_id, project_id);
    hash = corpus.hash;
  } catch (e) {
    console.warn('[v2/topline/import] corpus hash failed — using empty', e);
  }

  let toplineId: string;
  try {
    toplineId = await upsertImported(admin, {
      orgId: org.org_id,
      projectId: project_id,
      hash,
      blocks,
    });
  } catch (e) {
    console.error('[v2/topline/import] upsert failed', e);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  console.log('[v2/topline/import] imported', {
    project_id: project_id.slice(0, 8),
    filename: filename?.slice(0, 80) ?? null,
    md_len: markdown.length,
    blocks: blocks.length,
  });

  return NextResponse.json({
    topline_id: toplineId,
    status: 'done',
    source: 'uploaded',
    blocks,
  });
}

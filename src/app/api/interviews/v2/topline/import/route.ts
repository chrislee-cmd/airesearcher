import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { computeProjectCorpus, upsertImported } from '@/lib/interview-v2/topline';
import { parseMarkdownToToplineBlocks } from '@/lib/interview-v2/topline-import';

// 인터뷰 탑라인 — 편집전용 모드(외부 보고서 업로드) import 엔드포인트.
//
// POST { project_id, markdown, filename? }:
//   외부(Claude/NotebookLM 등)에서 완성한 보고서 Markdown 을 받아 탑라인 blocks
//   구조로 파싱하고 프로젝트 탑라인 row 에 status='done', source='uploaded' 로
//   저장한다. **생성 파이프라인(Opus) 호출 없음** — 사용자는 진입 시 "탑라인
//   생성" 대신 "자체 보고서 업로드"를 명시 선택했고, 이후 여기 저장된 blocks 를
//   기존 편집 도구(edit_block/섹션 삽입/drag-to-ask)로 다듬는다.
//
// 두 모드(생성/업로드)의 최종 산출물이 동일한 blocks 구조라, 저장 후 편집·저장·
// 공유·export 인터페이스가 그대로 통일된다(사용자 핵심 요구).
//
// 격리: 프로젝트가 org 소유가 아니면 not_found(정보 누출 방지). 쓰기는 admin
// client 지만 소유 검증 후에만 수행 — blocks/route.ts 와 동일 컨벤션.

// 파싱만 하는 경량 라우트 — LLM/무거운 작업 없음.
export const maxDuration = 30;

// 업로드 Markdown 최대 길이 — 생성 보고서 출력 예산(reduce maxOutputTokens 32k)
// 과 비슷한 스케일의 넉넉한 상한. 과도한 페이로드/DoS 표면만 막고 정상 보고서는
// 통과. (후속 #595 에서 DOCX/PDF 등 확장 시 재검토.)
const MARKDOWN_MAX = 400_000;

const Body = z.object({
  project_id: z.string().uuid(),
  // 외부 보고서 원문 Markdown. 서버가 blocks 로 파싱(id 부여 = 서버 소유).
  markdown: z.string().min(1).max(MARKDOWN_MAX),
  // 원본 파일명(선택) — 로그/감사용. 저장 blocks 자체엔 안 들어간다.
  filename: z.string().max(400).optional(),
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
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { project_id, markdown, filename } = parsed.data;

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

  // md → blocks 파싱(순수). 헤딩=섹션, 문단=paragraph, 최상단 프로즈=executive_summary
  // 휴리스틱. 표/리스트는 paragraph markdown 으로 보존(#595 에서 구조화 정교화).
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

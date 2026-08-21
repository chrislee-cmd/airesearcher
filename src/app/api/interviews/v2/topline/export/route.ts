import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import {
  getTopline,
  getCitationSources,
  collectCitationIds,
} from '@/lib/interview-v2/topline';
import {
  toplineBlocksToMarkdown,
  toplineBlocksToPlainText,
} from '@/lib/interview-v2/topline-markdown';

// 인터뷰 탑라인 export — 저장된 보고서를 Markdown(.md) / plain-text(.txt) 로
// 다운로드.
//
// GET ?project_id=<uuid>&format=md|txt:
//   저장된 interview_toplines.blocks(유지된 inserted_qa 포함 = 최종 문서)를
//   markdown / plain text 로 직렬화해 attachment 로 반환한다. 인용은 사람이 읽는
//   "근거: 문서명" 으로 변환하고 raw chunk_id 는 노출하지 않는다(사용자 결정 3).
//   생성 트리거는 없다 — 이미 done 인 보고서만 내보낸다.
//
//   docx 다운로드는 제거됐다(다운로드는 txt/md 로만 — 카드 #609). docx 파이프라인
//   (toplineBlocksToDocx / assembleToplineDocx)은 Google Docs 공유(share-gdoc)가
//   계속 사용하므로 그대로 유지된다 — 이 라우트에서만 docx 노출을 뺀다.
//
// 격리: 프로젝트가 이 org 소유가 아니면 not_found(정보 누출 방지). blocks 가
// 없으면 409(topline_not_ready).

export const maxDuration = 60;

const FORMATS = { md: 'text/markdown', txt: 'text/plain' } as const;
type ExportFormat = keyof typeof FORMATS;

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
    return NextResponse.json({ error: 'no_org' }, { status: 403 });
  }

  const url = new URL(req.url);
  const projectId = url.searchParams.get('project_id') ?? '';
  if (!z.string().uuid().safeParse(projectId).success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  // 다운로드는 md / txt 만 지원. 미지정이면 md 로 간주, 그 외 포맷은 명시적 400.
  const format = (url.searchParams.get('format') ?? 'md') as ExportFormat;
  if (!(format in FORMATS)) {
    return NextResponse.json({ error: 'unsupported_format' }, { status: 400 });
  }

  const admin = createAdminClient();

  // 프로젝트가 이 org 소유인지 확인 — 아니면 not_found(정보 누출 방지). 이름도
  // 파일명 표지에 쓰므로 함께 조회한다.
  const { data: projectRow } = await admin
    .from('interview_projects')
    .select('id, name')
    .eq('id', projectId)
    .eq('org_id', org.org_id)
    .maybeSingle();
  if (!projectRow) {
    return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
  }

  let body: string;
  let projectName: string;
  let generatedAt: string | null;
  try {
    const topline = await getTopline(admin, projectId);
    const blocks = topline?.blocks ?? [];
    if (!topline || blocks.length === 0) {
      return NextResponse.json({ error: 'topline_not_ready' }, { status: 409 });
    }
    // 인용 chunk_id → 사람이 읽는 출처(문서명). raw chunk_id 노출 방지.
    const sources = await getCitationSources(
      admin,
      org.org_id,
      collectCitationIds(blocks),
    );
    projectName = String(projectRow.name ?? '').trim() || '탑라인 보고서';
    generatedAt = topline.generated_at;
    const serialize =
      format === 'md' ? toplineBlocksToMarkdown : toplineBlocksToPlainText;
    body = serialize(blocks, { projectName, generatedAt, sources });
  } catch (e) {
    console.error('[v2/topline/export] failed', e);
    return NextResponse.json({ error: 'export_failed' }, { status: 500 });
  }

  const filename = buildFilename(projectName, generatedAt, format);

  return new NextResponse(body, {
    status: 200,
    headers: {
      // charset=utf-8 — 한글 본문이 깨지지 않게.
      'content-type': `${FORMATS[format]}; charset=utf-8`,
      // 한글 파일명은 RFC 5987(filename*)로 인코딩. 구형 클라 대비 ASCII fallback
      // filename 도 함께 둔다.
      'content-disposition': `attachment; filename="topline.${format}"; filename*=UTF-8''${encodeURIComponent(
        filename,
      )}`,
      'cache-control': 'no-store',
    },
  });
}

// {프로젝트명}_탑라인_{YYYY-MM-DD}.{md|txt} — 파일시스템 금지문자만 제거.
function buildFilename(
  projectName: string,
  generatedAt: string | null,
  format: ExportFormat,
): string {
  const safe = projectName.replace(/[\\/:*?"<>|]/g, '').trim() || '탑라인';
  const d = generatedAt ? new Date(generatedAt) : new Date();
  const valid = !Number.isNaN(d.getTime()) ? d : new Date();
  const y = valid.getFullYear();
  const m = String(valid.getMonth() + 1).padStart(2, '0');
  const day = String(valid.getDate()).padStart(2, '0');
  return `${safe}_탑라인_${y}-${m}-${day}.${format}`;
}

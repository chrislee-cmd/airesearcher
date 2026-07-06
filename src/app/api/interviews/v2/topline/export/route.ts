import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import {
  assembleToplineDocx,
  ToplineNotReadyError,
} from '@/lib/interview-v2/topline';

// 인터뷰 탑라인 export — 저장된 보고서를 Word(.docx) 로 다운로드.
//
// GET ?project_id=<uuid>&format=docx:
//   저장된 interview_toplines.blocks(유지된 inserted_qa 포함 = 최종 문서)를
//   desk-docx 파이프라인으로 .docx 변환해 attachment 로 반환한다. 인용은 사람이
//   읽는 "근거: 문서명" 으로 변환하고 raw chunk_id 는 노출하지 않는다(사용자
//   결정 3). 생성 트리거는 없다 — 이미 done 인 보고서만 내보낸다.
//
// 격리: 프로젝트가 이 org 소유가 아니면 not_found(정보 누출 방지). blocks 가
// 없으면 409(topline_not_ready).

export const maxDuration = 60;

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

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
  // 현재는 docx 만 지원. 미지정이면 docx 로 간주, 그 외 포맷은 명시적 400.
  const format = url.searchParams.get('format') ?? 'docx';
  if (format !== 'docx') {
    return NextResponse.json({ error: 'unsupported_format' }, { status: 400 });
  }

  const admin = createAdminClient();

  // 프로젝트가 이 org 소유인지 확인 — 아니면 not_found(정보 누출 방지).
  const { data: projectRow } = await admin
    .from('interview_projects')
    .select('id')
    .eq('id', projectId)
    .eq('org_id', org.org_id)
    .maybeSingle();
  if (!projectRow) {
    return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
  }

  let buffer: Buffer;
  let projectName: string;
  let generatedAt: string | null;
  try {
    ({ buffer, projectName, generatedAt } = await assembleToplineDocx(
      admin,
      org.org_id,
      projectId,
    ));
  } catch (e) {
    if (e instanceof ToplineNotReadyError) {
      return NextResponse.json({ error: 'topline_not_ready' }, { status: 409 });
    }
    console.error('[v2/topline/export] failed', e);
    return NextResponse.json({ error: 'export_failed' }, { status: 500 });
  }

  const filename = buildFilename(projectName, generatedAt);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'content-type': DOCX_MIME,
      // 한글 파일명은 RFC 5987(filename*)로 인코딩. 구형 클라 대비 ASCII fallback
      // filename 도 함께 둔다.
      'content-disposition': `attachment; filename="topline.docx"; filename*=UTF-8''${encodeURIComponent(
        filename,
      )}`,
      'cache-control': 'no-store',
    },
  });
}

// {프로젝트명}_탑라인_{YYYY-MM-DD}.docx — 파일시스템 금지문자만 제거.
function buildFilename(projectName: string, generatedAt: string | null): string {
  const safe = projectName.replace(/[\\/:*?"<>|]/g, '').trim() || '탑라인';
  const d = generatedAt ? new Date(generatedAt) : new Date();
  const valid = !Number.isNaN(d.getTime()) ? d : new Date();
  const y = valid.getFullYear();
  const m = String(valid.getMonth() + 1).padStart(2, '0');
  const day = String(valid.getDate()).padStart(2, '0');
  return `${safe}_탑라인_${y}-${m}-${day}.docx`;
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import {
  ADMIN_REAUTH_ERROR,
  adminReauthErrorBody,
  getAdminAccessToken,
  isAdminProxyConfigured,
} from '@/lib/google-oauth-admin';
import {
  createGoogleDocFromBytes,
  setAnyoneReader,
} from '@/lib/share/google-docs';
import {
  assembleToplineDocx,
  ToplineNotReadyError,
} from '@/lib/interview-v2/topline';

// 인터뷰 탑라인 Google Docs 공유 — 저장된 보고서를 admin-proxy Drive 로 업로드해
// Google Doc 으로 변환하고 "링크 있는 모든 사용자: 뷰어" 권한을 준 뒤 링크를
// 반환한다(사용자 결정 2 — 신규 OAuth X, 기존 리크루팅 admin 인프라 재사용).
//
// POST { project_id }:
//   1. 소유 검증 후 assembleToplineDocx 로 export 와 동일한 .docx buffer 생성
//      (스타일 일관 — docx→Doc 변환은 near-lossless).
//   2. admin access token 확보 — 실패는 admin_google_reauth_required(#770 체계).
//   3. Drive files.create (multipart, mimeType=google-apps.document) → 변환 업로드.
//   4. permissions.create(role=reader, type=anyone) → 링크-뷰어.
//   5. { url } 반환. 클라 = 링크 복사 + 새 탭.
//
// 재공유 = 매번 새 파일(버전 혼동 방지 — 사용자 결정). doc_url 을 topline row 에
// 되읽는 소비처가 이 PR 엔 없어 DB 영속은 보수적으로 생략(불필요한 마이그로
// prod drift 위험만 — PROJECT.md §7.5). 후속 "이미 공유됨" UI 때 컬럼 추가.

export const maxDuration = 60;

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const Body = z.object({
  project_id: z.string().uuid(),
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
  const { project_id } = parsed.data;

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

  // admin-proxy(GOOGLE_ADMIN_EMAIL + refresh token) 미구성이면 공유 불가.
  // 리크루팅과 달리 per-user OAuth fallback 은 없다(공유 대상 계정이 admin
  // Drive 로 고정) — 친화 에러로 안내.
  if (!(await isAdminProxyConfigured())) {
    return NextResponse.json(
      {
        error: 'google_admin_not_configured',
        message: 'Google Docs 공유가 아직 설정되지 않았어요. 운영자에게 문의해 주세요.',
      },
      { status: 412 },
    );
  }

  // 저장된 보고서 → export 와 동일한 .docx buffer.
  let buffer: Buffer;
  let projectName: string;
  try {
    ({ buffer, projectName } = await assembleToplineDocx(
      admin,
      org.org_id,
      project_id,
    ));
  } catch (e) {
    if (e instanceof ToplineNotReadyError) {
      return NextResponse.json({ error: 'topline_not_ready' }, { status: 409 });
    }
    console.error('[v2/topline/share-gdoc] docx failed', e);
    return NextResponse.json({ error: 'export_failed' }, { status: 500 });
  }

  // admin access token — DB+env 모두 소진되면 clean reauth code(#770 체계).
  let accessToken: string;
  try {
    accessToken = await getAdminAccessToken();
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'admin_token_refresh_failed';
    if (msg === ADMIN_REAUTH_ERROR) {
      return NextResponse.json(adminReauthErrorBody(user.email), {
        status: 503,
      });
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  try {
    // Node Buffer → 정확한 바이트 범위의 ArrayBuffer(공유 backing store 슬라이스).
    const bytes = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    const { url, documentId } = await createGoogleDocFromBytes(
      accessToken,
      projectName,
      bytes,
      DOCX_MIME,
    );
    await setAnyoneReader(accessToken, documentId);
    return NextResponse.json({ url, documentId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'share_failed';
    console.error('[v2/topline/share-gdoc] drive failed', msg);
    return NextResponse.json({ error: 'share_failed' }, { status: 502 });
  }
}

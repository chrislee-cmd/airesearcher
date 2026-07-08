import { setRequestLocale } from 'next-intl/server';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { assertInvitedViewer, isShareExpired } from '@/lib/share/shared-views';
import { loadShareResource } from '@/lib/share/viewer-resource';
import {
  verifyViewerCookie,
  viewerCookieName,
} from '@/lib/share/viewer-cookie';
import { ShareViewerFrame } from '@/components/share/share-viewer-frame';
import { ShareEmailGate } from '@/components/share/share-email-gate';
import { ShareNotice } from '@/components/share/share-notice';

// 공유 뷰어 페이지 — 이메일 게이트 오케스트레이션(결정 1·2·3).
//
// 순서:
//   1) 이메일과 무관한 토큰 상태 확인 — 무효/폐기/만료면 이메일 요구 없이
//      안내(데이터 노출 0).
//   2) 뷰어 이메일 확보: OTP 인증 쿠키 → 로그인 세션 이메일.
//   3) assertInvitedViewer 통과 시에만 service_role 로 리소스를 read-only
//      로드해 프레임 렌더. 아니면 OTP 게이트 표시.

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const admin = createAdminClient();

  // 1) 죽은 링크는 이메일 게이트를 띄우지 않고 바로 안내(데이터 0).
  const { data: share } = await admin
    .from('shared_views')
    .select('resource_type, resource_id, expires_at, revoked_at')
    .eq('token', token)
    .maybeSingle();
  if (!share) return <ShareNotice variant="invalid" />;
  if (share.revoked_at) return <ShareNotice variant="revoked" />;
  if (isShareExpired(share.expires_at as string | null)) {
    return <ShareNotice variant="expired" />;
  }

  // 2) 뷰어 이메일: OTP 인증 쿠키(우선) → 로그인 세션 이메일.
  const cookieStore = await cookies();
  const cookieEmail = verifyViewerCookie(
    token,
    cookieStore.get(viewerCookieName(token))?.value,
  );

  let sessionEmail: string | null = null;
  if (!cookieEmail) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    sessionEmail = user?.email ?? null;
  }

  const candidateEmail = cookieEmail ?? sessionEmail;

  // 3) 게이트 — 통과 시에만 리소스 read-only 로드 + 렌더.
  if (candidateEmail) {
    const gate = await assertInvitedViewer(admin, token, candidateEmail);
    if (gate.ok) {
      const resource = await loadShareResource(
        admin,
        gate.share.resource_type,
        gate.share.resource_id,
      );
      // 원본이 삭제된 dangling 공유 → 데이터 노출 없이 무효 안내.
      if (!resource) return <ShareNotice variant="invalid" />;
      return <ShareViewerFrame resource={resource} />;
    }
    // 죽은 링크는 위에서 이미 걸렀지만 레이스 대비 — reason 별 안내.
    if (gate.status === 404) return <ShareNotice variant="invalid" />;
    if (gate.reason === 'revoked') return <ShareNotice variant="revoked" />;
    if (gate.reason === 'expired') return <ShareNotice variant="expired" />;
    // not_invited → OTP 게이트. 로그인 세션 이메일이 미초대였으면 안내.
    return (
      <ShareEmailGate
        token={token}
        prefillEmail={sessionEmail ?? undefined}
        notInvited={Boolean(sessionEmail)}
      />
    );
  }

  // 이메일 미확보(비로그인 외부인) → OTP 게이트.
  return <ShareEmailGate token={token} />;
}

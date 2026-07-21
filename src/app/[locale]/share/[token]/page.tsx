import { setRequestLocale } from 'next-intl/server';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  assertViewerAttendeeById,
  isShareExpired,
} from '@/lib/share/shared-views';
import { loadShareResource } from '@/lib/share/viewer-resource';
import {
  verifyAttendeeCookie,
  viewerCookieName,
} from '@/lib/share/viewer-cookie';
import { ShareViewerFrame } from '@/components/share/share-viewer-frame';
import { SharePhoneGate } from '@/components/share/share-phone-gate';
import { ShareNotice } from '@/components/share/share-notice';

// 공유 뷰어 페이지 — 전화번호 뒷자리 게이트 오케스트레이션 (PR-B).
//
// 순서:
//   1) 뒷자리와 무관한 토큰 상태 확인 — 무효/폐기/만료면 게이트 없이 안내
//      (데이터 노출 0).
//   2) attendee 쿠키(뒷자리 게이트 통과 증명)로 attendee_id 복원 → 서버에서
//      이 살아있는 share 소속 invite 인지 재확인.
//   3) 통과 시에만 service_role 로 리소스를 read-only 로드해 프레임 렌더.
//      아니면 뒷자리 게이트 표시.
//
// 이전 이메일 OTP 게이트는 뒷자리 게이트로 대체됐다(사용자 결정). 신원은
// token+attendee 로 스코프되며, 실제 채팅 read/write 격리는 PR-C 가 이 신원을
// 사용한다.

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const admin = createAdminClient();

  // 1) 죽은 링크는 게이트를 띄우지 않고 바로 안내(데이터 0).
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

  // 2) attendee 쿠키 → attendee_id 복원. 신원은 서버 서명 쿠키에서만 온다.
  const cookieStore = await cookies();
  const attendeeId = verifyAttendeeCookie(
    token,
    cookieStore.get(viewerCookieName(token))?.value,
  );

  // 3) 게이트 — 쿠키의 attendee 가 이 share 의 invite 로 여전히 유효하면 렌더.
  if (attendeeId) {
    const gate = await assertViewerAttendeeById(admin, token, attendeeId);
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
    // 죽은 링크는 위에서 걸렀지만 레이스 대비 — reason 별 안내.
    if (gate.reason === 'revoked') return <ShareNotice variant="revoked" />;
    if (gate.reason === 'expired') return <ShareNotice variant="expired" />;
    // 쿠키가 stale(invite 제거 등) → 뒷자리 게이트로 다시.
  }

  // 뒷자리 미인증 → 게이트 표시.
  return <SharePhoneGate token={token} />;
}

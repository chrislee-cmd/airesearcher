// 공유 링크 backend — shared_views + 이메일 초대 게이트 공용 헬퍼.
//
// - 토큰 발급 / 이메일 정규화 / TTL 기본값
// - resolveResourceOrg: 공유 대상 리소스의 org_id 를 org-scoped(사용자) 클라
//   이언트로 조회 → RLS 가 소유권을 강제(못 보면 null). API 가 "자기 org
//   resource 만" 을 여기로 검증한다.
// - assertInvitedViewer: 뷰어 라우트(#475)가 쓰는 이메일 게이트. service_role
//   로 토큰 유효(미폐기·미만료) + 이메일 ∈ invites 를 검사.
//
// 🔒 outward-facing 안전장치: 게이트는 revoke → 만료 → allow-list 순으로 최소
// 노출 원칙을 지킨다. 토큰/이메일은 로그로 새어나가지 않게 반환 shape 에만
// 담고 콘솔에 찍지 않는다.

import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/** 공유 가능한 리소스 타입 — scope 한정(자유검색 등 제외). */
export const SHARE_RESOURCE_TYPES = [
  'interview_topline',
  'probing_persona',
] as const;
export type ShareResourceType = (typeof SHARE_RESOURCE_TYPES)[number];

/** resource_type → org_id 를 담은 원본 테이블. */
const RESOURCE_TABLE: Record<ShareResourceType, string> = {
  interview_topline: 'interview_toplines',
  probing_persona: 'probing_sessions',
};

/** 만료 기본값 — 30일(결정 2). #477 관리 UI 에서 조정 가능. */
export const DEFAULT_SHARE_TTL_DAYS = 30;

const TOKEN_LEN = 21;
const URL_SAFE =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/**
 * URL-safe unguessable 토큰(21자). translate share_token 과 같은 방식 —
 * nanoid 를 top-level dep 로 끌어오지 않으려고 crypto.randomBytes 직접 사용.
 */
export function makeShareToken(): string {
  const bytes = randomBytes(TOKEN_LEN);
  let out = '';
  for (let i = 0; i < TOKEN_LEN; i++) out += URL_SAFE[bytes[i] & 63];
  return out;
}

/** 이메일 정규화 — 게이트 비교를 대소문자·공백 무관하게. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * 공유 대상 리소스의 org_id 를 org-scoped 클라이언트로 조회한다.
 * RLS 가 "자기 org(또는 본인) resource" 만 보이게 하므로, null 이면
 * 접근 권한 없음(타 org) 또는 존재하지 않음 → API 는 둘 다 forbidden 처리.
 */
export async function resolveResourceOrg(
  supabase: SupabaseClient,
  resourceType: ShareResourceType,
  resourceId: string,
): Promise<{ orgId: string } | null> {
  const table = RESOURCE_TABLE[resourceType];
  const { data, error } = await supabase
    .from(table)
    .select('org_id')
    .eq('id', resourceId)
    .maybeSingle();
  if (error || !data?.org_id) return null;
  return { orgId: data.org_id as string };
}

export type ViewerGateResult =
  | {
      ok: true;
      share: {
        id: string;
        resource_type: ShareResourceType;
        resource_id: string;
        org_id: string;
        expires_at: string | null;
      };
    }
  | { ok: false; status: 403 | 404; reason: 'not_found' | 'revoked' | 'expired' | 'not_invited' };

/**
 * 이메일 게이트 — 뷰어 라우트(#475)가 토큰+뷰어 이메일로 호출.
 * service_role(admin) 클라이언트로 shared_views 를 조회하고
 *   1) 토큰 존재  2) 미폐기  3) 미만료  4) 이메일 ∈ invites
 * 를 순서대로 검사. 하나라도 실패하면 열람 거부(403/404).
 *
 * @param admin  createAdminClient() 로 만든 service_role 클라이언트
 * @param token  공유 링크 토큰
 * @param viewerEmail  #475 에서 인증된 뷰어 이메일(계정 이메일 매칭 or OTP)
 */
export async function assertInvitedViewer(
  admin: SupabaseClient,
  token: string,
  viewerEmail: string,
): Promise<ViewerGateResult> {
  const { data: share, error } = await admin
    .from('shared_views')
    .select('id, resource_type, resource_id, org_id, expires_at, revoked_at')
    .eq('token', token)
    .maybeSingle();
  if (error || !share) return { ok: false, status: 404, reason: 'not_found' };

  if (share.revoked_at) return { ok: false, status: 403, reason: 'revoked' };
  if (share.expires_at && new Date(share.expires_at).getTime() <= Date.now()) {
    return { ok: false, status: 403, reason: 'expired' };
  }

  const email = normalizeEmail(viewerEmail);
  const { data: invite } = await admin
    .from('shared_view_invites')
    .select('id')
    .eq('shared_view_id', share.id)
    .eq('email', email)
    .maybeSingle();
  if (!invite) return { ok: false, status: 403, reason: 'not_invited' };

  return {
    ok: true,
    share: {
      id: share.id,
      resource_type: share.resource_type as ShareResourceType,
      resource_id: share.resource_id,
      org_id: share.org_id,
      expires_at: share.expires_at,
    },
  };
}

// 공유 링크 backend — shared_views + 이메일 초대 게이트 공용 헬퍼.
//
// - 토큰 발급 / 이메일 정규화 / TTL 기본값
// - resolveShareableResource: 공유 대상 리소스의 소유권 + 완료상태를 검증하고
//   shared_views.org_id 로 쓸 org 를 돌려준다. org-scoped(사용자) 클라이언트로
//   조회 → RLS 가 소유권을 강제(못 보면 forbidden). transcript/desk 는
//   status='done', ut 는 insight_status='done' 인 완료본만 발급 가능(미완성 409).
// - assertInvitedViewer: 뷰어 라우트(#475)가 쓰는 이메일 게이트. service_role
//   로 토큰 유효(미폐기·미만료) + 이메일 ∈ invites 를 검사.
//
// 🔒 outward-facing 안전장치: 게이트는 revoke → 만료 → allow-list 순으로 최소
// 노출 원칙을 지킨다. 토큰/이메일은 로그로 새어나가지 않게 반환 shape 에만
// 담고 콘솔에 찍지 않는다.

import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getActiveOrg } from '@/lib/org';

/**
 * 공유 가능한 리소스 타입 — scope 한정(자유검색 등 제외).
 * 산출물 통합(narrow-waist)으로 3타입 편입 — transcript / ut_insight /
 * desk_report. resource_id 는 각각 transcript_jobs / ut_sessions / desk_jobs 의
 * id 를 가리킨다(polymorphic, FK 없음).
 */
export const SHARE_RESOURCE_TYPES = [
  'interview_topline',
  'probing_persona',
  'transcript',
  'ut_insight',
  'desk_report',
] as const;
export type ShareResourceType = (typeof SHARE_RESOURCE_TYPES)[number];

/**
 * org 스코프로 소유권을 강제하는 리소스 스펙. org_id 컬럼을 org-scoped(RLS)
 * 클라이언트로 읽어 "자기 org resource 만" 을 강제하고, statusColumn 이 있으면
 * doneValue 인 완료본만 발급(미완성은 409). ut_insight 는 org_id 가 nullable +
 * user 스코프 RLS 라 별도 처리(resolveUtInsight).
 */
type OrgScopedSpec = {
  table: string;
  statusColumn: string | null;
  doneValue: string | null;
};

const ORG_SCOPED: Record<Exclude<ShareResourceType, 'ut_insight'>, OrgScopedSpec> = {
  // 기존 2타입 — 상태 게이트 없음(무변경).
  interview_topline: { table: 'interview_toplines', statusColumn: null, doneValue: null },
  probing_persona: { table: 'probing_sessions', statusColumn: null, doneValue: null },
  // 신규 — done 완료본만 발급 가능(라이브러리 "processing 은 공유 비활성" 규칙).
  transcript: { table: 'transcript_jobs', statusColumn: 'status', doneValue: 'done' },
  desk_report: { table: 'desk_jobs', statusColumn: 'status', doneValue: 'done' },
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

/** 만료 판정 — expires_at 이 현재 이후면 만료. (컴포넌트 렌더에서 Date.now()
 *  직접 호출을 피하려 lib 로 추출: react-hooks/purity.) */
export function isShareExpired(expiresAt: string | null): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() <= Date.now();
}

export type ResolveShareableResult =
  | { ok: true; orgId: string }
  | { ok: false; status: 403 | 409; error: string };

/**
 * 공유 대상 리소스의 소유권 + 완료상태를 검증하고 shared_views.org_id 로 쓸
 * org 를 돌려준다. RLS 가 "자기 org(또는 본인) resource" 만 보이게 하므로,
 * 못 보면 forbidden(403). 완료상태 게이트가 있는 타입(transcript/desk/ut)은
 * 미완성 산출물이면 not_ready(409) — 라이브러리 UI 의 "processing 은 공유
 * 비활성" 규칙과 일치.
 */
export async function resolveShareableResource(
  supabase: SupabaseClient,
  resourceType: ShareResourceType,
  resourceId: string,
): Promise<ResolveShareableResult> {
  if (resourceType === 'ut_insight') {
    return resolveUtInsight(supabase, resourceId);
  }

  const spec = ORG_SCOPED[resourceType];
  const columns = spec.statusColumn ? `org_id, ${spec.statusColumn}` : 'org_id';
  const { data, error } = await supabase
    .from(spec.table)
    .select(columns)
    .eq('id', resourceId)
    .maybeSingle<Record<string, unknown>>();
  if (error || !data?.org_id) return { ok: false, status: 403, error: 'forbidden' };
  if (spec.statusColumn && spec.doneValue) {
    if (data[spec.statusColumn] !== spec.doneValue) {
      return { ok: false, status: 409, error: 'not_ready' };
    }
  }
  return { ok: true, orgId: data.org_id as string };
}

/**
 * ut_insight 는 org_id 가 nullable(best-effort) + user 스코프 RLS(self_read /
 * super_admin_read)라 별도 처리. org-scoped 클라이언트로 못 읽으면(비소유·비관리)
 * forbidden. insight 리포트가 완성(insight_status='done')된 세션만 발급 가능.
 * shared_views.org_id 는 NOT NULL 이므로, 세션 org_id 가 null 이면 발급자의
 * active org 로 폴백한다(발급자는 세션 소유자라 그 org 멤버 — RLS insert 통과).
 */
async function resolveUtInsight(
  supabase: SupabaseClient,
  resourceId: string,
): Promise<ResolveShareableResult> {
  const { data, error } = await supabase
    .from('ut_sessions')
    .select('org_id, insight_status')
    .eq('id', resourceId)
    .maybeSingle<{ org_id: string | null; insight_status: string | null }>();
  if (error || !data) return { ok: false, status: 403, error: 'forbidden' };
  if (data.insight_status !== 'done') return { ok: false, status: 409, error: 'not_ready' };

  let orgId = data.org_id;
  if (!orgId) {
    const active = await getActiveOrg();
    orgId = active?.org_id ?? null;
  }
  if (!orgId) return { ok: false, status: 403, error: 'no_org' };
  return { ok: true, orgId };
}

export type ViewerGateResult =
  | {
      ok: true;
      share: {
        id: string;
        resource_type: ShareResourceType;
        resource_id: string;
        org_id: string;
        // 공유 시점(created_at) + 만료 — DECISIONS D2: 공개 페이지 attribution
        // 은 공유일/만료만, 공유자 실명은 노출하지 않는다.
        shared_at: string;
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
    .select('id, resource_type, resource_id, org_id, created_at, expires_at, revoked_at')
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
      shared_at: share.created_at,
      expires_at: share.expires_at,
    },
  };
}

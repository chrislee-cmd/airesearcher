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
  // 리크루팅 읽기전용 공유 — resource_id = recruiting_forms.form_id(text PK,
  // uuid 아님). 공개 노출은 집계·요약만(loaders.ts loadRecruitingSummary).
  'recruiting_summary',
] as const;
export type ShareResourceType = (typeof SHARE_RESOURCE_TYPES)[number];

/**
 * 타입 → 한국어 라벨 · 파스텔 톤(관리 대시보드 계약). 서버가 제공한다 —
 * 클라이언트 타입→라벨 맵 금지(DECISIONS §5-1, share-shell §5.2 선례). 톤은 CD
 * BUILD-SPEC §0.2 표 그대로: 전사록=lav · 데스크=aqua · UT=peach · 리크루팅=sun ·
 * 프로빙=sky · 인터뷰=rose. (한 곳에 모아 mine API 가 소비.)
 */
export const RESOURCE_LABELS: Record<ShareResourceType, string> = {
  interview_topline: '인터뷰 결과',
  probing_persona: '프로빙 페르소나',
  transcript: '전사록',
  ut_insight: '사용성 테스트',
  desk_report: '데스크 리서치',
  recruiting_summary: '리크루팅',
};

export const RESOURCE_TONES: Record<ShareResourceType, string> = {
  interview_topline: 'rose',
  probing_persona: 'sky',
  transcript: 'lav',
  ut_insight: 'peach',
  desk_report: 'aqua',
  recruiting_summary: 'sun',
};

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

const ORG_SCOPED: Record<
  Exclude<ShareResourceType, 'ut_insight' | 'recruiting_summary'>,
  OrgScopedSpec
> = {
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
  if (resourceType === 'recruiting_summary') {
    return resolveRecruitingSummary(supabase, resourceId);
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

/**
 * recruiting_summary 는 recruiting_forms(form_id text PK, user_id 스코프, org_id
 * 컬럼 없음)를 소스로 한다. org-scoped(RLS user) 클라이언트로 form 을 읽어
 * 소유권을 강제(auth.uid()=user_id, 못 보면 forbidden)하고, **응답이 존재할
 * 때만** 발급 가능(미발행/응답 0 → not_ready 409).
 *
 * "응답 존재" 판정: 공개 로더는 service_role 이라 Google OAuth 가 없어 라이브
 * Google Forms 응답을 못 세므로(발급 라우트도 발급자의 Google 토큰을 여기서
 * 쥐지 않음), persisted recruiting_response_judgments 행 수(≥1)를 응답 존재의
 * OAuth-free proxy 로 쓴다 — 판단이 1건이라도 있으면 응답이 있었다는 뜻. 미발행
 * 폼/응답 0 은 판단도 0 → 409. shared_views.org_id 는 NOT NULL 인데
 * recruiting_forms 엔 org_id 가 없으므로(ut 와 동형) 발급자의 active org 로
 * 폴백한다(발급자=폼 소유자라 그 org 멤버 → RLS insert 통과).
 */
async function resolveRecruitingSummary(
  supabase: SupabaseClient,
  formId: string,
): Promise<ResolveShareableResult> {
  // 소유권 — RLS(recruiting_forms_self_select)가 자기 폼만 보이게 한다.
  const { data: form, error } = await supabase
    .from('recruiting_forms')
    .select('form_id')
    .eq('form_id', formId)
    .maybeSingle<{ form_id: string }>();
  if (error || !form) return { ok: false, status: 403, error: 'forbidden' };

  // 응답 존재(판단 캐시로 proxy). RLS(recruiting_response_judgments_own_select)
  // 가 소유 폼 판단만 세게 한다.
  const { count, error: countError } = await supabase
    .from('recruiting_response_judgments')
    .select('id', { count: 'exact', head: true })
    .eq('form_id', formId);
  if (countError || !count || count < 1) {
    return { ok: false, status: 409, error: 'not_ready' };
  }

  const active = await getActiveOrg();
  const orgId = active?.org_id ?? null;
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

/**
 * 열람 집계 increment — 뷰어 게이트 통과 후 렌더 시점에 호출(뷰어 페이지,
 * service_role admin). 원자적 SQL 식으로 view_count+1 · last_viewed_at=now().
 *
 * best-effort: 집계 RPC 실패가 열람을 막지 않도록 에러를 삼킨다(뷰어 경험 우선).
 * 게이트 실패 경로에서는 호출하지 않으므로, 실패 열람은 카운트되지 않는다.
 * 새로고침 남발에 따른 과도집계는 허용(정밀 dedupe 범위 밖 — 스펙 확정).
 *
 * @param admin  createAdminClient() 로 만든 service_role 클라이언트
 * @param shareId  shared_views.id (게이트가 돌려준 share.id)
 */
export async function recordShareView(
  admin: SupabaseClient,
  shareId: string,
): Promise<void> {
  try {
    // rpc() 는 { error } 를 돌려줄 뿐 throw 하지 않지만, 네트워크 예외까지
    // 삼켜 렌더를 절대 막지 않는다(집계는 부수효과, 게이트가 SSOT).
    await admin.rpc('increment_shared_view', { p_share_id: shareId });
  } catch {
    // best-effort — 무음. 열람수 유실은 허용, 뷰어 경험이 우선.
  }
}

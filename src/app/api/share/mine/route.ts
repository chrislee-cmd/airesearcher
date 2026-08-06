// GET /api/share/mine — 내가 만든(또는 org admin 으로 볼 수 있는) 공유 목록.
//
// 관리 UI(#477 → 공유 관리 대시보드)용. 가시성은 RLS
// (shared_views_select_owner_or_admin)가 강제한다 — member 는 자기 발급분만,
// org admin/owner 는 조직 전체. 여기서는 RLS 로 필터된 rows 를 받은 뒤, 이미
// 열람이 인가된 그 rows 에 한해 제목·발급자를 service_role 로 보강한다(원본
// 테이블 RLS 가 타입마다 달라 — 특히 probing 은 user 스코프 — user 클라이언트로는
// 조직 admin 이 남의 리소스 제목을 못 읽는 갭이 생기므로, 보강만 admin 으로).
//
// 응답은 기존 소비자(공유 모달)와의 회귀 0 을 위해 snake_case 필드를 유지하고
// 대시보드 계약(ShareLinkItem) 필드를 additive 로 얹는다 — 대시보드 어댑터가
// camelCase 로 매핑한다.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import {
  RESOURCE_LABELS,
  RESOURCE_TONES,
  type ShareResourceType,
} from '@/lib/share/shared-views';
import { shareViewerUrl } from '@/lib/share/viewer-url';
import { routing } from '@/i18n/routing';
import type { SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

type ShareRow = {
  id: string;
  token: string;
  resource_type: string;
  resource_id: string;
  org_id: string;
  created_by: string;
  expires_at: string | null;
  revoked_at: string | null;
  view_count: number | null;
  last_viewed_at: string | null;
  created_at: string;
};

/** 파일명 확장자 제거 — 전사록 제목(뷰어 셸 stripExt 와 동형). */
function stripExt(name: string): string {
  return name.replace(/\.[^./\\]+$/, '');
}

/** revoked_at 우선 → expires_at 비교로 상태 파생. */
function deriveStatus(
  revokedAt: string | null,
  expiresAt: string | null,
): 'active' | 'expired' | 'revoked' {
  if (revokedAt) return 'revoked';
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) return 'expired';
  return 'active';
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // RLS 로 가시성 필터된 공유 목록.
  const { data: sharesRaw, error } = await supabase
    .from('shared_views')
    .select(
      'id, token, resource_type, resource_id, org_id, created_by, expires_at, revoked_at, view_count, last_viewed_at, created_at',
    )
    .order('created_at', { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const shares = (sharesRaw ?? []) as ShareRow[];

  // 초대 이메일 — RLS(부모 종속) 로 user 클라이언트 조회 유지(기존 동작).
  const shareIds = shares.map((s) => s.id);
  const invitesByShare = new Map<string, string[]>();
  if (shareIds.length > 0) {
    const { data: invites } = await supabase
      .from('shared_view_invites')
      .select('shared_view_id, email')
      .in('shared_view_id', shareIds);
    for (const inv of invites ?? []) {
      const list = invitesByShare.get(inv.shared_view_id) ?? [];
      list.push(inv.email);
      invitesByShare.set(inv.shared_view_id, list);
    }
  }

  // 제목·발급자 보강은 service_role 로(이미 인가된 rows 한정, RLS 갭 회피).
  const admin = createAdminClient();
  const [titleByShare, issuerNameById] = await Promise.all([
    resolveTitles(admin, shares),
    resolveIssuers(admin, shares),
  ]);

  // URL 조립 — origin 은 요청에서, locale 은 ?locale= (없으면 기본 locale).
  const origin = new URL(req.url).origin;
  const reqLocale = new URL(req.url).searchParams.get('locale');
  const locale =
    reqLocale && routing.locales.includes(reqLocale as (typeof routing.locales)[number])
      ? reqLocale
      : routing.defaultLocale;

  // 조직 전체 스코프 열람 가능 여부 — 활성 org 에서 admin/owner 인지 파생
  // (capability boolean, role enum 문자열 노출 안 함 — CD 질의 확정).
  const activeOrg = await getActiveOrg();
  const canViewOrgScope =
    activeOrg?.role === 'admin' || activeOrg?.role === 'owner';

  const out = shares.map((s) => {
    const rt = s.resource_type as ShareResourceType;
    return {
      // 기존 필드(회귀 0).
      id: s.id,
      token: s.token,
      resource_type: s.resource_type,
      resource_id: s.resource_id,
      org_id: s.org_id,
      expires_at: s.expires_at,
      revoked_at: s.revoked_at,
      created_at: s.created_at,
      invited_emails: invitesByShare.get(s.id) ?? [],
      // 보강 필드(additive, ShareLinkItem 계약).
      resource_title: titleByShare.get(s.id) ?? null,
      resource_label: RESOURCE_LABELS[rt] ?? s.resource_type,
      tone: RESOURCE_TONES[rt] ?? 'lav',
      status: deriveStatus(s.revoked_at, s.expires_at),
      url: shareViewerUrl(origin, locale, s.token, rt),
      view_count: s.view_count ?? 0,
      last_viewed_at: s.last_viewed_at,
      issuer: {
        // resolve 실패(탈퇴 등)면 name: null → 클라 "(탈퇴한 멤버)" 렌더.
        name: issuerNameById.get(s.created_by) ?? null,
        isMine: s.created_by === user.id,
      },
    };
  });

  return NextResponse.json({ shares: out, canViewOrgScope });
}

/**
 * 타입별로 resource_id 를 모아 원본 테이블에서 제목을 한 번씩(in() 배치) 조회 —
 * N+1 금지. 반환은 shareId → title(원본 삭제/미해결 시 null). service_role 이라
 * 타입별 RLS 차이(특히 probing user 스코프)에 걸리지 않는다.
 */
async function resolveTitles(
  admin: SupabaseClient,
  shares: ShareRow[],
): Promise<Map<string, string | null>> {
  const byType = new Map<ShareResourceType, ShareRow[]>();
  for (const s of shares) {
    const rt = s.resource_type as ShareResourceType;
    const list = byType.get(rt) ?? [];
    list.push(s);
    byType.set(rt, list);
  }

  const result = new Map<string, string | null>();
  const set = (rows: ShareRow[], titleFor: (resId: string) => string | null) => {
    for (const s of rows) result.set(s.id, titleFor(s.resource_id));
  };

  await Promise.all(
    [...byType.entries()].map(async ([type, rows]) => {
      const ids = [...new Set(rows.map((r) => r.resource_id))];
      if (ids.length === 0) return;

      switch (type) {
        case 'interview_topline': {
          // interview_toplines 자체엔 제목이 없어 project 명으로 resolve(2단계).
          const { data: toplines } = await admin
            .from('interview_toplines')
            .select('id, project_id')
            .in('id', ids);
          const projectByTopline = new Map<string, string>();
          const projectIds = new Set<string>();
          for (const tl of toplines ?? []) {
            projectByTopline.set(tl.id as string, tl.project_id as string);
            projectIds.add(tl.project_id as string);
          }
          const nameByProject = new Map<string, string>();
          if (projectIds.size > 0) {
            const { data: projects } = await admin
              .from('interview_projects')
              .select('id, name')
              .in('id', [...projectIds]);
            for (const p of projects ?? []) {
              nameByProject.set(p.id as string, (p.name as string | null) ?? '');
            }
          }
          set(rows, (resId) => {
            const pid = projectByTopline.get(resId);
            const name = pid ? nameByProject.get(pid) : undefined;
            return name && name.trim() ? name : null;
          });
          return;
        }
        case 'probing_persona': {
          // 제목 필드 부재 → research_goal 을 제목으로.
          const { data } = await admin
            .from('probing_sessions')
            .select('id, research_goal')
            .in('id', ids);
          const m = new Map<string, string>();
          for (const r of data ?? [])
            m.set(r.id as string, (r.research_goal as string | null) ?? '');
          set(rows, (resId) => {
            const v = m.get(resId);
            return v && v.trim() ? v : null;
          });
          return;
        }
        case 'transcript': {
          const { data } = await admin
            .from('transcript_jobs')
            .select('id, filename')
            .in('id', ids);
          const m = new Map<string, string>();
          for (const r of data ?? [])
            m.set(r.id as string, (r.filename as string | null) ?? '');
          set(rows, (resId) => {
            const v = m.get(resId);
            return v && v.trim() ? stripExt(v) : null;
          });
          return;
        }
        case 'ut_insight': {
          const { data } = await admin
            .from('ut_sessions')
            .select('id, target_url')
            .in('id', ids);
          const m = new Map<string, string>();
          for (const r of data ?? [])
            m.set(r.id as string, (r.target_url as string | null) ?? '');
          set(rows, (resId) => {
            const v = m.get(resId);
            return v && v.trim() ? v : null;
          });
          return;
        }
        case 'desk_report': {
          const { data } = await admin
            .from('desk_jobs')
            .select('id, keywords')
            .in('id', ids);
          const m = new Map<string, string>();
          for (const r of data ?? []) {
            const kws = Array.isArray(r.keywords)
              ? (r.keywords as unknown[]).filter(
                  (k): k is string => typeof k === 'string',
                )
              : [];
            m.set(r.id as string, kws.join(', '));
          }
          set(rows, (resId) => {
            const v = m.get(resId);
            return v && v.trim() ? v : null;
          });
          return;
        }
        case 'recruiting_summary': {
          // resource_id = recruiting_forms.form_id (text PK).
          const { data } = await admin
            .from('recruiting_forms')
            .select('form_id, title')
            .in('form_id', ids);
          const m = new Map<string, string>();
          for (const r of data ?? [])
            m.set(r.form_id as string, (r.title as string | null) ?? '');
          set(rows, (resId) => {
            const v = m.get(resId);
            return v && v.trim() ? v : null;
          });
          return;
        }
        default:
          set(rows, () => null);
      }
    }),
  );

  return result;
}

/**
 * 발급자(created_by) 표시 이름 resolve — profiles 에서 full_name, 없으면 이메일
 * 로컬파트. resolve 실패(탈퇴 등)면 맵에 없음 → 호출부가 null 로 렌더.
 */
async function resolveIssuers(
  admin: SupabaseClient,
  shares: ShareRow[],
): Promise<Map<string, string>> {
  const ids = [...new Set(shares.map((s) => s.created_by))];
  const nameById = new Map<string, string>();
  if (ids.length === 0) return nameById;

  const { data } = await admin
    .from('profiles')
    .select('id, email, full_name')
    .in('id', ids);
  for (const p of data ?? []) {
    const full = (p.full_name as string | null)?.trim();
    const email = (p.email as string | null)?.trim();
    const name = full || (email ? email.split('@')[0] : '');
    if (name) nameById.set(p.id as string, name);
  }
  return nameById;
}

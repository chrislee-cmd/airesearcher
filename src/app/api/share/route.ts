// POST /api/share — 공유 링크 생성.
//
// {resource_type, resource_id, invited_emails[], expires_at?} → unguessable
// 토큰 발급. 자기 org resource 만(resolveResourceOrg + RLS 이중 검증). 링크를
// 받아도 invited_emails 에 든 이메일만 열람(게이트는 #475 뷰어 라우트).
//
// 🔒 outward-facing — 기본 만료(30일) 강제, revoke 는 별도 라우트.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  SHARE_RESOURCE_TYPES,
  DEFAULT_SHARE_TTL_DAYS,
  makeShareToken,
  normalizeEmail,
  resolveResourceOrg,
} from '@/lib/share/shared-views';

export const runtime = 'nodejs';

const Body = z.object({
  resource_type: z.enum(SHARE_RESOURCE_TYPES),
  resource_id: z.string().uuid(),
  invited_emails: z.array(z.string().email()).default([]),
  // 미지정이면 기본 TTL(30일). 지정 시 미래여야 함.
  expires_at: z.string().datetime().optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { resource_type, resource_id, invited_emails, expires_at } = parsed.data;

  // 자기 org resource 만 — RLS 로 못 보면 null(타 org 또는 없음) → forbidden.
  const resource = await resolveResourceOrg(supabase, resource_type, resource_id);
  if (!resource) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const expiresAt =
    expires_at ??
    new Date(
      Date.now() + DEFAULT_SHARE_TTL_DAYS * 24 * 3600 * 1000,
    ).toISOString();
  if (new Date(expiresAt).getTime() <= Date.now()) {
    return NextResponse.json({ error: 'expires_in_past' }, { status: 400 });
  }

  const token = makeShareToken();
  const { data: share, error } = await supabase
    .from('shared_views')
    .insert({
      token,
      resource_type,
      resource_id,
      org_id: resource.orgId,
      created_by: user.id,
      expires_at: expiresAt,
    })
    .select('id, token, expires_at')
    .single();
  if (error || !share) {
    // RLS insert 거부(member 미만)도 여기로 — org 권한 없음.
    return NextResponse.json({ error: 'share_failed' }, { status: 403 });
  }

  // 초대 이메일 — 정규화 + 중복 제거 후 삽입. 중복은 무시(no-op).
  const emails = [...new Set(invited_emails.map(normalizeEmail))].filter(Boolean);
  if (emails.length > 0) {
    const { error: inviteError } = await supabase
      .from('shared_view_invites')
      .upsert(
        emails.map((email) => ({ shared_view_id: share.id, email })),
        { onConflict: 'shared_view_id,email', ignoreDuplicates: true },
      );
    if (inviteError) {
      return NextResponse.json({ error: 'invite_failed' }, { status: 500 });
    }
  }

  return NextResponse.json({
    id: share.id,
    token: share.token,
    expires_at: share.expires_at,
    invited_count: emails.length,
  });
}

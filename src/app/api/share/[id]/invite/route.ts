// POST   /api/share/[id]/invite — 초대 이메일 추가(allow-list 확장).
// DELETE /api/share/[id]/invite — 초대 이메일 제거.
//
// 권한은 RLS(shared_view_invites_*_via_parent)가 강제 — 부모 shared_view 를
// 관리(생성자 or org admin)할 수 있어야 invite 를 변경할 수 있다. 여기서는
// 존재 확인 후 그 위에서 upsert/delete.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  normalizeEmail,
  normalizePhone,
  phoneLast4,
} from '@/lib/share/shared-views';

export const runtime = 'nodejs';

// 두 입력 형태를 모두 받는다(하위호환):
//   · legacy: { emails: string[] }                  — 전화 없음(뒷자리 게이트 제외)
//   · new:    { invites: [{ email, phone? }] }       — 뒷자리 게이트용 전화 등록
// phone 을 준 invite 는 서버에서 phone_last4 를 도출해 함께 저장한다.
const AddBody = z.union([
  z.object({ emails: z.array(z.string().email()).min(1) }),
  z.object({
    invites: z
      .array(
        z.object({
          email: z.string().email(),
          phone: z.string().max(32).optional(),
        }),
      )
      .min(1),
  }),
]);
const RemoveBody = z.object({
  email: z.string().email(),
});

type InviteRow = {
  shared_view_id: string;
  email: string;
  phone: string | null;
  phone_last4: string | null;
};

// 부모 shared_view 가 현재 사용자에게 관리 가능(select 됨)한지 확인.
// RLS 가 이미 가시성을 좁혀서, 못 보면 404 로 관리 불가 신호.
async function requireManagableShare(
  supabase: Awaited<ReturnType<typeof createClient>>,
  shareId: string,
) {
  const { data, error } = await supabase
    .from('shared_views')
    .select('id')
    .eq('id', shareId)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 as const };
  if (!data) return { error: 'not_found', status: 404 as const };
  return { ok: true as const };
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = AddBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const gate = await requireManagableShare(supabase, id);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  // 두 형태를 email→phone 맵으로 정규화(같은 이메일 중복은 마지막이 이김).
  const byEmail = new Map<string, string | null>();
  if ('emails' in parsed.data) {
    for (const raw of parsed.data.emails) {
      const email = normalizeEmail(raw);
      if (email && !byEmail.has(email)) byEmail.set(email, null);
    }
  } else {
    for (const inv of parsed.data.invites) {
      const email = normalizeEmail(inv.email);
      if (!email) continue;
      const phone = inv.phone ? normalizePhone(inv.phone) : '';
      byEmail.set(email, phone || null);
    }
  }

  const rows: InviteRow[] = [...byEmail.entries()].map(([email, phone]) => ({
    shared_view_id: id,
    email,
    phone,
    phone_last4: phone ? phoneLast4(phone) : null,
  }));

  // onConflict 무시(ignoreDuplicates)면 이미 존재하는 (share,email) 의 전화를
  // 갱신하지 못한다 — 뒷자리 재등록/수정이 반영되도록 merge upsert 로 덮어쓴다.
  const { error } = await supabase
    .from('shared_view_invites')
    .upsert(rows, { onConflict: 'shared_view_id,email' });
  if (error) {
    // RLS insert 거부(관리 권한 없음)도 여기로.
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return NextResponse.json({ ok: true, added: rows.length });
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = RemoveBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const gate = await requireManagableShare(supabase, id);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const { error } = await supabase
    .from('shared_view_invites')
    .delete()
    .eq('shared_view_id', id)
    .eq('email', normalizeEmail(parsed.data.email));
  if (error) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}

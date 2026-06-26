// probing_questions — single-row DELETE (PR-12) + PATCH (PR-13).
//
// DELETE — 위젯의 ✕ 버튼이 호출. confirm 없이 즉시 삭제 (사용자 명시).
// PATCH  — 핵심 질문 ★ 토글 (is_core boolean). 같은 endpoint 라 future-proof —
//          다른 단일 필드 업데이트가 생겨도 같은 PATCH 로 합칠 수 있다.
//
// RLS 가 user_id gate 를 강제하므로 핸들러는 id 만 받아서 update/delete 한다 —
// 본인 row 가 아니면 RLS 가 막아 0 rows 가 반환된다.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 15;

const PatchBody = z.object({
  is_core: z.boolean(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { is_core } = parsed.data;

  const { data, error } = await supabase
    .from('probing_questions')
    .update({ is_core })
    .eq('id', id)
    .select('id, is_core')
    .maybeSingle();
  if (error) {
    console.error('[probing/questions] patch failed', error);
    return NextResponse.json({ error: 'patch_failed' }, { status: 500 });
  }
  if (!data) {
    // RLS 가 막았거나 row 가 사라진 경우 — 클라이언트가 optimistic 롤백 가능.
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ row: data });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { error } = await supabase
    .from('probing_questions')
    .delete()
    .eq('id', id);
  if (error) {
    console.error('[probing/questions] delete failed', error);
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

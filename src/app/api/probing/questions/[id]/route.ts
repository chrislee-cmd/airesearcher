// probing_questions — single-row DELETE (PR-12).
//
// 위젯의 ✕ 버튼이 호출. confirm 없이 즉시 삭제 (사용자 명시). RLS 가 user_id
// gate 를 강제하므로 핸들러는 id 만 받아서 delete 한다 — 본인 row 가 아니면
// RLS 가 막아 404 처럼 0 rows 가 반환된다.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 15;

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

// 유저 뷰 선호 (캔버스 ⇄ 리스트) 영속화 — profiles.view_mode 를 갱신한다.
//
// 헤더 토글이 낙관적으로 클라 state 를 즉시 스왑한 뒤, 이 엔드포인트로 선호를
// DB 에 저장한다 (기기 간 동기). 실패 시 클라가 이전 값으로 롤백한다. 소유·
// 접근 검증은 RLS profiles_self_update (auth.uid() = id) 가 담당 — 유저는 자기
// row 만 갱신할 수 있으므로 여기선 인증 확인 + 값 검증만 한다.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const Body = z.object({
  view_mode: z.enum(['canvas', 'list']),
});

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_view_mode' }, { status: 400 });
  }

  const { error } = await supabase
    .from('profiles')
    .update({ view_mode: parsed.data.view_mode })
    .eq('id', user.id);

  if (error) {
    console.error('[account/view-mode] update error', error);
    return NextResponse.json({ error: 'write_failed' }, { status: 500 });
  }

  return NextResponse.json({ view_mode: parsed.data.view_mode });
}

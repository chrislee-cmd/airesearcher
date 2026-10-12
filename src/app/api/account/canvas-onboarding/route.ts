// 캔버스 전환 온보딩 — 말풍선을 본 것으로 기록한다 (P4 · §8 닫힘).
//
// "알겠어요" · Esc · **팔레트 타일을 처음 누르거나 끌 때** 어느 쪽이든 호출된다.
// 기록이 사용자 단위 서버 플래그라야 기기가 바뀌어도 다시 뜨지 않는다
// (§11 Done-when "기기가 바뀌어도 재노출 0").
//
// 클라는 낙관적으로 먼저 닫고 이 엔드포인트를 fire-and-forget 으로 부른다 —
// 실패해도 이번 세션에서는 닫힌 상태를 유지한다(안내가 다시 튀어나오는 쪽이 더
// 나쁘다). 소유·접근 검증은 RLS profiles_self_update (auth.uid() = id) 가
// 담당하므로 여기선 인증 확인만 한다.
//
// `pending` → `done` 만 바꾼다: `skip`(대상 아님)을 건드리지 않으므로, 어떤
// 경로로 잘못 호출돼도 신규 사용자의 상태가 오염되지 않는다.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { error } = await supabase
    .from('profiles')
    .update({ canvas_palette_onboarding: 'done' })
    .eq('id', user.id)
    .eq('canvas_palette_onboarding', 'pending');

  if (error) {
    console.error('[account/canvas-onboarding] update error', error);
    return NextResponse.json({ error: 'write_failed' }, { status: 500 });
  }

  return NextResponse.json({ canvas_palette_onboarding: 'done' });
}

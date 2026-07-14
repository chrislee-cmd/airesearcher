// 언어 선호 (ko/en/ja/th) 영속화 — profiles.locale 을 갱신한다.
//
// 스위처/언어 제안 배너가 명시 선택을 NEXT_LOCALE 쿠키에 심는 것과 별개로,
// 로그인 유저는 선택을 DB 에도 저장해 다른 기기에서도 유지되게 한다. auth
// callback(src/app/auth/callback/route.ts)이 로그인 시 이 값을 읽어 그 로케일로
// 리다이렉트 + 쿠키를 세팅한다(쿠키↔DB 불일치 시 DB 우선). view-mode 와 동일한
// 유저 단위 additive 패턴 — 소유·접근 검증은 RLS profiles_self_update
// (auth.uid() = id) 가 담당하므로 여기선 인증 확인 + 값 검증만 한다.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { routing } from '@/i18n/routing';

export const runtime = 'nodejs';

const Body = z.object({
  // 지원 로케일만 허용 — routing.locales 를 SSOT 로 재사용해 드리프트 0.
  locale: z.enum(routing.locales as unknown as [string, ...string[]]),
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
    return NextResponse.json({ error: 'invalid_locale' }, { status: 400 });
  }

  const { error } = await supabase
    .from('profiles')
    .update({ locale: parsed.data.locale })
    .eq('id', user.id);

  if (error) {
    console.error('[account/locale] update error', error);
    return NextResponse.json({ error: 'write_failed' }, { status: 500 });
  }

  return NextResponse.json({ locale: parsed.data.locale });
}

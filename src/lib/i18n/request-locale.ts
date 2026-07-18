import 'server-only';

import { cookies } from 'next/headers';

import { routing } from '@/i18n/routing';

// API 라우트에서 유저 UI 로케일을 읽는다 — next-intl 이 세팅하는 NEXT_LOCALE
// 쿠키가 SSOT 다. 로그인 시 auth callback(src/app/auth/callback/route.ts)이
// profiles.locale(#1038)을 읽어 이 쿠키를 동기화하므로, 쿠키 = 유저의 명시
// 로케일 선호로 신뢰할 수 있다. 쿠키가 없거나 미지원 값이면 defaultLocale('en').
//
// LLM 산출물 출력 언어 폴백(위젯 명시 선택이 없을 때) + 유저-facing 이메일
// 로케일 결정에 쓰인다. resolveOutputLang(explicit, locale) 의 locale 인자.
export async function readRequestLocale(): Promise<string> {
  try {
    const store = await cookies();
    const value = store.get('NEXT_LOCALE')?.value;
    if (value && (routing.locales as readonly string[]).includes(value)) {
      return value;
    }
  } catch {
    // cookies() 는 특정 컨텍스트(정적 렌더 등)에서 던질 수 있다 — 무음 폴백.
  }
  return routing.defaultLocale;
}

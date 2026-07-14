// 언어 선호 클라이언트 헬퍼 — 스위처와 언어 제안 배너가 공유한다.
//
// 두 가지 관심사:
//   1. persistLocalePreference — 로그인 유저의 명시 선택을 DB(profiles.locale)에
//      저장(best-effort). NEXT_LOCALE 쿠키는 next-intl 라우터가 세팅하므로
//      여기선 기기 간 동기용 DB 쓰기만 담당한다. 미로그인이면 401 이 오지만
//      무시한다(view-mode 와 동일한 무음 best-effort 패턴).
//   2. 언어 제안 배너 dismiss 마커 — 사용자가 배너를 닫거나 언어를 명시 선택하면
//      다시 뜨지 않도록 쿠키를 심는다. 스위처의 명시 선택도 이 마커를 심어,
//      영어를 명시 선택한 한국어 브라우저 유저에게 배너가 계속 뜨는 걸 막는다.

'use client';

import { fetchWithAuth } from '@/lib/api/fetch-with-auth';

// 언어 제안 배너 재노출 억제 쿠키. NEXT_LOCALE 과 같은 1년 수명이라 선호와 함께
// 만료된다.
export const LOCALE_SUGGEST_DISMISS_COOKIE = 'locale_suggest_dismissed';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function persistLocalePreference(locale: string): Promise<unknown> {
  return fetchWithAuth('/api/account/locale', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ locale }),
  }).catch(() => {});
}

export function hasCookie(name: string): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie
    .split('; ')
    .some((c) => c.startsWith(`${name}=`));
}

export function markLocaleSuggestDismissed(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${LOCALE_SUGGEST_DISMISS_COOKIE}=1; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}

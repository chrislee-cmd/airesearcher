// 공유 뷰어 URL 세그먼트 로직 SSOT — 발급 모달(client)과 /api/share/mine(server)
// 이 공유한다. share-invite-modal 에 있던 UNIFIED_TYPES 세그(`share/d` vs `share`)
// 판정을 여기로 추출해 두 소비자가 같은 규칙을 쓰게 한다(중복 구현 금지).
//
// shared-views.ts 는 node:crypto 를 끌어와 client bundle 에 못 들어가므로, 여기선
// 타입만(`import type`) 참조한다 — 타입 import 는 컴파일 시 제거돼 이 모듈은
// client-safe 하게 유지된다.

import type { ShareResourceType } from './shared-views';

// 산출물 통합 4타입은 신규 공개 셸 라우트(/share/d/[token], Surface B), 기존 2타입
// (interview_topline / probing_persona)은 구 뷰어 라우트(/share/[token]). 둘 다
// localePrefix:'always' 라 locale 세그먼트가 필수.
const UNIFIED_TYPES: ReadonlySet<ShareResourceType> = new Set([
  'transcript',
  'desk_report',
  'ut_insight',
  'recruiting_summary',
]);

/** 공유 뷰어 경로(locale 포함, origin 제외). */
export function shareViewerPath(
  locale: string,
  token: string,
  resourceType: ShareResourceType,
): string {
  const seg = UNIFIED_TYPES.has(resourceType) ? 'share/d' : 'share';
  return `/${locale}/${seg}/${token}`;
}

/**
 * 전체 공유 URL — origin 이 있으면 절대 URL, 없으면(SSR·origin 미확보) 경로만
 * 반환한다.
 */
export function shareViewerUrl(
  origin: string | null | undefined,
  locale: string,
  token: string,
  resourceType: ShareResourceType,
): string {
  const path = shareViewerPath(locale, token, resourceType);
  return origin ? `${origin}${path}` : path;
}

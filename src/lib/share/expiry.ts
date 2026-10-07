// 공유 링크 상태 파생 — 클라이언트 안전(node:crypto 미의존).
//
// shared-views.ts 는 토큰 발급에 node:crypto(randomBytes)를 끌어와 client bundle
// 에 못 들어간다. 그래서 만료/상태 판정만 이 순수 모듈로 분리해, 공유 모달
// (client)·/api/share/mine(server)·뷰어 페이지가 같은 규칙을 공유한다.
// 활성 = 미폐기(revoked_at 없음) && 미만료(expires_at 미도래). revoke 만 보고
// 만료를 무시하면 만료 링크가 활성처럼 되살아난다(이 PR 이 고치는 버그).

export type ShareStatus = 'active' | 'expired' | 'revoked';

/** 만료 판정 — expires_at 이 현재 이후면 만료. null(만료 없음)은 만료 아님. */
export function isShareExpired(expiresAt: string | null): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() <= Date.now();
}

/** revoked_at 우선 → expires_at 비교로 상태 파생. 활성 = 미폐기 && 미만료. */
export function deriveShareStatus(
  revokedAt: string | null,
  expiresAt: string | null,
): ShareStatus {
  if (revokedAt) return 'revoked';
  if (isShareExpired(expiresAt)) return 'expired';
  return 'active';
}

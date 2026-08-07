// 공유 대시보드 표시 포맷 — 순수 함수. 한국어 라벨("발급"·"남음"·"만료 없음")은
// messages/ShareDashboard 로 분리하고(check:korean), 여기서는 숫자·날짜 조각만
// 만든다. `now` 는 호출부가 넘긴다(render purity: 컴포넌트 body 에서 Date.now()
// 직접 호출 금지 — 컨테이너가 useState 초기화로 1회 캡처).

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO → "MM-DD" (로케일 무관 숫자). 파싱 실패 시 빈 문자열. */
export function mmdd(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

/** ISO → "MM-DD HH:mm" (열람 열 마지막 열람 시각). */
export function mmddhhmm(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mmdd(iso)} ${hh}:${min}`;
}

export type ExpiryInfo =
  | { kind: 'none' } // expiresAt === null → "만료 없음"
  | { kind: 'left'; date: string; days: number } // 여유 있음
  | { kind: 'soon'; date: string; days: number } // 7일 이내 경고 칩
  | { kind: 'past'; date: string; days: number }; // 이미 만료(expired 행)

// 만료 열 파생 — 절대 날짜 + 상대 기간. 7일 이내면 'soon'(경고 칩), 지났으면
// 'past'("N일 전 만료"). days 는 항상 양의 정수.
export function expiryInfo(expiresAt: string | null, now: number): ExpiryInfo {
  if (!expiresAt) return { kind: 'none' };
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return { kind: 'none' };
  const date = mmdd(expiresAt);
  const diff = t - now;
  if (diff <= 0) {
    return { kind: 'past', date, days: Math.max(1, Math.floor(-diff / DAY_MS)) };
  }
  const days = Math.max(1, Math.ceil(diff / DAY_MS));
  return { kind: days <= 7 ? 'soon' : 'left', date, days };
}

/** 목록 행 이메일 마스킹 — "localpart@…" (풀 주소는 펼침 팝오버에서만, §1.5). */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  return `${email.slice(0, at)}@…`;
}

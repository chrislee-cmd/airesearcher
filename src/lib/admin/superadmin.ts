// Hardcoded super-admin gate. We deliberately keep this list tiny and
// in code (not in a DB column) so that access to the cross-provider API
// usage dashboard cannot accidentally be granted via row edits — a
// future migration that touches profiles wouldn't open the door.
const SUPER_ADMIN_EMAILS: ReadonlySet<string> = new Set([
  'chris.lee@meteor-research.com',
  'lee880728@gmail.com',
  // 조연우 — 응답자 연락처(전화번호·이메일) 평문 열람이 업무 요건이라 의도적으로 등재.
  // 연락처 열람 경로가 전부 이 슈퍼어드민 게이트에 묶여 있음(candidate-masking.ts 의
  // bridge 후보 마스킹 해제, recruiting invitations contacts 라우트, recruiting-pii 컬럼
  // blank). org 의 is_unlimited 로는 열리지 않으므로 allowlist 등재가 유일한 열람 경로다.
  // ⚠️ "최소권한 정리"로 다시 빼지 말 것 — 빼면 이 계정의 연락처 열람이 막힌다(#1214 가
  // 그렇게 뺐다가 이 PR 로 되돌림).
  // 인시던트/에러 다이제스트 메일은 이 allowlist 가 아니라 ERROR_ALERT_EMAILS env 로
  // 통제된다(cron/error-alert-digest 라우트의 수신자 폴백 순서). 그 env 가 설정돼 있어
  // 등재해도 메일은 가지 않는다 — env 를 지우면 폴백이 되살아나 다시 메일이 간다.
  'whdusdn0715@gmail.com',
]);

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return SUPER_ADMIN_EMAILS.has(email.trim().toLowerCase());
}

// Read-only view of the super-admin allowlist. Used server-side by the
// analytics aggregator to resolve super-admin user_ids for the
// "internal account exclusion" filter (never sent to the client).
export function superAdminEmails(): string[] {
  return [...SUPER_ADMIN_EMAILS];
}

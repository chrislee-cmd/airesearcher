// Hardcoded super-admin gate. We deliberately keep this list tiny and
// in code (not in a DB column) so that access to the cross-provider API
// usage dashboard cannot accidentally be granted via row edits — a
// future migration that touches profiles wouldn't open the door.
const SUPER_ADMIN_EMAILS: ReadonlySet<string> = new Set([
  'chris.lee@meteor-research.com',
]);

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return SUPER_ADMIN_EMAILS.has(email.trim().toLowerCase());
}

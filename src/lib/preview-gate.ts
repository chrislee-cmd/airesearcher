import { redirect } from '@/i18n/navigation';
import { getActiveOrg, getOrgFlags } from './org';
import { PREVIEW_FEATURES, type FeatureKey } from './features';

// Server-side gate for preview-only feature pages. Redirects to /dashboard
// when the active org isn't flagged is_unlimited. Pair with the sidebar
// filter so users without access never see the link in the first place;
// this is the second-line defense for direct URL access / bookmarks.
export async function requirePreviewAccess(
  feature: FeatureKey,
  locale: string,
): Promise<void> {
  if (!PREVIEW_FEATURES.has(feature)) return; // not a preview feature
  const org = await getActiveOrg();
  if (!org) {
    redirect({ href: '/dashboard', locale });
    return;
  }
  const flags = await getOrgFlags(org.org_id);
  if (!flags.isUnlimited) {
    redirect({ href: '/dashboard', locale });
    return;
  }
}

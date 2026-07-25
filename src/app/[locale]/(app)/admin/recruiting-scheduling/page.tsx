import { redirect } from 'next/navigation';

// Entry removal (journey P0, BUILD-SPEC §5.3). The standalone
// /admin/recruiting-scheduling surface is superseded by the fused recruiting
// journey (tabs ②③ inside the canvas fullview). This page is now a redirect only
// — the account-menu entry removal + full page deletion are P1/P2 cleanup. The
// scheduling client component is preserved for now (re-homed inside the fullview
// by P1), just no longer reachable via this route.
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/canvas?focus=recruiting`);
}

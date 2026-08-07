import { setRequestLocale } from 'next-intl/server';
import { getActiveOrg } from '@/lib/org';
import { listProjects } from '@/lib/projects';
import { LibrarySurface } from '@/components/artifacts/library/library-surface';

// Unified deliverables library — CD Surface A. Auth is enforced by the (app)
// layout gate; here we only supply the project list (the rail groups by
// project — GET /api/artifacts has no by_project facet) and whether an org is
// active (Move-to-project needs one). The client owns all artifact fetching.
export default async function LibraryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const org = await getActiveOrg();
  const projects = org ? await listProjects(org.org_id) : [];

  return (
    <div className="h-full">
      <LibrarySurface
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        hasOrg={Boolean(org)}
      />
    </div>
  );
}

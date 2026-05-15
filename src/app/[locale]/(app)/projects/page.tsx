import { setRequestLocale, getTranslations } from 'next-intl/server';
import { getCurrentUser } from '@/lib/supabase/user';
import { getActiveOrg } from '@/lib/org';
import { listProjects } from '@/lib/projects';
import { ProjectsView } from '@/components/projects-view';

export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Projects');

  const user = await getCurrentUser();
  const org = user ? await getActiveOrg() : null;
  const projects = org ? await listProjects(org.org_id) : [];

  return (
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-8">
      <div className="border-b border-line pb-3">
        <h1 className="text-[24px] font-bold tracking-[-0.02em] text-ink">
          {t('title')}
        </h1>
      </div>
      <p className="mt-3 max-w-[820px] text-[12.5px] leading-[1.75] text-mute">
        {t('description')}
      </p>

      {!org ? (
        <div className="mt-8 border border-line bg-paper-soft p-6 text-[12.5px] text-mute [border-radius:14px]">
          {t('noActiveOrg')}
        </div>
      ) : (
        <ProjectsView
          initialProjects={projects.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            created_at: p.created_at,
            item_count: p.item_count ?? 0,
          }))}
          canManage
        />
      )}
    </div>
  );
}
